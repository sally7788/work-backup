const DEFAULT_NOTION_DATABASE_ID = "34b92254028a80f98c05fdb0aa399f89";

export function loadConfig() {
  const env = process.env;

  return {
    discordBotToken: readRequired(env, "DISCORD_BOT_TOKEN"),
    discordChannelIds: readListRequired(env, "DISCORD_CHANNEL_IDS"),
    discordWebhookUrl: readRequired(env, "DISCORD_WEBHOOK_URL"),
    notionToken: readRequired(env, "NOTION_TOKEN"),
    notionDatabaseId: env.NOTION_DATABASE_ID || DEFAULT_NOTION_DATABASE_ID,
    geminiApiKey: env.GEMINI_API_KEY || "",
    geminiModel: env.GEMINI_MODEL || "gemini-2.0-flash",
    timezone: env.TIMEZONE || "Asia/Seoul",
    dailyReportTime: env.DAILY_REPORT_TIME || "08:00",
    excludeBotMessages: readBoolean(env.EXCLUDE_BOT_MESSAGES, true),
    maxTranscriptChars: Number(env.MAX_TRANSCRIPT_CHARS || 60000),
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

function readBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}
