export async function summarizeWorklog({ messages, date, geminiApiKey, geminiModel, maxTranscriptChars }) {
  if (messages.length === 0) {
    return {
      date,
      title: `${date} 업무 일지`,
      progress: ["채널에 작성된 업무 메시지가 없습니다."],
      troubleshooting: ["기록된 트러블 슈팅 내용이 없습니다."]
    };
  }

  const transcript = buildTranscript(messages).slice(0, maxTranscriptChars);

  if (!geminiApiKey) {
    return summarizeWithoutLlm({ messages, date });
  }

  const result = await summarizeWithGemini({
    transcript,
    date,
    geminiApiKey,
    geminiModel
  });

  return {
    date,
    title: result.title || `${date} 업무 일지`,
    progress: normalizeList(result.progress, "기록된 진행 내용이 없습니다."),
    troubleshooting: normalizeList(result.troubleshooting, "기록된 트러블 슈팅 내용이 없습니다.")
  };
}

export function formatReport(summary) {
  return [
    `# ${summary.date} 업무 일지`,
    "",
    "## 제목",
    summary.title,
    "",
    "## 진행한 내용",
    ...summary.progress.map((item) => `- ${item}`),
    "",
    "## 트러블 슈팅",
    ...summary.troubleshooting.map((item) => `- ${item}`)
  ].join("\n");
}

function buildTranscript(messages) {
  return messages
    .map((message) => {
      const attachmentText =
        message.attachments.length > 0 ? ` 첨부: ${message.attachments.join(", ")}` : "";
      return `[${message.time}] #${message.channelId} ${message.author}: ${message.content}${attachmentText}`;
    })
    .join("\n");
}

async function summarizeWithGemini({ transcript, date, geminiApiKey, geminiModel }) {
  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`
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
                "너는 한국어 업무 일지를 작성하는 비서다.",
                "Discord 대화를 근거로만 간결한 일지를 작성한다.",
                "추측하지 말고, 오류/장애/해결/원인/수정 같은 내용은 트러블 슈팅에 분리한다.",
                "",
                `날짜: ${date}`,
                "아래 Discord 메시지를 바탕으로 JSON만 반환해.",
                '스키마: {"title":"짧은 제목","progress":["진행 내용"],"troubleshooting":["트러블 슈팅 내용"]}',
                "progress와 troubleshooting은 각각 1~6개 항목으로 작성해.",
                '트러블 슈팅 내용이 없으면 "기록된 트러블 슈팅 내용이 없습니다."를 넣어.',
                "",
                transcript
              ].join("\n")
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
    throw new Error(`Gemini API failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json();
  const text = extractGeminiText(body);
  return JSON.parse(stripCodeFence(text));
}

function summarizeWithoutLlm({ messages, date }) {
  const lines = messages
    .map((message) => `${message.time} ${message.author}: ${message.content}`)
    .filter((line) => line.trim().length > 0)
    .slice(0, 10);

  const troubleshooting = lines.filter((line) =>
    /(오류|에러|장애|버그|실패|해결|원인|트러블|문제)/i.test(line)
  );

  return {
    date,
    title: `${date} 업무 일지`,
    progress: lines.length > 0 ? lines : ["채널 메시지는 있었지만 요약할 텍스트가 없습니다."],
    troubleshooting:
      troubleshooting.length > 0 ? troubleshooting : ["기록된 트러블 슈팅 내용이 없습니다."]
  };
}

function extractGeminiText(body) {
  return (body.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
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
