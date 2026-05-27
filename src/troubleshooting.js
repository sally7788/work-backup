import { loadTroubleshootingConfig } from "./config.js";
import { findProperty, notionFetch } from "./notion.js";

const DEFAULT_NOTION_PAGE_SIZE = 100;

async function main() {
  const config = loadTroubleshootingConfig();
  const range = getLookbackRangeKst({
    now: new Date(),
    timezone: config.timezone,
    lookbackDays: config.lookbackDays
  });

  console.log(
    `Troubleshooting weekly run: lookbackDays=${config.lookbackDays}, range=${range.startDate}..${range.endDate} (KST dates)`
  );

  const worklogDatabase = await notionFetch(`/databases/${config.worklogDatabaseId}`, config.notionToken);
  const worklogTitleProperty = findProperty(worklogDatabase.properties, "title");
  const worklogDateProperty = findProperty(worklogDatabase.properties, "date");

  if (!worklogTitleProperty) {
    throw new Error("Worklog Notion database must include a title property");
  }
  if (!worklogDateProperty) {
    throw new Error(
      "Worklog Notion database must include a date property to build weekly troubleshooting"
    );
  }

  const worklogPages = await queryDatabaseAll({
    token: config.notionToken,
    databaseId: config.worklogDatabaseId,
    body: {
      filter: {
        and: [
          { property: worklogDateProperty.name, date: { on_or_after: range.startDate } },
          { property: worklogDateProperty.name, date: { before: range.endDate } }
        ]
      },
      sorts: [{ property: worklogDateProperty.name, direction: "ascending" }]
    }
  });

  console.log(`Found ${worklogPages.length} worklog pages in range`);

  const parentPageId = await resolveParentPageId({
    token: config.notionToken,
    parentId: config.troubleshootingParentPageId,
    containerPageTitle: config.troubleshootingContainerPageTitle,
    dryRun: config.dryRun
  });

  const troubleshootingDatabaseId = await ensureTroubleshootingDatabase({
    token: config.notionToken,
    parentPageId,
    databaseName: config.troubleshootingDatabaseName
  });

  const existingTitles = await collectExistingTitles({
    token: config.notionToken,
    databaseId: troubleshootingDatabaseId
  });

  let created = 0;
  let skippedDuplicate = 0;
  let skippedEmpty = 0;

  for (const page of worklogPages) {
    const worklogDate = readPageDateProperty(page, worklogDateProperty.name) || "";
    const worklogTitle = readPageTitleProperty(page, worklogTitleProperty.name) || "(untitled)";

    const troubleshootingItems = await extractTroubleshootingItemsFromWorklogPage({
      token: config.notionToken,
      pageId: page.id
    });

    const items = troubleshootingItems.map(normalizeItem).filter(Boolean);
    if (items.length === 0) {
      skippedEmpty += 1;
      continue;
    }

    for (const item of items) {
      if (existingTitles.has(item)) {
        skippedDuplicate += 1;
        continue;
      }

      if (config.dryRun) {
        console.log(`[DRY_RUN] create: "${item}" (from ${worklogDate} ${worklogTitle})`);
        existingTitles.add(item);
        created += 1;
        continue;
      }

      await createTroubleshootingEntry({
        token: config.notionToken,
        databaseId: troubleshootingDatabaseId,
        title: item,
        worklogDate,
        sourceUrl: page.url || ""
      });
      existingTitles.add(item);
      created += 1;
    }
  }

  console.log(
    `Troubleshooting summary: created=${created}, skippedDuplicate=${skippedDuplicate}, skippedEmptyPages=${skippedEmpty}`
  );
}

async function ensureTroubleshootingDatabase({ token, parentPageId, databaseName }) {
  const children = await listBlockChildrenAll({ token, blockId: parentPageId });
  const existing = children.find(
    (block) => block.type === "child_database" && readChildDatabaseTitle(block) === databaseName
  );

  if (existing?.id) {
    console.log(`Using existing troubleshooting database: ${databaseName} (${existing.id})`);
    return existing.id;
  }

  const created = await notionFetch("/databases", token, {
    method: "POST",
    body: {
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: databaseName } }],
      properties: {
        Name: { title: {} },
        "Worklog Date": { date: {} },
        "Source URL": { url: {} }
      }
    }
  });

  console.log(`Created troubleshooting database: ${databaseName} (${created.id})`);
  return created.id;
}

async function resolveParentPageId({ token, parentId, containerPageTitle, dryRun }) {
  // Notion allows creating a database only under a page (page_id) or workspace.
  // Users sometimes paste a database URL/ID here; when that happens, create a container page in that database
  // and parent the troubleshooting database under the new page.

  try {
    await notionFetch(`/pages/${parentId}`, token);
    return parentId;
  } catch {
    // ignore and try as database
  }

  let database;
  try {
    database = await notionFetch(`/databases/${parentId}`, token);
  } catch {
    throw new Error(
      "NOTION_TROUBLESHOOT_PARENT_PAGE_ID must be a Notion page id/url (or a database id/url to auto-create a container page)."
    );
  }

  const titleProperty = findProperty(database.properties, "title");
  if (!titleProperty) {
    throw new Error("Troubleshooting parent database must include a title property to create a container page");
  }

  if (dryRun) {
    console.log(
      `[DRY_RUN] parent is a database (${parentId}); would create container page titled "${containerPageTitle}"`
    );
    // Best-effort: return the database id so subsequent calls fail fast rather than mutating state in DRY_RUN.
    return parentId;
  }

  const page = await notionFetch("/pages", token, {
    method: "POST",
    body: {
      parent: { database_id: parentId },
      properties: {
        [titleProperty.name]: {
          title: [{ type: "text", text: { content: containerPageTitle } }]
        }
      }
    }
  });

  console.log(`Created troubleshooting container page: "${containerPageTitle}" (${page.id})`);
  return page.id;
}

