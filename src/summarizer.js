// Section keys, labels, and placeholder messages for the 6-section worklog summary.
// The order of SECTIONS is the canonical render order for both Notion and Discord.
export const SECTIONS = ["done", "troubleshooting", "lessons", "improvements", "notes", "tomorrow"];

export const SECTION_LABELS = {
  done: "완료",
  troubleshooting: "트러블슈팅",
  lessons: "교훈",
  improvements: "개선사항",
  notes: "메모",
  tomorrow: "내일"
};

export const SECTION_PLACEHOLDERS = {
  done: "완료된 작업이 없습니다.",
  troubleshooting: "이슈가 없습니다.",
  lessons: "학습한 내용이 없습니다.",
  improvements: "개선할 내용이 없습니다.",
  notes: "추가 메모가 없습니다.",
  tomorrow: "내일 계획이 없습니다."
};

export async function summarizeWorklog({
  messages,
  date,
  gptApiKey,
  gptModel,
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

  if (!gptApiKey) {
    return summarizeWithoutLlm({ messages: meaningfulMessages, date });
  }

  const result = await summarizeWithGemini({
    transcript,
    date,
    geminiApiKey: gptApiKey,
    geminiModel: gptModel
  });

  const sections = {};
  for (const key of SECTIONS) {
    sections[key] = normalizeList(result[key], SECTION_PLACEHOLDERS[key]);
  }

  return {
    date,
    title: result.title || `${date} 작업일지 요약`,
    ...sections
  };
}

export function formatReport(summary) {
  const lines = [`# ${summary.date} 작업일지 요약`, "", "## 제목", summary.title, ""];
  for (const key of SECTIONS) {
    lines.push(`## ${SECTION_LABELS[key]}`);
    for (const item of summary[key]) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function buildSummary({ date, title, done, troubleshooting, lessons, improvements, notes, tomorrow }) {
  const provided = { done, troubleshooting, lessons, improvements, notes, tomorrow };
  const sections = {};
  for (const key of SECTIONS) {
    sections[key] = normalizeList(provided[key], SECTION_PLACEHOLDERS[key]);
  }
  return {
    date,
    title: title || `${date} 작업일지 요약`,
    ...sections
  };
}

function buildTranscript(messages) {
  return messages
    .map((message) => {
      const bodyParts = [];
      if (message.content) bodyParts.push(message.content);
      if (message.embedsText?.length > 0) bodyParts.push(`임베드: ${message.embedsText.join(" | ")}`);
      if (message.attachments?.length > 0) bodyParts.push(`첨부파일: ${message.attachments.join(", ")}`);
      if (message.stickers?.length > 0) bodyParts.push(`스티커: ${message.stickers.join(", ")}`);

      const body = bodyParts.length > 0 ? bodyParts.join("\n") : "(본문 내용을 읽을 수 없습니다)";
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

  return [`[SYSTEM] transcript truncated: full=${transcript.length} chars, kept=${head.length + tail.length} chars`, head, "\n...[snip]...\n", tail].join("\n");
}

async function summarizeWithGemini({ transcript, date, geminiApiKey, geminiModel }) {
  const DEFAULT_FALLBACK_MODEL = "gpt-5.4-mini";
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

  return unique.length > 0 ? unique : ["gpt-5.4-mini"];
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
  if (status !== 404 && status !== 400) return false;
  return /NOT_FOUND|no longer available|model.*not.*available|model.*not.*found|model_not_found|invalid.*model/i.test(
    bodyText
  );
}

async function generateContentWithGemini({ transcript, date, geminiApiKey, model }) {
  const url = new URL("https://api.openai.com/v1/chat/completions");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${geminiApiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            "다음 채널 메시지 로그를 6개 섹션으로 요약해줘.",
            "반드시 JSON 객체만 반환해.",
            "출력 키: title, done, troubleshooting, lessons, improvements, notes, tomorrow.",
            "각 값은 문자열 배열 형식으로 작성해.",
            `기준일: ${date}`,
            "대화 로그:",
            transcript
          ].join("\n")
        }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const bodyText = await response.text();
    const error = new Error(`GPT API failed (model=${model}): ${response.status} ${bodyText}`);
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
      if (message.attachments?.length > 0) parts.push(`첨부파일: ${message.attachments.join(", ")}`);
      if (message.stickers?.length > 0) parts.push(`스티커: ${message.stickers.join(", ")}`);
      const body = parts.length > 0 ? parts.join(" / ") : "(본문 내용을 읽을 수 없습니다)";
      return `${message.time} ${message.author}: ${body}`;
    })
    .filter((line) => line.trim().length > 0)
    .slice(0, 10);

  const troubleshootingLines = lines.filter((line) =>
    /error|bug|fail|failed|incident|issue|problem|trouble|troubleshooting|outage|crash/i.test(line)
  );
  const doneLines = lines.filter((line) => !troubleshootingLines.includes(line));

  return buildSummary({
    date,
    done: doneLines.length > 0 ? doneLines : ["읽을 수 있는 완료 항목이 없습니다."],
    troubleshooting: troubleshootingLines
  });
}

function extractGeminiText(body) {
  const text = body?.choices?.[0]?.message?.content || "";
  return String(text).trim();
}

function stripCodeFence(text) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
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
  const done = ["Discord 메시지가 없습니다."];

  if (!totals) return done;

  if (Number(totals.fetched) === 0) {
    done.push(
      "현재 채널 권한(View Channel, Read Message History)으로는 메시지를 가져오지 못했습니다."
    );
    return done;
  }

  if (Number(totals.skippedBot) > 0) {
    done.push(
      `EXCLUDE_BOT_MESSAGES=true: 봇 메시지 ${totals.skippedBot}건이 제외되었습니다. false로 설정하면 포함됩니다.`
    );
  }

  if (Number(totals.keptEmptyBody) > 0) {
    done.push(
      `본문/임베드/첨부파일이 비어 있어 임시로 보존된 메시지: ${totals.keptEmptyBody}건. ` +
        "Discord Developer Portal에서 MESSAGE CONTENT INTENT가 켜져 있는지 확인하세요."
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
  const done = ["Discord 메시지에서 텍스트를 읽지 못했습니다."];

  if (totals) {
    done.push(`kept=${Number(totals.kept || 0)}, keptEmptyBody=${Number(totals.keptEmptyBody || 0)}`);
  }

  done.push("Discord Developer Portal에서 MESSAGE CONTENT INTENT가 활성화되어 있는지 확인하세요.");
  done.push("선택한 채널에서 View Channel와 Read Message History 권한을 확인하세요.");

  return done.slice(0, 6);
}

