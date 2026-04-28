// Section keys, labels, and placeholder messages for the 6-section worklog summary.
// The order of SECTIONS is the canonical render order for both Notion and Discord.
export const SECTIONS = ["done", "troubleshooting", "lessons", "improvements", "notes", "tomorrow"];

export const SECTION_LABELS = {
  done: "한 일",
  troubleshooting: "트러블슈팅",
  lessons: "배운점",
  improvements: "개선할점",
  notes: "메모/기타",
  tomorrow: "내일 할 일"
};

export const SECTION_PLACEHOLDERS = {
  done: "기록된 한 일이 없습니다.",
  troubleshooting: "기록된 트러블슈팅이 없습니다.",
  lessons: "기록된 배운점이 없습니다.",
  improvements: "기록된 개선할점이 없습니다.",
  notes: "기록된 메모가 없습니다.",
  tomorrow: "기록된 내일 할 일이 없습니다."
};

export async function summarizeWorklog({
  messages,
  date,
  geminiApiKey,
  geminiModel,
  maxTranscriptChars,
  fetchStats
}) {
  if (messages.length === 0) {
    return buildSummary({
      date,
      done: buildEmptyDone(fetchStats)
    });
  }

  const meaningfulMessages = messages.filter(isMeaningfulMessage);
  if (meaningfulMessages.length === 0) {
    return buildSummary({
      date,
      done: buildUnreadableContentDone(fetchStats)
    });
  }

  const fullTranscript = buildTranscript(meaningfulMessages);
  const transcript = truncateTranscript(fullTranscript, maxTranscriptChars);

  if (!geminiApiKey) {
    return summarizeWithoutLlm({ messages: meaningfulMessages, date });
  }

  const result = await summarizeWithGemini({
    transcript,
    date,
    geminiApiKey,
    geminiModel
  });

  const sections = {};
  for (const key of SECTIONS) {
    sections[key] = normalizeList(result[key], SECTION_PLACEHOLDERS[key]);
  }

  return {
    date,
    title: result.title || `${date} 업무 일지`,
    ...sections
  };
}

export function formatReport(summary) {
  const lines = [`# ${summary.date} 업무 일지`, "", "## 제목", summary.title, ""];
  for (const key of SECTIONS) {
    lines.push(`## ${SECTION_LABELS[key]}`);
    for (const item of summary[key]) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// Builds a complete 6-section summary, filling missing sections with their placeholders.
function buildSummary({ date, title, done, troubleshooting, lessons, improvements, notes, tomorrow }) {
  const provided = { done, troubleshooting, lessons, improvements, notes, tomorrow };
  const sections = {};
  for (const key of SECTIONS) {
    sections[key] = normalizeList(provided[key], SECTION_PLACEHOLDERS[key]);
  }
  return {
    date,
    title: title || `${date} 업무 일지`,
    ...sections
  };
}

function buildTranscript(messages) {
  return messages
    .map((message) => {
      const bodyParts = [];
      if (message.content) bodyParts.push(message.content);
      if (message.embedsText?.length > 0) bodyParts.push(`임베드: ${message.embedsText.join(" | ")}`);
      if (message.attachments?.length > 0) bodyParts.push(`첨부: ${message.attachments.join(", ")}`);
      if (message.stickers?.length > 0) bodyParts.push(`스티커: ${message.stickers.join(", ")}`);

      const body = bodyParts.length > 0 ? bodyParts.join("\n") : "(본문 없음)";
      return `[${message.time}] #${message.channelId} ${message.author}\n${body}`;
    })
    .join("\n");
}

function truncateTranscript(transcript, maxChars) {
  const max = Number(maxChars || 0);
  if (!max || transcript.length <= max) return transcript;

  const headSize = Math.floor(max * 0.5);
  const tailSize = Math.max(0, max - headSize);
  const head = transcript.slice(0, headSize);
  const tail = transcript.slice(-tailSize);

  return [
    `[SYSTEM] transcript truncated: full=${transcript.length} chars, kept=${head.length + tail.length} chars`,
    head,
    "\n...[snip]...\n",
    tail
  ].join("\n");
}

async function summarizeWithGemini({ transcript, date, geminiApiKey, geminiModel }) {
  const DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash";
  const modelsToTry = parseGeminiModelCandidates(geminiModel);

  let lastError;
  let triedFallback = false;

  for (const model of modelsToTry) {
    try {
      const body = await generateContentWithGemini({
        transcript,
        date,
        geminiApiKey,
        model
      });
      const text = extractGeminiText(body);
      return JSON.parse(stripCodeFence(text));
    } catch (error) {
      lastError = error;

      if (
        !triedFallback &&
        model !== DEFAULT_FALLBACK_MODEL &&
        isGeminiModelUnavailable(error) &&
        !modelsToTry.includes(DEFAULT_FALLBACK_MODEL)
      ) {
        triedFallback = true;
        modelsToTry.push(DEFAULT_FALLBACK_MODEL);
      }
    }
  }

  throw lastError;
}

function parseGeminiModelCandidates(geminiModel) {
  const raw = String(geminiModel || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => stripModelsPrefix(value));

  const unique = [];
  for (const value of raw) {
    if (!unique.includes(value)) unique.push(value);
  }

  return unique.length > 0 ? unique : ["gemini-2.5-flash"];
}

function stripModelsPrefix(value) {
  const text = String(value || "");
  if (text.length < 7) return text;
  if (text.slice(0, 7).toLowerCase() !== "models/") return text;
  return text.slice(7);
}

function isGeminiModelUnavailable(error) {
  const status = error?.status;
  const bodyText = error?.bodyText || "";
  if (status !== 404) return false;
  return /NOT_FOUND|no longer available|model.*not.*available|model.*not.*found/i.test(bodyText);
}

async function generateContentWithGemini({ transcript, date, geminiApiKey, model }) {
  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  );
  url.searchParams.set("key", geminiApiKey);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "너는 한국어 업무 일지 요약 비서다.",
                "아래 Discord 메시지 로그를 바탕으로 업무 일지를 6개 섹션으로 요약해라.",
                "추측하지 말고, 로그에 있는 사실만 요약한다.",
                "분류 기준:",
                "- done: 실제로 수행/완료한 작업",
                "- troubleshooting: 오류/에러/버그/실패/장애/원인/해결/수정/이슈/문제 관련 내용",
                "- lessons: 새롭게 배운 점, 알게 된 인사이트",
                "- improvements: 개선이 필요한 부분, 향후 보완할 문제",
                "- notes: 위 분류에 속하지 않는 메모/참고사항",
                "- tomorrow: 다음 날 할 일/계획",
                "",
                `날짜: ${date}`,
                "아래 로그를 바탕으로 JSON만 반환해라. (추가 설명 금지)",
                '스키마: {"title":"간단한 제목","done":["한 일"],"troubleshooting":["트러블슈팅"],"lessons":["배운점"],"improvements":["개선할점"],"notes":["메모"],"tomorrow":["내일 할 일"]}',
                "각 배열은 1~6개 항목, 한국어 문장으로 작성한다.",
                "해당하는 내용이 없는 섹션은 빈 배열 [] 로 반환해도 된다.",
                "",
                transcript
              ].join("\\n")
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const bodyText = await response.text();
    const error = new Error(`Gemini API failed (model=${model}): ${response.status} ${bodyText}`);
    error.status = response.status;
    error.bodyText = bodyText;
    error.model = model;
    throw error;
  }

  return response.json();
}

