import Anthropic from "@anthropic-ai/sdk";
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

export async function POST() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const notionApiKey = process.env.NOTION_API_KEY;
  const notionDatabaseId = process.env.NOTION_DATABASE_ID;

  if (!apiKey || !notionApiKey || !notionDatabaseId) {
    return NextResponse.json(
      { error: "API keys not configured" },
      { status: 500 }
    );
  }

  try {
    const response = await queryNotionDatabase(notionApiKey, notionDatabaseId, {
      sorts: [{ property: "日付", direction: "descending" }],
      page_size: 50,
    });

    if (response.results.length === 0) {
      return NextResponse.json({
        analysis: "まだ学習記録がありません。勉強セッションを保存してから分析してください。",
        sessionCount: 0,
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessions = response.results.map((page: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (page as any).properties;
      return {
        title: props.タイトル?.title?.[0]?.plain_text ?? "",
        date: props.日付?.date?.start ?? "",
        summary: props.要約?.rich_text?.[0]?.plain_text ?? "",
        tags:
          props.タグ?.multi_select?.map((t: { name: string }) => t.name) ?? [],
        level: props.習熟レベル?.multi_select?.[0]?.name ?? "",
        keyLearnings: props.重要な学び?.rich_text?.[0]?.plain_text ?? "",
      };
    });

    const sessionsText = sessions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map(
        (s: any) =>
          `[${s.date}] ${s.title}\nレベル: ${s.level}\nタグ: ${s.tags.join(", ")}\n要約: ${s.summary}\n重要な学び: ${s.keyLearnings}`
      )
      .join("\n\n---\n\n");

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: `以下はユーザーの勉強ログ一覧です（${sessions.length}件）。

${sessionsText}

---
このデータをもとに、以下の4点を日本語で分析してください。出力はMarkdown形式で、各項目に絵文字を使ってください：

1. **✅ 理解できている領域**（よく学習されているトピック・タグの傾向、習熟レベルの状況）
2. **⚠️ まだ浅い・未強化の領域**（学習回数が少ない・beginnerレベルが続いている領域）
3. **📌 次に学ぶべきこと**（優先順位付きで3〜5項目、理由も記載）
4. **💡 総合コメント**（全体的な学習の進み具合と今後のアドバイス）`,
        },
      ],
    });

    const analysis =
      message.content[0].type === "text" ? message.content[0].text : "";

    return NextResponse.json({ analysis, sessionCount: sessions.length });
  } catch (e) {
    console.error("[analyze-progress] エラー:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
