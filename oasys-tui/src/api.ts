const API_BASE = "http://localhost:9990";

export type AIModel = {
  appDisplayName: string;
  purpose: string;
  modelKey: string;
  description: string;
  maxInputTokens?: number;
};

export type ModelsResponse = {
  gemini: AIModel[];
};

export type LatestTokenUsage = {
  id: string;
  messageId: string;
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  createdAt: string;
  updatedAt: string;
};

export type ConversationListItem = {
  id: string;
  userId: string;
  name: string;
  messages_count: number;
  published: boolean;
  deleted: boolean;
  created_at: string;
  updated_at: string;
  latestTokenUsage?: LatestTokenUsage | null;
};

export type ConversationListResponse = {
  data: ConversationListItem[];
};

export type MessageItem = {
  id: string;
  conversation_id: string;
  content: string;
  role: string;
  compiled: boolean;
  is_summary: boolean;
  created_at: string;
  updated_at: string;
};

export type ConversationWithMessages = {
  data: ConversationListItem & { messages: MessageItem[] };
};

export async function fetchModels(): Promise<ModelsResponse> {
  const res = await fetch(`${API_BASE}/models`);
  if (!res.ok) throw new Error(`Models: ${res.status}`);
  return res.json() as Promise<ModelsResponse>;
}

export async function listConversations(userId: string): Promise<ConversationListResponse> {
  const res = await fetch(`${API_BASE}/conversations?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`Conversations: ${res.status}`);
  return res.json() as Promise<ConversationListResponse>;
}

export async function getConversationWithMessages(
  conversationId: string,
  userId: string
): Promise<ConversationWithMessages> {
  const res = await fetch(
    `${API_BASE}/conversations/${encodeURIComponent(conversationId)}/messages?userId=${encodeURIComponent(userId)}`
  );
  if (!res.ok) throw new Error(`Conversation: ${res.status}`);
  return res.json() as Promise<ConversationWithMessages>;
}

export type ToolCallPayload = { toolCallId: string; toolName: string; args?: { command?: string }; input?: { command?: string } };
export type StreamEvent =
  | { event: "chatOutput"; data: string }
  | { event: "conversationId"; data: string }
  | { event: "error"; data: string }
  | { event: "chatFinish"; data: string }
  | { event: "tokenUsage"; data: string }
  | { event: "toolCalls"; data: string }
  | { event: string; data: unknown };

export async function streamChat(params: {
  userId: string;
  prompt?: string;
  model: string;
  conversationId?: string;
  mode?: "chat" | "terminal_agent";
  systemInfo?: string;
  toolResults?: Array<{ toolCallId: string; toolName: string; result: unknown; isError?: boolean }>;
  webSearch?: boolean;
  thinking?: boolean;
  urlContext?: boolean;
  /** Internal retry after expectedToolCallMissing; retry prompt not saved to history */
  internalRetry?: boolean;
  googleGenerativeAiApiKey?: string;
}): Promise<ReadableStream<StreamEvent>> {
  const body = new URLSearchParams();
  body.set("userId", params.userId);
  body.set("model", params.model);
  if (params.prompt !== undefined) body.set("prompt", params.prompt);
  if (params.conversationId) body.set("conversationId", params.conversationId);
  if (params.mode) body.set("mode", params.mode);
  if (params.systemInfo) body.set("systemInfo", params.systemInfo);
  if (params.toolResults !== undefined && params.toolResults.length > 0) {
    body.set("toolResults", JSON.stringify(params.toolResults));
  }
  if (params.webSearch !== undefined) body.set("webSearch", String(params.webSearch));
  if (params.thinking !== undefined) body.set("thinking", String(params.thinking));
  if (params.urlContext !== undefined) body.set("urlContext", String(params.urlContext));
  if (params.internalRetry !== undefined) body.set("internalRetry", String(params.internalRetry));
  if (params.googleGenerativeAiApiKey) body.set("googleGenerativeAiApiKey", params.googleGenerativeAiApiKey);

  const res = await fetch(`${API_BASE}/chat/stream-text`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat: ${res.status} ${text}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<StreamEvent>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        let enqueued = false;
        for (const line of lines) {
          const raw = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const parsed = JSON.parse(raw) as StreamEvent;
            controller.enqueue(parsed);
            enqueued = true;
          } catch {
            // skip malformed
          }
        }
        if (enqueued) return;
      }
    },
  });
}
