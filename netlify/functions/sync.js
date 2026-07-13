// Fuel to Run — Notion Sync Function
// Stores/retrieves the entire app state as JSON in a Notion page.
// Required env var in Netlify: NOTION_TOKEN

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
  // Search for existing page
  const search = await notion("POST", "/search", {
    query: PAGE_TITLE,
    filter: { value: "page", property: "object" },
  });
  const page = search.results?.find(
    (p) =>
      p.object === "page" &&
      p.properties?.title?.title?.[0]?.plain_text === PAGE_TITLE
  );
  if (page) return page.id;

  // Create new page at workspace root
  const newPage = await notion("POST", "/pages", {
    parent: { type: "workspace", workspace: true },
    properties: {
      title: {
        title: [{ type: "text", text: { content: PAGE_TITLE } }],
      },
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
      try {
        return JSON.parse(text);
      } catch {}
    }
  }
  return null;
}

async function saveData(pageId, data) {
  // Delete all existing blocks
  const existing = await notion("GET", `/blocks/${pageId}/children`);
  await Promise.all(
    (existing.results || []).map((b) => notion("DELETE", `/blocks/${b.id}`))
  );
  // Write new data as a code block
  await notion("PATCH", `/blocks/${pageId}/children`, {
    children: [
      {
        type: "code",
        code: {
          language: "json",
          rich_text: [
            { type: "text", text: { content: JSON.stringify(data) } },
          ],
        },
      },
    ],
  });
}

export default async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers: CORS });
  }

  if (!process.env.NOTION_TOKEN) {
    return new Response(
      JSON.stringify({ error: "NOTION_TOKEN not set in environment variables" }),
      { status: 500, headers: CORS }
    );
  }

  try {
    const { action, pageId, data } = await req.json();

    if (action === "load") {
      const pid = pageId || (await findOrCreatePage());
      const loaded = await loadData(pid);
      return new Response(JSON.stringify({ data: loaded, pageId: pid }), {
        status: 200,
        headers: CORS,
      });
    }

    if (action === "save") {
      const pid = pageId || (await findOrCreatePage());
      await saveData(pid, data);
      return new Response(JSON.stringify({ success: true, pageId: pid }), {
        status: 200,
        headers: CORS,
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: CORS,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: CORS,
    });
  }
};

export const config = { path: "/api/sync" };
