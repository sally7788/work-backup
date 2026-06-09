const DEFAULT_NOTION_DATABASE_ID = "34b92254028a80f98c05fdb0aa399f89";

export function loadConfig() {
  const env = process.env;

  return {
    discordBotToken: readRequired(env, "DISCORD_BOT_TOKEN"),
    discordChannelIds: readDiscordChannelIds(env, "DISCORD_CHANNEL_IDS"),
    discordWebhookUrl: readRequired(env, "DISCORD_WEBHOOK_URL"),
    notionToken: readRequired(env, "NOTION_TOKEN"),
    notionDatabaseId: normalizeNotionId(env.NOTION_DATABASE_ID || DEFAULT_NOTION_DATABASE_ID, {
      name: "NOTION_DATABASE_ID"
    }),
    gptApiKey: env.GPT_API_KEY || env.GEMINI_API_KEY || "",
    gptModel: env.GPT_MODEL || env.GEMINI_MODEL || "gpt-5.4-mini",
    timezone: env.TIMEZONE || "Asia/Seoul",
    dailyReportTime: env.DAILY_REPORT_TIME || "08:00",
    excludeBotMessages: readBoolean(env.EXCLUDE_BOT_MESSAGES, true),
    maxTranscriptChars: Number(env.MAX_TRANSCRIPT_CHARS || 60000),
    dryRun: readBoolean(env.DRY_RUN, false)
  };
}

export function loadTroubleshootingConfig() {
  const env = process.env;

  return {
    notionToken: readRequired(env, "NOTION_TOKEN"),
    worklogDatabaseId: normalizeNotionId(env.NOTION_DATABASE_ID || DEFAULT_NOTION_DATABASE_ID, {
      name: "NOTION_DATABASE_ID"
    }),
    troubleshootingParentPageId: normalizeNotionId(
      readRequired(env, "NOTION_TROUBLESHOOT_PARENT_PAGE_ID"),
      { name: "NOTION_TROUBLESHOOT_PARENT_PAGE_ID" }
    ),
    troubleshootingDatabaseName: env.NOTION_TROUBLESHOOT_DATABASE_NAME || "Troubleshooting",
    troubleshootingContainerPageTitle:
      env.NOTION_TROUBLESHOOT_CONTAINER_PAGE_TITLE || "Troubleshooting",
    lookbackDays: Number(env.TROUBLESHOOT_LOOKBACK_DAYS || 7),
    timezone: env.TIMEZONE || "Asia/Seoul",
    dryRun: readBoolean(env.DRY_RUN, false)
  };
}

function readRequired(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeNotionId(value, { name } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return raw;

  // Accept:
  // - 32-hex ID: 34b92254028a80f98c05fdb0aa399f89
  // - UUID: 34b92254-028a-80f9-8c05-fdb0aa399f89
  // - Notion URLs containing either form
  const uuidMatch =
    raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) ||
    raw.match(/[0-9a-f]{32}/i);

  if (!uuidMatch) {
    const label = name ? `${name}=` : "";
    throw new Error(`Invalid Notion id/url: ${label}${raw}`);
  }

  return uuidMatch[0].replace(/-/g, "").toLowerCase();
}

function readListRequired(env, name) {
  const value = readRequired(env, name);
  const list = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (list.length === 0) {
    throw new Error(`${name} must contain at least one value`);
  }

  return list;
}

function readDiscordChannelIds(env, name) {
  const raw = readListRequired(env, name);
  const normalized = raw
    .map((value) => {
      // Accept plain IDs ("123"), mentions ("<#123>"), or accidental text ("channel:123").
      const match = String(value).match(/\d{6,}/);
      return match ? match[0] : "";
    })
    .filter(Boolean);

  const unique = Array.from(new Set(normalized));
  if (unique.length === 0) {
    throw new Error(`${name} must contain at least one numeric channel id`);
  }
  return unique;
}

function readBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}
