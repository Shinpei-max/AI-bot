import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const BASE_SYSTEM_PROMPT = `あなたはAI・業務効率化の専門家として、ユーザーのAI勉強をサポートする優秀な講師です。

【あなたのゴール】
「企業へのAI業務効率化を提案できる人材」を育てることです。
ユーザーは人材紹介業（リクルーター）をしており、将来的に企業へAI活用を提案できるレベルを目指しています。

【返答のスタイル】
- 抽象的な説明だけでなく、具体的なビジネスユースケースを必ず交える
- 人材紹介業界での活用例も積極的に提示する
- 専門用語は使いつつ、必ず平易な言葉で補足する
- 1回の返答は長くなりすぎず、対話形式を維持する
- 理解度を確認しながら進める
- 返答は適切に改行を入れて読みやすくする（段落ごとに空行を入れる）
- 箇条書きが適切な場面では「・」や番号リストを使う
- 堅苦しくなりすぎず、自然な会話調で話しかける

【カバーするトピック】
LLM・RAG・AIエージェント・プロンプト設計・GAS連携・Notion連携・各種API連携・業種別ユースケース・AIコンサル提案フレームワーク`;

// カタカナ2文字以上、またはアルファベット2文字以上の最初のキーワードを抽出
function extractKeyword(text: string): string {
  const match = text.match(/[ァ-ヶー]{2,}|[A-Za-z]{2,}/);
  return match ? match[0] : "";
}

async function fetchRelevantLogs(
  notionApiKey: string,
  databaseId: string,
  userMessage: string
): Promise<string> {
  try {
    const keyword = extractKeyword(userMessage);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = {
      sorts: [{ property: "日付", direction: "descending" }],
      page_size: 5,
    };

    if (keyword) {
      body.filter = {
        or: [
          { property: "タイトル", title: { contains: keyword } },
          { property: "要約", rich_text: { contains: keyword } },
          { property: "重要な学び", rich_text: { contains: keyword } },
        ],
      };
    }

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
    if (!res.ok) return "";

    const response = await res.json();
    if (!response.results || response.results.length === 0) return "";

    const logs = response.results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((page: any) => {
        const props = page.properties;
        const title = props.タイトル?.title?.[0]?.plain_text ?? "";
        const date = props.日付?.date?.start ?? "";
        const summary = props.要約?.rich_text?.[0]?.plain_text ?? "";
        const learnings = props.重要な学び?.rich_text?.[0]?.plain_text ?? "";
        return `[${date}] ${title}\n要約: ${summary}\n重要な学び: ${learnings}`;
      })
      .join("\n\n");

    return logs;
  } catch (e) {
    console.error("[chat] Notion検索エラー:", e);
    return "";
  }
}

export async function POST(request: Request) {
  try {
    const apiKey =
      process.env.ANTHROPIC_API_KEY ?? process.env["ANTHROPIC_API_KEY"];
    const notionApiKey = process.env.NOTION_API_KEY;
    const notionDatabaseId = process.env.NOTION_DATABASE_ID;

    if (!apiKey || apiKey.trim() === "") {
      return NextResponse.json(
        {
          error:
            "ANTHROPIC_API_KEY is not configured. .env.local に ANTHROPIC_API_KEY を設定し、サーバーを再起動してください。",
        },
        { status: 500 }
      );
    }

    const { messages, previousSession } = await request.json();
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    const anthropicMessages = messages.map(
      (m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })
    );

    // 最新のユーザーメッセージで過去ログを検索
    let systemPrompt = BASE_SYSTEM_PROMPT;
    if (notionApiKey && notionDatabaseId) {
      const lastUserMessage =
        [...messages].reverse().find((m: { role: string }) => m.role === "user")
          ?.content ?? "";
      const relevantLogs = await fetchRelevantLogs(
        notionApiKey,
        notionDatabaseId,
        lastUserMessage
      );
      if (relevantLogs) {
        systemPrompt =
          BASE_SYSTEM_PROMPT +
          `\n\n【過去の勉強ログ（参考にして回答してください）】\n---\n${relevantLogs}\n---`;
        console.log(
          "[chat] 過去ログを取得しました（件数:",
          relevantLogs.split("\n\n").length,
          "）"
        );
      }
    }

    // 前回セッションの続きとして開始する場合
    if (previousSession) {
      systemPrompt +=
        `\n\n【前回セッションのコンテキスト】\n` +
        `ユーザーは前回（${previousSession.date}）に「${previousSession.title}」を学びました。\n` +
        `要約: ${previousSession.summary}\n` +
        `重要な学び: ${previousSession.keyLearnings}\n\n` +
        `会話の最初に前回の内容を簡潔に振り返り、「今日はどこから続けますか？」と問いかけてください。`;
    }

    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(new TextEncoder().encode(event.delta.text));
            }
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
