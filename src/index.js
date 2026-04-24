import { loadConfig } from "./config.js";
import { fetchChannelMessages, sendDiscordWebhook } from "./discord.js";
import { createNotionWorklogPage } from "./notion.js";
import { formatReport, summarizeWorklog } from "./summarizer.js";
import { getDelayUntilNextRun, getYesterdayRangeKst } from "./time.js";

const config = loadConfig();
const runOnce = process.argv.includes("--once");

async function main() {
  if (runOnce) {
    await runDailyReport();
    return;
  }

  scheduleNextRun();
}

async function runDailyReport() {
  const range = getYesterdayRangeKst();
  console.log(`Collecting Discord messages for ${range.date}`);

  const { messages, stats } = await fetchChannelMessages({
    channelIds: config.discordChannelIds,
    token: config.discordBotToken,
    range,
    excludeBotMessages: config.excludeBotMessages
  });

  console.log(`Collected ${messages.length} messages`);
  logDiscordFetchStats(stats);

  const summary = await summarizeWorklog({
    messages,
    date: range.date,
    geminiApiKey: config.geminiApiKey,
    geminiModel: config.geminiModel,
    maxTranscriptChars: config.maxTranscriptChars,
    fetchStats: stats
  });

  const report = formatReport(summary);

  if (config.dryRun) {
    console.log(report);
    return;
  }

  const notionPage = await createNotionWorklogPage({
    token: config.notionToken,
    databaseId: config.notionDatabaseId,
    summary
  });

  const notionUrl = notionPage.url ? `\n\nNotion: ${notionPage.url}` : "";
  await sendDiscordWebhook(config.discordWebhookUrl, `${report}${notionUrl}`);
  console.log(`Daily report sent for ${range.date}`);
}

function scheduleNextRun() {
  const delay = getDelayUntilNextRun(config.dailyReportTime);
  const minutes = Math.round(delay / 1000 / 60);
  console.log(`Next report scheduled in ${minutes} minutes at ${config.dailyReportTime} KST`);

  setTimeout(async () => {
    try {
      await runDailyReport();
    } catch (error) {
      console.error(error);
    } finally {
      scheduleNextRun();
    }
  }, delay);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function logDiscordFetchStats(stats) {
  if (!stats) return;

  const { totals, perChannel } = stats;
  console.log(
    `Discord fetch totals: fetched=${totals.fetched}, kept=${totals.kept}, ` +
      `skippedBot=${totals.skippedBot}, skippedBeforeStart=${totals.skippedBeforeStart}, ` +
      `skippedAfterEnd=${totals.skippedAfterEnd}, keptEmptyBody=${totals.keptEmptyBody}, ` +
      `keptSystem=${totals.keptSystem}, keptEmptySystem=${totals.keptEmptySystem}`
  );

  for (const channel of perChannel || []) {
    console.log(
      `- #${channel.channelId}: kept=${channel.kept} (fetched=${channel.fetched}, ` +
        `skippedBot=${channel.skippedBot}, skippedBeforeStart=${channel.skippedBeforeStart}, ` +
        `skippedAfterEnd=${channel.skippedAfterEnd}, keptEmptyBody=${channel.keptEmptyBody}, ` +
        `keptSystem=${channel.keptSystem}, keptEmptySystem=${channel.keptEmptySystem})`
    );
  }
}
