import { formatKstTime } from "./time.js";

const DISCORD_API_BASE = "https://discord.com/api/v10";

export async function fetchChannelMessages({ channelIds, token, range, excludeBotMessages }) {
  const allMessages = [];
  const perChannel = [];

  for (const channelId of channelIds) {
    const { messages: channelMessages, stats } = await fetchMessagesForChannel({
      channelId,
      token,
      range,
      excludeBotMessages
    });
    allMessages.push(...channelMessages);
    perChannel.push(stats);
  }

  const messages = allMessages.sort((a, b) => a.createdAt - b.createdAt);
  return {
    messages,
    stats: summarizeStats(perChannel)
  };
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
  const stats = {
    channelId,
    fetched: 0,
    kept: 0,
    skippedBeforeStart: 0,
    skippedAfterEnd: 0,
    skippedBot: 0,
    keptEmptyBody: 0,
    keptSystem: 0,
    keptEmptySystem: 0
  };

  while (true) {
    const url = new URL(`${DISCORD_API_BASE}/channels/${channelId}/messages`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("before", before);

    const batch = await discordFetch(url, token, { channelId });
    if (batch.length === 0) break;
    stats.fetched += batch.length;

    let reachedStart = false;

    for (const message of batch) {
      const createdAt = new Date(message.timestamp);
      if (createdAt < range.start) {
        reachedStart = true;
        stats.skippedBeforeStart += 1;
        continue;
      }
      if (createdAt >= range.end) {
        stats.skippedAfterEnd += 1;
        continue;
      }
      if (excludeBotMessages && message.author?.bot) {
        stats.skippedBot += 1;
        continue;
      }

      const normalized = normalizeMessage(message, channelId, createdAt);
      stats.kept += 1;
      if (normalized.type !== 0) stats.keptSystem += 1;
      if (
        !normalized.content &&
        normalized.attachments.length === 0 &&
        normalized.embedsText.length === 0 &&
        normalized.stickers.length === 0
      ) {
        stats.keptEmptyBody += 1;
        if (normalized.type !== 0) stats.keptEmptySystem += 1;
      }
      messages.push(normalized);
    }

    before = batch[batch.length - 1].id;
    if (reachedStart || batch.length < 100) break;
  }

  return { messages, stats };
}

async function discordFetch(url, token, context = {}) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bot ${token}`
    }
  });

  if (response.status === 429) {
    const body = await response.json();
    const retryAfterMs = Math.ceil(Number(body.retry_after || 1) * 1000);
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    return discordFetch(url, token, context);
  }

  if (!response.ok) {
    const details = await response.text();
    if (response.status === 404 && context.channelId) {
      throw new Error(
        `Discord API failed for channel ${context.channelId}: 404 Unknown Channel (code 10003). ` +
          `This usually means the channel ID is wrong, or the bot cannot access the channel (missing View Channel / Read Message History, or not in the server). ` +
          `Raw: ${details}`
      );
    }
    throw new Error(`Discord API failed: ${response.status} ${details}`);
  }

  return response.json();
}

function normalizeMessage(message, channelId, createdAt) {
  const attachments = (message.attachments || []).map((attachment) => attachment.url);
  const embedsText = extractEmbedsText(message.embeds || []);
  const stickers = (message.sticker_items || [])
    .map((sticker) => sticker?.name || sticker?.id || "")
    .map((value) => String(value).trim())
    .filter(Boolean);

  return {
    id: message.id,
    type: Number(message.type || 0),
    channelId,
    author: message.author?.global_name || message.author?.username || "Unknown",
    content: message.content || "",
    attachments,
    embedsText,
    stickers,
    createdAt,
    time: formatKstTime(createdAt)
  };
}

function extractEmbedsText(embeds) {
  const text = [];

  for (const embed of embeds || []) {
    if (embed?.title) text.push(String(embed.title));
    if (embed?.description) text.push(String(embed.description));
    for (const field of embed?.fields || []) {
      const name = field?.name ? String(field.name) : "";
      const value = field?.value ? String(field.value) : "";
      const line = [name, value].filter(Boolean).join(": ");
      if (line) text.push(line);
    }
  }

  return text.map((value) => value.trim()).filter(Boolean);
}

function summarizeStats(perChannel) {
  const totals = {
    fetched: 0,
    kept: 0,
    skippedBeforeStart: 0,
    skippedAfterEnd: 0,
    skippedBot: 0,
    keptEmptyBody: 0,
    keptSystem: 0,
    keptEmptySystem: 0
  };

  for (const stats of perChannel) {
    for (const key of Object.keys(totals)) {
      totals[key] += Number(stats[key] || 0);
    }
  }

  return { perChannel, totals };
}
