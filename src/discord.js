import { formatKstTime } from "./time.js";

const DISCORD_API_BASE = "https://discord.com/api/v10";

export async function fetchChannelMessages({ channelIds, token, range, excludeBotMessages }) {
  const allMessages = [];

  for (const channelId of channelIds) {
    const channelMessages = await fetchMessagesForChannel({
      channelId,
      token,
      range,
      excludeBotMessages
    });
    allMessages.push(...channelMessages);
  }

  return allMessages.sort((a, b) => a.createdAt - b.createdAt);
}

export async function sendDiscordWebhook(webhookUrl, text) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: text })
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status} ${await response.text()}`);
  }
}

async function fetchMessagesForChannel({ channelId, token, range, excludeBotMessages }) {
  const messages = [];
  let before = range.endSnowflake;

  while (true) {
    const url = new URL(`${DISCORD_API_BASE}/channels/${channelId}/messages`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("before", before);

    const batch = await discordFetch(url, token);
    if (batch.length === 0) break;

    let reachedStart = false;

    for (const message of batch) {
      const createdAt = new Date(message.timestamp);
      if (createdAt < range.start) {
        reachedStart = true;
        continue;
      }
      if (createdAt >= range.end) continue;
      if (excludeBotMessages && message.author?.bot) continue;

      messages.push(normalizeMessage(message, channelId, createdAt));
    }

    before = batch[batch.length - 1].id;
    if (reachedStart || batch.length < 100) break;
  }

  return messages;
}

async function discordFetch(url, token) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bot ${token}`
    }
  });

  if (response.status === 429) {
    const body = await response.json();
    const retryAfterMs = Math.ceil(Number(body.retry_after || 1) * 1000);
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    return discordFetch(url, token);
  }

  if (!response.ok) {
    throw new Error(`Discord API failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function normalizeMessage(message, channelId, createdAt) {
  const attachments = (message.attachments || []).map((attachment) => attachment.url);

  return {
    id: message.id,
    channelId,
    author: message.author?.global_name || message.author?.username || "Unknown",
    content: message.content || "",
    attachments,
    createdAt,
    time: formatKstTime(createdAt)
  };
}
