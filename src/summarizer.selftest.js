import assert from "node:assert/strict";

import { summarizeWorklog } from "./summarizer.js";

async function run() {
  {
    const summary = await summarizeWorklog({
      messages: [],
      date: "2026-04-23",
      geminiApiKey: "",
      geminiModel: "",
      maxTranscriptChars: 1000,
      fetchStats: {
        perChannel: [],
        totals: { fetched: 0, skippedBot: 0, keptEmptyBody: 0 }
      }
    });

    assert.equal(summary.date, "2026-04-23");
    assert.equal(summary.progress[0], "요약할 Discord 메시지가 없습니다.");
    assert(summary.progress.some((line) => /채널 ID\/권한/i.test(line)));
  }

  {
    const summary = await summarizeWorklog({
      messages: [],
      date: "2026-04-23",
      geminiApiKey: "",
      geminiModel: "",
      maxTranscriptChars: 1000,
      fetchStats: {
        perChannel: [],
        totals: { fetched: 12, skippedBot: 12, keptEmptyBody: 0 }
      }
    });

    assert(summary.progress.some((line) => /EXCLUDE_BOT_MESSAGES=true/i.test(line)));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
