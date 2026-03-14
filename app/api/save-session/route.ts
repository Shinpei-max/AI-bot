import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";

const ANALYSIS_PROMPT = `以下のAI勉強セッションの会話ログを分析し、JSON形式で返してください。

【重要】JSONのみ返すこと。前後のテキスト・マークダウン記号（\`\`\`など）は一切含めないこと。

{
  "topic": "今日のメイントピック（20字以内）",
  "summary": "セッション全体の要約（200字程度）",
  "tags": ["タグ1", "タグ2"],
  "industries": ["業種1", "業種2"],
  "level": "beginner または intermediate または advanced",
  "keyLearnings": ["重要な学び1", "重要な学び2", "重要な学び3"]
}

tagsの例：LLM / RAG / エージェント / プロンプト設計 / GAS連携 / Notion連携 / 概念層 / 実装層 / 提案層
industriesの例：人材紹介 / 営業 / マーケティング / バックオフィス / カスタマーサポート / 採用 / 医療 / 小売

会話ログ：
`;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const notionApiKey = process.env.NOTION_API_KEY;
    const notionDatabaseId = process.env.NOTION_DATABASE_ID;

    console.log("[save-session] env check:", {
      NOTION_API_KEY: notionApiKey ? `loaded (${notionApiKey.length} chars)` : "MISSING",
      NOTION_DATABASE_ID: notionDatabaseId ? `loaded (${notionDatabaseId})` : "MISSING",
    });

    if (!apiKey || !notionApiKey || !notionDatabaseId) {
      return NextResponse.json(
        { error: "Required environment variables are not configured" },
        { status: 500 }
      );
    }

    const { messages, date, durationMinutes } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is required and must not be empty" },
        { status: 400 }
      );
    }

    if (!date || typeof date !== "string") {
      return NextResponse.json(
        { error: "date is required (YYYY-MM-DD format)" },
        { status: 400 }
      );
    }

    const conversationText = messages
      .map(
        (m: { role: string; content: string }) =>
          `${m.role === "user" ? "ユーザー" : "アシスタント"}: ${m.content}`
      )
      .join("\n\n");

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: ANALYSIS_PROMPT + conversationText,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const rawContent =
      textBlock && "text" in textBlock ? (textBlock.text as string) : "";

    const jsonStr = rawContent
      .replace(/^```[\w]*\n?/g, "")
      .replace(/\n?```$/g, "")
      .trim();
    const summary = JSON.parse(jsonStr);

    if (
      !summary.topic ||
      !summary.summary ||
      !Array.isArray(summary.tags) ||
      !Array.isArray(summary.industries) ||
      !summary.level ||
      !Array.isArray(summary.keyLearnings)
    ) {
      throw new Error("Invalid summary format from Claude");
    }

    const notion = new Client({ auth: notionApiKey });

    // ---- DB アクセス確認テスト ----
    console.log("[save-session] databases.retrieve() テスト開始");
    console.log("[save-session] 使用する DB ID:", JSON.stringify(notionDatabaseId));
    console.log("[save-session] DB ID 長さ:", notionDatabaseId.length);
    try {
      const dbInfo = await notion.databases.retrieve({ database_id: notionDatabaseId });
      console.log("[save-session] databases.retrieve() 成功:", JSON.stringify({
        id: dbInfo.id,
        title: "title" in dbInfo ? dbInfo.title : "(no title)",
      }));
    } catch (retrieveError) {
      console.error("[save-session] databases.retrieve() 失敗:", retrieveError);
      if (retrieveError instanceof Error) {
        console.error("[save-session] retrieve エラー詳細:", {
          message: retrieveError.message,
          name: retrieveError.name,
        });
      }
    }
    // ---- テスト終了 ----

    // 学習時間プロパティをNotionDBに追加（既存の場合は上書きで問題なし）
    if (typeof durationMinutes === "number") {
      try {
        await fetch(`https://api.notion.com/v1/databases/${notionDatabaseId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${notionApiKey}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            properties: { 学習時間: { number: { format: "number" } } },
          }),
        });
      } catch {
        // プロパティ追加失敗は無視して続行
      }
    }

    console.log("[save-session] notion.pages.create() の直前");
    try {
      await notion.pages.create({
        parent: { database_id: notionDatabaseId },
        properties: {
        タイトル: {
          title: [
            {
              text: {
                content: `${date} - ${summary.topic}`,
              },
            },
          ],
        },
        日付: {
          date: {
            start: date,
          },
        },
        要約: {
          rich_text: [
            {
              text: {
                content: summary.summary,
              },
            },
          ],
        },
        タグ: {
          multi_select: summary.tags.map((name: string) => ({ name })),
        },
        活用業種: {
          multi_select: summary.industries.map((name: string) => ({ name })),
        },
        習熟レベル: {
          multi_select: [{ name: summary.level }],
        },
        重要な学び: {
          rich_text: [
            {
              text: {
                content: summary.keyLearnings.join("\n"),
              },
            },
          ],
        },
        ...(typeof durationMinutes === "number"
          ? { 学習時間: { number: durationMinutes } }
          : {}),
      },
    });
      console.log("[save-session] notion.pages.create() の直後 - 成功");
    } catch (notionError) {
      console.error("[save-session] Notion API エラー:", notionError);
      if (notionError instanceof Error) {
        console.error("[save-session] エラー詳細:", {
          name: notionError.name,
          message: notionError.message,
          stack: notionError.stack,
        });
      }
      if (typeof notionError === "object" && notionError !== null && "body" in notionError) {
        console.error("[save-session] Notion API response body:", (notionError as { body?: unknown }).body);
      }
      throw notionError;
    }

    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error("Save session API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
