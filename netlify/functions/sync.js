// Fuel to Run — Notion Sync
// Env var required: NOTION_TOKEN

const PAGE_TITLE = "FTR — App Data";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function findOrCreatePage() {
  const search = await notion("POST", "/search", {
    query: PAGE_TITLE,
    filter: { value: "page", property: "object" },
  });
  const page = search.results?.find(
    (p) => p.object === "page" &&
      p.properties?.title?.title?.[0]?.plain_text === PAGE_TITLE
  );
  if (page) return page.id;
  const newPage = await notion("POST", "/pages", {
    parent: { type: "workspace", workspace: true },
    properties: {
      title: { title: [{ type: "text", text: { content: PAGE_TITLE } }] },
    },
  });
  return newPage.id;
}

async function loadData(pageId) {
  const blocks = await notion("GET", `/blocks/${pageId}/children`);
  for (const block of blocks.results || []) {
    const text =
      block.code?.rich_text?.[0]?.plain_text ||
      block.paragraph?.rich_text?.[0]?.plain_text;
    if (text && text.trimStart().startsWith("{")) {
      try { return JSON.parse(text); } catch {}
    }
  }
  return null;
}

async function saveData(pageId, data) {
  const existing = await notion("GET", `/blocks/${pageId}/children`);
  await Promise.all(
    (existing.results || []).map((b) => notion("DELETE", `/blocks/${b.id}`))
  );
  await notion("PATCH", `/blocks/${pageId}/children`, {
    children: [{
      type: "code",
      code: {
        language: "json",
        rich_text: [{ type: "text", text: { content: JSON.stringify(data) } }],
      },
    }],
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  if (!process.env.NOTION_TOKEN) {
    return { statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: "NOTION_TOKEN not set" }) };
  }
  try {
    const { action, pageId, data } = JSON.parse(event.body || "{}");
    if (action === "load") {
      const pid = pageId || await findOrCreatePage();
      const loaded = await loadData(pid);
      return { statusCode: 200, headers: CORS,
        body: JSON.stringify({ data: loaded, pageId: pid }) };
    }
    if (action === "save") {
      const pid = pageId || await findOrCreatePage();
      await saveData(pid, data);
      return { statusCode: 200, headers: CORS,
        body: JSON.stringify({ success: true, pageId: pid }) };
    }
    return { statusCode: 400, headers: CORS,
      body: JSON.stringify({ error: "Unknown action" }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: e.message }) };
  }
};
