const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export async function createNotionWorklogPage({ token, databaseId, summary }) {
  const database = await notionFetch(`/databases/${databaseId}`, token);
  const titleProperty = findProperty(database.properties, "title");
  const dateProperty = findProperty(database.properties, "date");

  if (!titleProperty) {
    throw new Error("Notion database must include a title property");
  }

  const properties = {
    [titleProperty.name]: {
      title: [{ text: { content: `${summary.date} ${summary.title}` } }]
    }
  };

  if (dateProperty) {
    properties[dateProperty.name] = {
      date: { start: summary.date }
    };
  }

  return notionFetch("/pages", token, {
    method: "POST",
    body: {
      parent: { database_id: databaseId },
      properties,
      children: buildChildren(summary)
    }
  });
}

async function notionFetch(path, token, options = {}) {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    throw new Error(`Notion API failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function findProperty(properties, type) {
  return Object.entries(properties)
    .map(([name, property]) => ({ name, ...property }))
    .find((property) => property.type === type);
}

function buildChildren(summary) {
  return [
    heading("진행한 내용"),
    ...summary.progress.map((item) => bullet(item)),
    heading("트러블 슈팅"),
    ...summary.troubleshooting.map((item) => bullet(item))
  ];
}

function heading(text) {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: text } }]
    }
  };
}

function bullet(text) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [{ type: "text", text: { content: text.slice(0, 2000) } }]
    }
  };
}
