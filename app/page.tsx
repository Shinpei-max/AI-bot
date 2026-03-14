"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

type SessionSummary = {
  topic: string;
  summary: string;
  tags: string[];
};

type StudySession = {
  id: string;
  title: string;
  date: string;
  summary: string;
  tags: string[];
  industries: string[];
  level: string;
  keyLearnings: string;
  durationMinutes: number | null;
};

const LEVEL_LABEL: Record<string, string> = {
  beginner: "初級",
  intermediate: "中級",
  advanced: "上級",
};

const LEVEL_COLOR: Record<string, string> = {
  beginner: "bg-green-900 text-green-300",
  intermediate: "bg-yellow-900 text-yellow-300",
  advanced: "bg-red-900 text-red-300",
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}時間${m}分`;
  if (h > 0) return `${h}時間`;
  return `${m}分`;
}

function getTodayDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSummary, setSavedSummary] = useState<SessionSummary | null>(null);
  const [todayDate] = useState(() => getTodayDate());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // セッション計測
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!sessionStartTime) return;
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - sessionStartTime.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStartTime]);

  // 学習履歴
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<StudySession[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [previousSession, setPreviousSession] = useState<StudySession | null>(null);

  // 学習分析
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisSessionCount, setAnalysisSessionCount] = useState(0);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // 学習履歴を取得
  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch("/api/study-history");
      if (!res.ok) throw new Error("履歴の取得に失敗しました");
      const data = await res.json();
      setHistory(data.sessions ?? []);
    } catch (e) {
      alert(`履歴の取得に失敗しました: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  const handleToggleHistory = useCallback(() => {
    if (!showHistory && history.length === 0) {
      loadHistory();
    }
    setShowHistory((prev) => !prev);
  }, [showHistory, history.length, loadHistory]);

  // 前回の続きから始める
  const handleContinueSession = useCallback(
    (session: StudySession) => {
      setPreviousSession(session);
      setMessages([]);
      setShowHistory(false);

      // Botからのウェルカムメッセージを即時表示
      const welcomeMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `前回（${session.date}）の「${session.title}」の続きから始めます。\n\nまず軽く振り返ってから始めましょう！`,
        timestamp: new Date(),
      };
      setMessages([welcomeMsg]);

      // 実際の振り返りメッセージを API 経由で取得
      const sendContinueMessage = async () => {
        setIsLoading(true);
        const assistantId = crypto.randomUUID();
        const triggerMessage = {
          role: "user",
          content: "前回の続きから始めたいです。振り返りをお願いします。",
          timestamp: new Date().toISOString(),
        };
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [triggerMessage],
              previousSession: session,
            }),
          });
          if (!res.ok) throw new Error("API エラー");

          setMessages([
            {
              id: assistantId,
              role: "assistant",
              content: "",
              timestamp: new Date(),
            },
          ]);

          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let rafId: number | null = null;

          const flush = () => {
            if (buffer.length === 0) return;
            const toFlush = buffer;
            buffer = "";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + toFlush }
                  : m
              )
            );
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (rafId !== null) cancelAnimationFrame(rafId);
              flush();
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
              rafId = null;
              flush();
            });
          }
        } catch {
          // ウェルカムメッセージはそのまま残す
        } finally {
          setIsLoading(false);
        }
      };

      sendContinueMessage();
    },
    []
  );

  // 学習分析
  const handleAnalyzeProgress = useCallback(async () => {
    setShowAnalysis(true);
    if (analysis && !analysis.startsWith("エラー:")) return; // 正常取得済みなら再取得しない
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/analyze-progress", { method: "POST" });
      if (!res.ok) throw new Error("分析に失敗しました");
      const data = await res.json();
      setAnalysis(data.analysis ?? "");
      setAnalysisSessionCount(data.sessionCount ?? 0);
    } catch (e) {
      setAnalysis(`エラー: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [analysis]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    if (!sessionStartTime) setSessionStartTime(new Date());

    const assistantId = crypto.randomUUID();
    try {
      const apiMessages = [...messages, userMessage].map((m) => ({
        ...m,
        timestamp:
          m.timestamp instanceof Date
            ? m.timestamp.toISOString()
            : m.timestamp,
      }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          previousSession: previousSession ?? undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", timestamp: new Date() },
      ]);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let rafId: number | null = null;

      const flush = () => {
        if (buffer.length === 0) return;
        const toFlush = buffer;
        buffer = "";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + toFlush } : m
          )
        );
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (rafId !== null) cancelAnimationFrame(rafId);
          flush();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          flush();
        });
      }
    } catch (e) {
      setMessages((prev) => {
        const hasAssistant = prev.some((m) => m.id === assistantId);
        const errorMsg: Message = {
          id: hasAssistant ? assistantId : crypto.randomUUID(),
          role: "assistant",
          content: `エラーが発生しました: ${e instanceof Error ? e.message : "Unknown error"}`,
          timestamp: new Date(),
        };
        return hasAssistant
          ? prev.map((m) => (m.id === assistantId ? errorMsg : m))
          : [...prev, errorMsg];
      });
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, previousSession, sessionStartTime]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        if (e.nativeEvent.isComposing) return;
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleSaveSession = useCallback(async () => {
    if (messages.length === 0 || isSaving) return;

    setIsSaving(true);
    setSavedSummary(null);

    try {
      const apiMessages = messages.map((m) => ({
        ...m,
        timestamp:
          m.timestamp instanceof Date
            ? m.timestamp.toISOString()
            : m.timestamp,
      }));
      const res = await fetch("/api/save-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          date: todayDate,
          durationMinutes: sessionStartTime
            ? Math.max(1, Math.round((Date.now() - sessionStartTime.getTime()) / 60000))
            : null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setSavedSummary({
        topic: data.summary.topic,
        summary: data.summary.summary,
        tags: data.summary.tags ?? [],
      });
      // 履歴キャッシュをクリアして次回再取得させる
      setHistory([]);
      setAnalysis("");
      setTimeout(() => setSavedSummary(null), 5000);
    } catch (e) {
      alert(
        `保存に失敗しました: ${e instanceof Error ? e.message : "Unknown error"}`
      );
    } finally {
      setIsSaving(false);
    }
  }, [messages, todayDate, isSaving]);

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* 学習履歴サイドバー */}
      {showHistory && (
        <aside className="flex w-80 flex-shrink-0 flex-col border-r border-gray-800 bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
            <h2 className="font-semibold text-gray-200">学習履歴</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={loadHistory}
                disabled={isLoadingHistory}
                className="text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
                title="更新"
              >
                更新
              </button>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="text-gray-500 hover:text-gray-300"
              >
                ✕
              </button>
            </div>
          </div>

          {/* 累計時間サマリー */}
          {history.length > 0 && (() => {
            const total = history.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
            return total > 0 ? (
              <div className="border-b border-gray-800 bg-gray-950 px-4 py-3 text-center">
                <p className="text-xs text-gray-500">累計学習時間</p>
                <p className="text-lg font-bold text-green-400">{formatMinutes(total)}</p>
                <p className="text-xs text-gray-600">{history.filter(s => s.durationMinutes).length}セッション</p>
              </div>
            ) : null;
          })()}

          <div className="flex-1 overflow-y-auto">
            {isLoadingHistory ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">
                読み込み中...
              </p>
            ) : history.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">
                記録がありません
              </p>
            ) : (
              <ul className="divide-y divide-gray-800">
                {history.map((session) => (
                  <li key={session.id} className="p-4">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-gray-200 leading-snug">
                        {session.title.replace(/^\d{4}-\d{2}-\d{2} - /, "")}
                      </p>
                      {session.level && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                            LEVEL_COLOR[session.level] ??
                            "bg-gray-700 text-gray-300"
                          }`}
                        >
                          {LEVEL_LABEL[session.level] ?? session.level}
                        </span>
                      )}
                    </div>
                    <div className="mb-2 flex items-center gap-2">
                      <p className="text-xs text-gray-500">{session.date}</p>
                      {session.durationMinutes != null && (
                        <span className="rounded bg-green-900/50 px-1.5 py-0.5 text-xs text-green-400">
                          {formatMinutes(session.durationMinutes)}
                        </span>
                      )}
                    </div>
                    {session.tags.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1">
                        {session.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {session.summary && (
                      <p className="mb-2 text-xs text-gray-400 line-clamp-2">
                        {session.summary}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => handleContinueSession(session)}
                      className="w-full rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 transition"
                    >
                      この回の続きから始める
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      )}

      {/* メインコンテンツ */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggleHistory}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                showHistory
                  ? "bg-gray-700 text-gray-200"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              📚 学習履歴
            </button>
            <button
              type="button"
              onClick={handleAnalyzeProgress}
              className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 hover:bg-gray-700 transition"
            >
              📊 学習分析
            </button>
          </div>

          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold">AI勉強ボット📚</h1>
            <span className="text-sm text-gray-400">{todayDate}</span>
            {sessionStartTime && (
              <span className="rounded bg-green-900 px-2 py-0.5 text-xs text-green-300">
                今日: {formatDuration(elapsedSeconds)}
              </span>
            )}
            {previousSession && (
              <span className="rounded bg-blue-900 px-2 py-0.5 text-xs text-blue-300">
                続き: {previousSession.date}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleSaveSession}
            disabled={messages.length === 0 || isSaving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "保存中..." : "Notionに保存"}
          </button>
        </header>

        {savedSummary && (
          <div className="mx-4 mt-4 rounded-lg border border-gray-700 bg-gray-900 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300">保存完了</h2>
              <button
                type="button"
                onClick={() => setSavedSummary(null)}
                className="text-gray-500 hover:text-gray-300"
              >
                ✕
              </button>
            </div>
            <p className="mb-1 text-sm text-gray-400">
              <span className="font-medium text-gray-300">トピック:</span>{" "}
              {savedSummary.topic}
            </p>
            <p className="mb-2 text-sm text-gray-400">
              <span className="font-medium text-gray-300">要約:</span>{" "}
              {savedSummary.summary}
            </p>
            <div className="flex flex-wrap gap-1">
              {savedSummary.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.length === 0 && !isLoading && (
              <p className="text-center text-gray-500">
                AI勉強を始めましょう。Enterで送信、Shift+Enterで改行です。
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-4 py-2 ${
                    m.role === "user" ? "bg-blue-600" : "bg-gray-800"
                  }`}
                >
                  {m.role === "user" ? (
                    <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                  ) : (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-gray-800 px-4 py-2">
                  <p className="text-sm text-gray-400">考え中...</p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>

        <div className="border-t border-gray-800 bg-gray-900 p-4">
          <div className="mx-auto max-w-3xl">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="メッセージを入力..."
              rows={2}
              className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={isLoading}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                送信
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 学習分析モーダル */}
      {showAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
              <div>
                <h2 className="font-semibold text-gray-200">学習進捗分析</h2>
                {analysisSessionCount > 0 && (
                  <p className="text-xs text-gray-500">
                    {analysisSessionCount}件のセッションを分析
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setAnalysis(""); setIsAnalyzing(false); handleAnalyzeProgress(); }}
                  disabled={isAnalyzing}
                  className="text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
                >
                  再分析
                </button>
                <button
                  type="button"
                  onClick={() => setShowAnalysis(false)}
                  className="text-gray-500 hover:text-gray-300"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {isAnalyzing ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <p className="text-gray-400">Notionの記録を分析中...</p>
                  <p className="text-xs text-gray-600">少々お待ちください</p>
                </div>
              ) : (
                <div className="prose prose-invert prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-300">
                    {analysis}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
