// Fuel to Run — Notion Sync
// Required env vars: NOTION_TOKEN, NOTION_PAGE_ID

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

async function loadData(pageId) {
  const blocks = await notion("GET", `/blocks/${pageId}/children`);
  // Reassemble chunks written by saveData
  let jsonStr = "";
  for (const block of blocks.results || []) {
    const text =
      block.code?.rich_text?.[0]?.plain_text ||
      block.paragraph?.rich_text?.[0]?.plain_text;
    if (text) jsonStr += text;
  }
  if (jsonStr.trimStart().startsWith("{")) {
    try { return JSON.parse(jsonStr); } catch {}
  }
  return null;
}

async function saveData(pageId, data) {
  // Split JSON into 1900-char chunks (Notion limit is 2000)
  const jsonStr = JSON.stringify(data);
  const CHUNK = 1900;
  const chunks = [];
  for (let i = 0; i < jsonStr.length; i += CHUNK) {
    chunks.push(jsonStr.slice(i, i + CHUNK));
  }

  // Delete existing blocks one by one
  const existing = await notion("GET", `/blocks/${pageId}/children`);
  for (const block of existing.results || []) {
    await notion("DELETE", `/blocks/${block.id}`);
  }

  // Write all chunks in one request
  await notion("PATCH", `/blocks/${pageId}/children`, {
    children: chunks.map((chunk) => ({
      type: "code",
      code: {
        language: "json",
        rich_text: [{ type: "text", text: { content: chunk } }],
      },
    })),
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

  const PAGE_ID = process.env.NOTION_PAGE_ID;

  try {
    const { action, pageId, data } = JSON.parse(event.body || "{}");
    const pid = PAGE_ID || pageId;
    if (!pid) {
      return { statusCode: 400, headers: CORS,
        body: JSON.stringify({ error: "Set NOTION_PAGE_ID in Netlify env vars" }) };
    }

    if (action === "load") {
      const loaded = await loadData(pid);
      return { statusCode: 200, headers: CORS,
        body: JSON.stringify({ data: loaded, pageId: pid }) };
    }

    if (action === "save") {
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