function summarizeWithoutLlm({ messages, date }) {
  const lines = messages
    .map((message) => {
      const parts = [];
      if (message.content) parts.push(message.content);
      if (message.embedsText?.length > 0) parts.push(`임베드: ${message.embedsText.join(" | ")}`);
      if (message.attachments?.length > 0) parts.push(`첨부: ${message.attachments.join(", ")}`);
      if (message.stickers?.length > 0) parts.push(`스티커: ${message.stickers.join(", ")}`);
      const body = parts.length > 0 ? parts.join(" / ") : "(본문 없음)";
      return `${message.time} ${message.author}: ${body}`;
    })
    .filter((line) => line.trim().length > 0)
    .slice(0, 10);

  const troubleshootingLines = lines.filter((line) =>
    /(오류|에러|버그|실패|장애|원인|해결|수정|이슈|문제|error|bug|fail|failed|incident|issue)/i.test(line)
  );
  const doneLines = lines.filter((line) => !troubleshootingLines.includes(line));

  return buildSummary({
    date,
    done: doneLines.length > 0 ? doneLines : ["요약할 수 있는 텍스트가 없습니다."],
    troubleshooting: troubleshootingLines
  });
}

function extractGeminiText(body) {
  return (body.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
}

function stripCodeFence(text) {
  return text.replace(/^```(?:json)?\\s*/i, "").replace(/\\s*```$/i, "").trim();
}

function normalizeList(value, fallback) {
  if (!Array.isArray(value) || value.length === 0) {
    return [fallback];
  }
  const normalized = value.map((item) => String(item).trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : [fallback];
}

function buildEmptyDone(fetchStats) {
  const totals = fetchStats?.totals;
  const done = ["요약할 Discord 메시지가 없습니다."];

  if (!totals) return done;

  if (Number(totals.fetched) === 0) {
    done.push("채널 ID/권한(View Channel, Read Message History) 또는 날짜 범위를 확인하세요.");
    return done;
  }

  if (Number(totals.skippedBot) > 0) {
    done.push(
      `EXCLUDE_BOT_MESSAGES=true로 봇 메시지 ${totals.skippedBot}개가 제외되었습니다. 필요하면 false로 설정하세요.`
    );
  }

  if (Number(totals.keptEmptyBody) > 0) {
    done.push(
      `수집된 메시지 중 본문/임베드/첨부가 비어있는 항목이 ${totals.keptEmptyBody}개 있습니다. ` +
        "Discord Developer Portal에서 MESSAGE CONTENT INTENT 설정을 확인하세요."
    );
  }

  return done.slice(0, 6);
}

function isMeaningfulMessage(message) {
  if (!message) return false;
  if (String(message.content || "").trim().length > 0) return true;
  if (Array.isArray(message.embedsText) && message.embedsText.length > 0) return true;
  if (Array.isArray(message.attachments) && message.attachments.length > 0) return true;
  if (Array.isArray(message.stickers) && message.stickers.length > 0) return true;
  return false;
}

function buildUnreadableContentDone(fetchStats) {
  const totals = fetchStats?.totals;
  const done = ["Discord 메시지는 수집됐지만 본문/임베드/첨부를 읽을 수 없습니다."];

  if (totals) {
    done.push(
      `kept=${Number(totals.kept || 0)}, keptEmptyBody=${Number(totals.keptEmptyBody || 0)}`
    );
  }

  done.push("Discord Developer Portal에서 MESSAGE CONTENT INTENT를 켰는지 확인하세요.");
  done.push("봇 권한(View Channel, Read Message History)과 채널 접근 가능 여부도 확인하세요.");

  return done.slice(0, 6);
}
