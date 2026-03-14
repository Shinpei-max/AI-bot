import { NextResponse } from "next/server";

async function queryNotionDatabase(
  notionApiKey: string,
  databaseId: string,
  body: object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const res = await fetch(
    `https://api.notion.com/v1/databases/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionApiKey}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `Notion API error ${res.status}`);
  }
  return res.json();
}

export async function GET() {
  const notionApiKey = process.env.NOTION_API_KEY;
  const notionDatabaseId = process.env.NOTION_DATABASE_ID;

  if (!notionApiKey || !notionDatabaseId) {
    return NextResponse.json(
      { error: "Notion API not configured" },
      { status: 500 }
    );
  }

  try {
    const response = await queryNotionDatabase(notionApiKey, notionDatabaseId, {
      sorts: [{ property: "日付", direction: "descending" }],
      page_size: 20,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessions = response.results.map((page: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (page as any).properties;
      return {
        id: page.id,
        title: props.タイトル?.title?.[0]?.plain_text ?? "",
        date: props.日付?.date?.start ?? "",
        summary: props.要約?.rich_text?.[0]?.plain_text ?? "",
        tags: props.タグ?.multi_select?.map((t: { name: string }) => t.name) ?? [],
        industries:
          props.活用業種?.multi_select?.map((t: { name: string }) => t.name) ?? [],
        level: props.習熟レベル?.multi_select?.[0]?.name ?? "",
        keyLearnings: props.重要な学び?.rich_text?.[0]?.plain_text ?? "",
        durationMinutes: props.学習時間?.number ?? null,
      };
    });

    return NextResponse.json({ sessions });
  } catch (e) {
    console.error("[study-history] エラー:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
