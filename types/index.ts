export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

export type SessionSummary = {
  topic: string;
  summary: string;
  tags: string[];
  industries?: string[];
  level?: string;
  keyLearnings?: string[];
};
