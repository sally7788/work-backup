// Section keys, labels, and placeholder messages for the 6-section worklog summary.
// The order of SECTIONS is the canonical render order for both Notion and Discord.
export const SECTIONS = ["done", "troubleshooting", "lessons", "improvements", "notes", "tomorrow"];

export const SECTION_LABELS = {
  done: "????,
  troubleshooting: "?¸ëŸ¬ë¸”ìŠˆ??,
  lessons: "ë°°ìš´??,
  improvements: "ê°œì„ ? ì ",
  notes: "ë©”ëª¨/ê¸°í?",
  tomorrow: "?´ì¼ ????
};

export const SECTION_PLACEHOLDERS = {
  done: "ê¸°ë¡?????¼ì´ ?†ìŠµ?ˆë‹¤.",
  troubleshooting: "ê¸°ë¡???¸ëŸ¬ë¸”ìŠˆ?…ì´ ?†ìŠµ?ˆë‹¤.",
  lessons: "ê¸°ë¡??ë°°ìš´?ì´ ?†ìŠµ?ˆë‹¤.",
  improvements: "ê¸°ë¡??ê°œì„ ? ì ???†ìŠµ?ˆë‹¤.",
  notes: "ê¸°ë¡??ë©”ëª¨ê°€ ?†ìŠµ?ˆë‹¤.",
  tomorrow: "ê¸°ë¡???´ì¼ ???¼ì´ ?†ìŠµ?ˆë‹¤."
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
    title: result.title || `${date} ?…ë¬´ ?¼ì?`,
    ...sections
  };
}

export function formatReport(summary) {
  const lines = [`# ${summary.date} ?…ë¬´ ?¼ì?`, "", "## ?œëª©", summary.title, ""];
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
    title: title || `${date} ?…ë¬´ ?¼ì?`,
    ...sections
  };
}

function buildTranscript(messages) {
  return messages
    .map((message) => {
      const bodyParts = [];
      if (message.content) bodyParts.push(message.content);
      if (message.embedsText?.length > 0) bodyParts.push(`?„ë² ?? ${message.embedsText.join(" | ")}`);
      if (message.attachments?.length > 0) bodyParts.push(`ì²¨ë?: ${message.attachments.join(", ")}`);
      if (message.stickers?.length > 0) bodyParts.push(`?¤í‹°ì»? ${message.stickers.join(", ")}`);

      const body = bodyParts.length > 0 ? bodyParts.join("\n") : "(ë³¸ë¬¸ ?†ìŒ)";
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
            "¾Æ·¡ Ã¤ÆÃ ·Î±×¸¦ ±Ù°Å·Î, 6°³ ¼½¼ÇÀ¸·Î ¿ä¾àÇØÁà.",
            "Discord Ã¤³Î ¸Ş½ÃÁö ·Î±×¸¦ º¸°í, °¢ Ç×¸ñÀ» ¿ä¾àÇØ¼­ JSON¸¸ ¹İÈ¯ÇØÁà.",
            "Ãâ·Â Çü½ÄÀº Ç×»ó JSON °´Ã¼ÀÌ¸ç, ²À ¾Æ·¡ Å°¸¦ ¸ğµÎ Ã¤¿öÁà:",
            "- title: ÀÛ¾÷ ÀÏÁö Á¦¸ñ",
            "- done: ¿Ï·áµÈ ÀÛ¾÷",
            "- troubleshooting: ÀÌ½´/¿¡·¯/Àå¾Ö/¹®Á¦",
            "- lessons: ÇĞ½ÀÇÑ ³»¿ë",
            "- improvements: °³¼±Á¡",
            "- notes: Âü°í ¸Ş¸ğ",
            "- tomorrow: ´ÙÀ½ ³¯ °èÈ¹",
            "",
            `±âÁØÀÏ: ${date}`,
            "¸Ş½ÃÁö ¿ø¹®À» ±Ù°Å·Î °¢ ¼½¼ÇÀ» ¹®ÀÚ¿­ ¹è¿­·Î ±¸¼ºÇÏ°í, ¹İµå½Ã 1~6°³ Ç×¸ñ ¹üÀ§·Î Ã¤¿öÁà.",
            "¿¹½Ã: {\"title\":\"ÀÛ¾÷ ¿ä¾à\",\"done\":[\"...\"],\"troubleshooting\":[\"...\"],\"lessons\":[\"...\"],\"improvements\":[\"...\"],\"notes\":[\"...\"],\"tomorrow\":[\"...\"]}",
            "ÇÊ¿äÇÏ¸é JSON ¹è¿­À» ºó ¹è¿­([])·Î µÎ¾îµµ µÈ´Ù.",
            "",
            transcript
          ].join("\\n")
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
      if (message.embedsText?.length > 0) parts.push(`?„ë² ?? ${message.embedsText.join(" | ")}`);
      if (message.attachments?.length > 0) parts.push(`ì²¨ë?: ${message.attachments.join(", ")}`);
      if (message.stickers?.length > 0) parts.push(`?¤í‹°ì»? ${message.stickers.join(", ")}`);
      const body = parts.length > 0 ? parts.join(" / ") : "(ë³¸ë¬¸ ?†ìŒ)";
      return `${message.time} ${message.author}: ${body}`;
    })
    .filter((line) => line.trim().length > 0)
    .slice(0, 10);

  const troubleshootingLines = lines.filter((line) =>
    /(?¤ë¥˜|?ëŸ¬|ë²„ê·¸|?¤íŒ¨|?¥ì• |?ì¸|?´ê²°|?˜ì •|?´ìŠˆ|ë¬¸ì œ|error|bug|fail|failed|incident|issue)/i.test(line)
  );
  const doneLines = lines.filter((line) => !troubleshootingLines.includes(line));

  return buildSummary({
    date,
    done: doneLines.length > 0 ? doneLines : ["?”ì•½?????ˆëŠ” ?ìŠ¤?¸ê? ?†ìŠµ?ˆë‹¤."],
    troubleshooting: troubleshootingLines
  });
}

