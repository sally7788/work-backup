import assert from "node:assert/strict";

import {
  formatReport,
  SECTIONS,
  SECTION_LABELS,
  SECTION_PLACEHOLDERS,
  summarizeWorklog
} from "./summarizer.js";
import { getTargetWorkdayRangeKst } from "./time.js";

function assertSixSectionShape(summary) {
  assert.equal(typeof summary.date, "string");
  assert.equal(typeof summary.title, "string");
  for (const key of SECTIONS) {
    assert.ok(Array.isArray(summary[key]), `summary.${key} must be an array`);
    assert.ok(summary[key].length >= 1, `summary.${key} must be non-empty`);
    for (const item of summary[key]) {
      assert.equal(typeof item, "string");
      assert.ok(item.length > 0);
    }
  }
}

async function run() {
  // Test 1: empty messages -> done carries diagnostic, others are placeholders
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
    assertSixSectionShape(summary);
    assert.equal(summary.done[0], "요약할 Discord 메시지가 없습니다.");
    assert(summary.done.some((line) => /채널 ID\/권한/i.test(line)));
    assert.equal(summary.troubleshooting[0], SECTION_PLACEHOLDERS.troubleshooting);
    assert.equal(summary.lessons[0], SECTION_PLACEHOLDERS.lessons);
    assert.equal(summary.improvements[0], SECTION_PLACEHOLDERS.improvements);
    assert.equal(summary.notes[0], SECTION_PLACEHOLDERS.notes);
    assert.equal(summary.tomorrow[0], SECTION_PLACEHOLDERS.tomorrow);
  }

  // Test 2: bot-only messages -> done carries EXCLUDE_BOT_MESSAGES diagnostic
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

    assertSixSectionShape(summary);
    assert(summary.done.some((line) => /EXCLUDE_BOT_MESSAGES=true/i.test(line)));
    assert.equal(summary.lessons[0], SECTION_PLACEHOLDERS.lessons);
    assert.equal(summary.tomorrow[0], SECTION_PLACEHOLDERS.tomorrow);
  }

  // Test 3: keyword-fallback -> troubleshooting catches "에러", done has the rest, others placeholder
  {
    const messages = [
      { time: "09:00", channelId: "c1", author: "alice", content: "스펙 초안을 작성했다" },
      { time: "10:00", channelId: "c1", author: "alice", content: "API 연결에서 에러가 발생했다" },
      { time: "11:00", channelId: "c1", author: "alice", content: "회의 노트를 정리했다" },
      { time: "12:00", channelId: "c1", author: "alice", content: "코드 리뷰 코멘트를 반영했다" }
    ];
    const summary = await summarizeWorklog({
      messages,
      date: "2026-04-23",
      geminiApiKey: "",
      geminiModel: "",
      maxTranscriptChars: 1000,
      fetchStats: {
        perChannel: [],
        totals: { fetched: 4, kept: 4, skippedBot: 0, keptEmptyBody: 0 }
      }
    });

    assertSixSectionShape(summary);
    assert(
      summary.troubleshooting.some((line) => /에러/.test(line)),
      "troubleshooting should pick up the line containing 에러"
    );
    assert(summary.done.length >= 1);
    assert(
      summary.done.some((line) => /스펙 초안|회의 노트|코드 리뷰/.test(line)),
      "done should include the non-error lines"
    );
    assert(
      summary.done.every((line) => !/에러/.test(line)),
      "done should not contain the troubleshooting line"
    );
    assert.equal(summary.lessons[0], SECTION_PLACEHOLDERS.lessons);
    assert.equal(summary.improvements[0], SECTION_PLACEHOLDERS.improvements);
    assert.equal(summary.notes[0], SECTION_PLACEHOLDERS.notes);
    assert.equal(summary.tomorrow[0], SECTION_PLACEHOLDERS.tomorrow);
  }

  // Test 4: shape verification -> exactly 6 section keys + date + title, all non-empty arrays
  {
    const summary = await summarizeWorklog({
      messages: [],
      date: "2026-04-23",
      geminiApiKey: "",
      geminiModel: "",
      maxTranscriptChars: 1000,
      fetchStats: { perChannel: [], totals: { fetched: 0, skippedBot: 0, keptEmptyBody: 0 } }
    });
    assertSixSectionShape(summary);
    const expectedKeys = new Set(["date", "title", ...SECTIONS]);
    const actualKeys = new Set(Object.keys(summary));
    for (const key of expectedKeys) {
      assert.ok(actualKeys.has(key), `summary must include key "${key}"`);
    }
    for (const key of actualKeys) {
      assert.ok(expectedKeys.has(key), `summary contains unexpected key "${key}"`);
    }
  }

  // Test 5: formatReport -> all 6 ## headers in correct order
  {
    const summary = await summarizeWorklog({
      messages: [],
      date: "2026-04-23",
      geminiApiKey: "",
      geminiModel: "",
      maxTranscriptChars: 1000,
      fetchStats: { perChannel: [], totals: { fetched: 0, skippedBot: 0, keptEmptyBody: 0 } }
    });
    const report = formatReport(summary);
    assert.ok(report.startsWith("# 2026-04-23 업무 일지"));
    assert.ok(report.includes("## 제목"));

    let cursor = 0;
    for (const key of SECTIONS) {
      const header = `## ${SECTION_LABELS[key]}`;
      const idx = report.indexOf(header, cursor);
      assert.ok(idx !== -1, `report must contain "${header}"`);
      assert.ok(idx >= cursor, `header "${header}" must appear after previous headers`);
      cursor = idx + header.length;
    }
  }

  // Test 6: getTargetWorkdayRangeKst -> deterministic weekday handling
  {
    // Monday KST (2026-04-27 09:00 KST = 2026-04-27 00:00 UTC)
    const monday = getTargetWorkdayRangeKst(new Date("2026-04-27T00:00:00Z"));
    assert.ok(monday !== null, "Monday should not return null");
    assert.equal(monday.weekday, "Mon");
    assert.equal(monday.date, "2026-04-24", "Monday should target previous Friday 2026-04-24");

    // Tuesday KST (2026-04-28 09:00 KST = 2026-04-28 00:00 UTC)
    const tuesday = getTargetWorkdayRangeKst(new Date("2026-04-28T00:00:00Z"));
    assert.ok(tuesday !== null, "Tuesday should not return null");
    assert.equal(tuesday.weekday, "Tue");
    assert.equal(tuesday.date, "2026-04-27", "Tuesday should target previous day 2026-04-27");

    // Saturday KST (2026-04-25 09:00 KST = 2026-04-25 00:00 UTC)
    const saturday = getTargetWorkdayRangeKst(new Date("2026-04-25T00:00:00Z"));
    assert.equal(saturday, null, "Saturday must return null");

    // Sunday KST (2026-04-26 09:00 KST = 2026-04-26 00:00 UTC)
    const sunday = getTargetWorkdayRangeKst(new Date("2026-04-26T00:00:00Z"));
    assert.equal(sunday, null, "Sunday must return null");
  }

  console.log("summarizer.selftest: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