async function createTroubleshootingEntry({ token, databaseId, title, worklogDate, sourceUrl }) {
  const properties = {
    Name: { title: [{ type: "text", text: { content: title.slice(0, 2000) } }] }
  };

  if (worklogDate) {
    properties["Worklog Date"] = { date: { start: worklogDate } };
  }
  if (sourceUrl) {
    properties["Source URL"] = { url: sourceUrl };
  }

  return notionFetch("/pages", token, {
    method: "POST",
    body: {
      parent: { database_id: databaseId },
      properties,
      children: [
        paragraph(`원본 업무일지: ${worklogDate || ""}`.trim()),
        sourceUrl ? paragraph(sourceUrl) : paragraph("(no source url)")
      ]
    }
  });
}

async function extractTroubleshootingItemsFromWorklogPage({ token, pageId }) {
  const blocks = await listBlockChildrenAll({ token, blockId: pageId });

  // The bot writes headings in this order:
  // 1 done, 2 troubleshooting, 3 lessons, 4 improvements, 5 notes, 6 tomorrow
  let headingIndex = 0;
  let inTroubleshooting = false;

  const items = [];
  for (const block of blocks) {
    if (block.type === "heading_2") {
      headingIndex += 1;
      inTroubleshooting = headingIndex === 2;
      continue;
    }

    if (!inTroubleshooting) continue;

    if (block.type === "bulleted_list_item") {
      const text = readRichTextPlain(block.bulleted_list_item?.rich_text);
      if (text) items.push(text);
    }
  }

  return items;
}

async function collectExistingTitles({ token, databaseId }) {
  const database = await notionFetch(`/databases/${databaseId}`, token);
  const titleProperty = findProperty(database.properties, "title");
  if (!titleProperty) throw new Error("Troubleshooting database must include a title property");

  const pages = await queryDatabaseAll({
    token,
    databaseId,
    body: {
      page_size: DEFAULT_NOTION_PAGE_SIZE
    }
  });

  const set = new Set();
  for (const page of pages) {
    const title = readPageTitleProperty(page, titleProperty.name);
    if (title) set.add(normalizeItem(title));
  }
  return set;
}

async function queryDatabaseAll({ token, databaseId, body }) {
  const results = [];
  let startCursor = undefined;

  while (true) {
    const page = await notionFetch(`/databases/${databaseId}/query`, token, {
      method: "POST",
      body: {
        page_size: DEFAULT_NOTION_PAGE_SIZE,
        ...body,
        ...(startCursor ? { start_cursor: startCursor } : {})
      }
    });

    results.push(...(page.results || []));

    if (!page.has_more || !page.next_cursor) {
      break;
    }
    startCursor = page.next_cursor;
  }

  return results;
}

async function listBlockChildrenAll({ token, blockId }) {
  const results = [];
  let startCursor = undefined;

  while (true) {
    const query = new URLSearchParams({ page_size: String(DEFAULT_NOTION_PAGE_SIZE) });
    if (startCursor) query.set("start_cursor", startCursor);
    const page = await notionFetch(`/blocks/${blockId}/children?${query.toString()}`, token);

    results.push(...(page.results || []));

    if (!page.has_more || !page.next_cursor) {
      break;
    }
    startCursor = page.next_cursor;
  }

  return results;
}

function readPageTitleProperty(page, propertyName) {
  const prop = page?.properties?.[propertyName];
  if (!prop || prop.type !== "title") return "";
  return readRichTextPlain(prop.title);
}

function readPageDateProperty(page, propertyName) {
  const prop = page?.properties?.[propertyName];
  if (!prop || prop.type !== "date") return "";
  return prop.date?.start || "";
}

function readRichTextPlain(richTextArray) {
  if (!Array.isArray(richTextArray)) return "";
  return richTextArray.map((t) => t.plain_text || "").join("").trim();
}

function readChildDatabaseTitle(block) {
  const title = block?.child_database?.title;
  return typeof title === "string" ? title.trim() : "";
}

function paragraph(text) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: String(text).slice(0, 2000) } }]
    }
  };
}

function normalizeItem(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  // Skip placeholder-like lines.
  if (/기록.*없습니다|없음/i.test(text)) return "";

  return text.replace(/\s+/g, " ").slice(0, 2000);
}

function getLookbackRangeKst({ now, timezone, lookbackDays }) {
  if (timezone !== "Asia/Seoul") {
    // This bot is KST-first; keep behavior explicit.
    console.warn(`TIMEZONE=${timezone} requested, but weekly range currently uses KST logic`);
  }

  const current = getKstParts(now);
  // KST midnight == UTC 15:00 previous day.
  const end = new Date(Date.UTC(current.year, current.month - 1, current.day, -9, 0, 0, 0));
  const start = new Date(end.getTime() - Number(lookbackDays) * 24 * 60 * 60 * 1000);

  return {
    startDate: formatKstDate(start),
    endDate: formatKstDate(end)
  };
}

function formatKstDate(date) {
  const parts = getKstParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getKstParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year").value),
    month: Number(parts.find((part) => part.type === "month").value),
    day: Number(parts.find((part) => part.type === "day").value)
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