function extractGeminiText(body) {
  const text = body?.choices?.[0]?.message?.content || "";
  return String(text).trim();
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
  const done = ["?”ì•½??Discord ë©”ì‹œì§€ê°€ ?†ìŠµ?ˆë‹¤."];

  if (!totals) return done;

  if (Number(totals.fetched) === 0) {
    done.push("ì±„ë„ ID/ê¶Œí•œ(View Channel, Read Message History) ?ëŠ” ? ì§œ ë²”ìœ„ë¥??•ì¸?˜ì„¸??");
    return done;
  }

  if (Number(totals.skippedBot) > 0) {
    done.push(
      `EXCLUDE_BOT_MESSAGES=trueë¡?ë´?ë©”ì‹œì§€ ${totals.skippedBot}ê°œê? ?œì™¸?˜ì—ˆ?µë‹ˆ?? ?„ìš”?˜ë©´ falseë¡??¤ì •?˜ì„¸??`
    );
  }

  if (Number(totals.keptEmptyBody) > 0) {
    done.push(
      `?˜ì§‘??ë©”ì‹œì§€ ì¤?ë³¸ë¬¸/?„ë² ??ì²¨ë?ê°€ ë¹„ì–´?ˆëŠ” ??ª©??${totals.keptEmptyBody}ê°??ˆìŠµ?ˆë‹¤. ` +
        "Discord Developer Portal?ì„œ MESSAGE CONTENT INTENT ?¤ì •???•ì¸?˜ì„¸??"
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
  const done = ["Discord ë©”ì‹œì§€???˜ì§‘?ì?ë§?ë³¸ë¬¸/?„ë² ??ì²¨ë?ë¥??½ì„ ???†ìŠµ?ˆë‹¤."];

  if (totals) {
    done.push(
      `kept=${Number(totals.kept || 0)}, keptEmptyBody=${Number(totals.keptEmptyBody || 0)}`
    );
  }

  done.push("Discord Developer Portal?ì„œ MESSAGE CONTENT INTENTë¥?ì¼°ëŠ”ì§€ ?•ì¸?˜ì„¸??");
  done.push("ë´?ê¶Œí•œ(View Channel, Read Message History)ê³?ì±„ë„ ?‘ê·¼ ê°€???¬ë????•ì¸?˜ì„¸??");

  return done.slice(0, 6);
}
