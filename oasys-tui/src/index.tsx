import { createCliRenderer, SyntaxStyle } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { serve } from "@hono/node-server";
import app from "./server";
import { ensureDb } from "./server/utils/drizzle";
import {
  fetchModels,
  streamChat,
  listConversations,
  getConversationWithMessages,
  type AIModel,
  type ToolCallPayload,
  type ConversationListItem,
} from "./api";
import { loadConfig, saveConfig, getOrCreateUserId } from "./config";
import { getSystemInfo, getExtendedSystemInfo, formatSystemInfoShort, formatSystemInfoJSON, type SystemInfo } from "./systemInfo";

const SERVER_PORT = 9990;
serve({ fetch: app.fetch, port: SERVER_PORT }, (info) => {
  ensureDb().catch((err) => console.error("DB init failed:", err));
  console.log(`Server running at http://localhost:${info.port}`);
});

// Braille-style spinner: bold and highly visible
const LOADING_SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
const LOADING_SPINNER_INTERVAL_MS = 60;

type AppMode = "Chat" | "Terminal Agent";

const SLASH_COMMANDS: { name: string; description: string; value: string }[] = [
  { name: "/new", description: "Start a new empty chat room", value: "new" },
  { name: "/mode", description: "Switch Chat or Terminal Agent mode", value: "mode" },
  { name: "/setup", description: "Set Google AI API key", value: "setup" },
  { name: "/model", description: "Select model", value: "model" },
  { name: "/history", description: "Open chat history", value: "history" },
  { name: "/thinking", description: "Toggle thinking/reasoning mode", value: "thinking" },
  { name: "/websearch", description: "Toggle web search", value: "websearch" },
];

// Sleek dark theme (Tokyo Night–inspired)
const theme = {
  bg: "#16161e",
  bgElevated: "#1a1b26",
  border: "#3b4261",
  text: "#c0caf5",
  muted: "#565f89",
  user: "#7aa2f7",
  assistant: "#9ece6a",
  accent: "#bb9af7",
  error: "#f7768e",
  /** Bright cyan for loading indicators – high contrast on dark bg */
  loading: "#7dcfff",
} as const;

type Message = { role: "user" | "assistant"; content: string };

type CommandBlock = { command: string; output: string; afterMessageIndex: number };

/** Number of lines to show for command output (min 2, max 20). */
function outputHeightLines(output: string): number {
  const lines = output?.trim() ? output.split("\n").length : 0;
  return Math.min(20, Math.max(2, lines || 1));
}

type RunCommandOpts = {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

// Run a shell command on the user's local machine. Inherits process.env so PATH (e.g. Homebrew) is available.
// Optional onStdout/onStderr are called with chunks in real time.
async function runCommand(
  command: string,
  cwd: string,
  opts: RunCommandOpts = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { onStdout, onStderr } = opts;
  const env = { ...process.env };
  try {
    const Bun = (globalThis as unknown as {
      Bun?: {
        spawn: (cmd: string[], opts: { cwd: string; stdout: "pipe"; stderr: "pipe"; env?: Record<string, string | undefined> }) => {
          exited: Promise<{ exitCode: number }>;
          stdout: ReadableStream<Uint8Array>;
          stderr: ReadableStream<Uint8Array>;
        };
      };
    }).Bun;
    if (Bun?.spawn) {
      const shell = process.platform === "win32" ? "cmd.exe" : "sh";
      const args = process.platform === "win32" ? ["/c", command] : ["-c", command];
      const sub = Bun.spawn([shell, ...args], { cwd, stdout: "pipe", stderr: "pipe", env });
      const decoder = new TextDecoder();
      const drain = async (stream: ReadableStream<Uint8Array>, cb: (chunk: string) => void): Promise<string> => {
        const reader = stream.getReader();
        let out = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const s = decoder.decode(value, { stream: true });
            out += s;
            cb(s);
          }
        } finally {
          reader.releaseLock();
        }
        return out;
      };
      const [exited, stdout, stderr] = await Promise.all([
        sub.exited,
        drain(sub.stdout, (chunk) => onStdout?.(chunk)),
        drain(sub.stderr, (chunk) => onStderr?.(chunk)),
      ]);
      return { stdout, stderr, exitCode: exited.exitCode ?? 0 };
    }
    const cp = (globalThis as unknown as { require?: (id: string) => { spawn: (cmd: string, args: string[], opts: { cwd: string; shell: boolean; env?: NodeJS.ProcessEnv }) => { stdout: { on: (e: string, fn: (d: Buffer) => void) => void }; stderr: { on: (e: string, fn: (d: Buffer) => void) => void }; on: (e: string, fn: (code: number) => void) => void } } }).require?.("child_process");
    if (cp?.spawn) {
      const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
      const args = process.platform === "win32" ? ["/c", command] : ["-c", command];
      const child = cp.spawn(shell, args, { cwd, shell: true, env });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => {
        const s = d.toString();
        stdout += s;
        onStdout?.(s);
      });
      child.stderr?.on("data", (d: Buffer) => {
        const s = d.toString();
        stderr += s;
        onStderr?.(s);
      });
      return new Promise((resolve) => {
        child.on("close", (code: number) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
      });
    }
  } catch {
    // fallthrough
  }
  return { stdout: "", stderr: "Could not run command (no Bun or child_process)", exitCode: 1 };
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [models, setModels] = useState<AIModel[]>([]);
  const [modelIndex, setModelIndex] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(null);
  /** Latest token_usages row total_tokens for current conversation (no extra computation). */
  const [latestTotalTokens, setLatestTotalTokens] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AppMode>("Terminal Agent");
  const [showModeSelect, setShowModeSelect] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [runningCommandCollapsed, setRunningCommandCollapsed] = useState(false);
  const [commandOutput, setCommandOutput] = useState("");
  const [commandBlocks, setCommandBlocks] = useState<CommandBlock[]>([]);
  /** Block ids that are collapsed (default: none, so all expanded). Id = `${afterMessageIndex}-${blockIndex}`. */
  const [collapsedBlockIds, setCollapsedBlockIds] = useState<Set<string>>(new Set());
  const [loadingFrame, setLoadingFrame] = useState(0);
  const assistantIndexRef = useRef(0);
  const [systemInfo, setSystemInfo] = useState<SystemInfo>(() => getSystemInfo());
  useEffect(() => {
    getExtendedSystemInfo().then(() => {
      setSystemInfo({ ...getSystemInfo() });
    });
  }, []);

  // Client userId (generated once, persisted)
  const [userId] = useState<string>(() => getOrCreateUserId());
  // Config: API key (persisted)
  const [apiKey, setApiKey] = useState<string>(() => loadConfig().googleApiKey ?? "");
  // /setup dialog; open automatically when no API key
  const [showSetupPrompt, setShowSetupPrompt] = useState(() => !loadConfig().googleApiKey);
  const [setupApiKeyValue, setSetupApiKeyValue] = useState("");
  // /model dialog
  const [showModelSelect, setShowModelSelect] = useState(false);
  // /history dialog
  const [showHistoryList, setShowHistoryList] = useState(false);
  const [historyList, setHistoryList] = useState<ConversationListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyOpeningChat, setHistoryOpeningChat] = useState(false);
  // Toggles (no UI toggle for urlContext; it is auto when message has URL)
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);

  const isWaiting = streaming || runningCommand || historyOpeningChat || historyLoading;
  useEffect(() => {
    if (!isWaiting) return;
    const interval = setInterval(() => {
      setLoadingFrame((f) => (f + 1) % LOADING_SPINNER_FRAMES.length);
    }, LOADING_SPINNER_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isWaiting]);
  const systemInfoShort = formatSystemInfoShort(systemInfo);

  const defaultModelKey = "gemini-flash-lite-latest";

  useEffect(() => {
    fetchModels()
      .then((r) => {
        const list = r.gemini ?? [];
        setModels(list);
        if (list.length) {
          const idx = list.findIndex((m) => m.modelKey === defaultModelKey);
          setModelIndex(idx >= 0 ? idx : 0);
        }
      })
      .catch((e) => setError(String(e.message)));
  }, []);

  // When an error is shown, ensure we're not stuck in streaming/running state so the input always comes back
  useEffect(() => {
    if (error) {
      setStreaming(false);
      setRunningCommand(null);
      setRunningCommandCollapsed(false);
    }
  }, [error]);

  const runStreamLoop = async (params: {
    prompt?: string;
    toolResults?: Array<{ toolCallId: string; toolName: string; result: unknown; isError?: boolean }>;
    appendAssistantContent: (chunk: string) => void;
    currentConversationId: string | null;
    internalRetry?: boolean;
  }): Promise<{
    pendingToolCalls: ToolCallPayload[];
    conversationIdFromStream: string | null;
    expectedToolCallMissing?: boolean;
  }> => {
    const model = models[modelIndex]?.modelKey ?? defaultModelKey;
    const promptText = params.prompt ?? "";
    const urlContextAuto = /https?:\/\/[^\s]+/.test(promptText);
    const stream = await streamChat({
      userId,
      prompt: params.prompt,
      model,
      conversationId: params.currentConversationId ?? undefined,
      mode: mode === "Terminal Agent" ? "terminal_agent" : "chat",
      systemInfo: mode === "Terminal Agent" ? formatSystemInfoJSON(systemInfo) : undefined,
      toolResults: params.toolResults,
      webSearch: webSearchEnabled,
      thinking: thinkingEnabled,
      urlContext: urlContextAuto || undefined,
      internalRetry: params.internalRetry,
      googleGenerativeAiApiKey: apiKey || undefined,
    });
    const reader = stream.getReader();
    let assistantContent = "";
    let pendingToolCalls: ToolCallPayload[] = [];
    let conversationIdFromStream: string | null = null;
    let expectedToolCallMissing = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.event === "chatOutput" && typeof value.data === "string") {
          assistantContent += value.data;
          params.appendAssistantContent(assistantContent);
        } else if (value.event === "conversationId" && typeof value.data === "string") {
          conversationIdFromStream = value.data;
          setConversationId(value.data);
        } else if (value.event === "error" && typeof value.data === "string") {
          setError(value.data);
        } else if (value.event === "toolCalls" && typeof value.data === "string") {
          try {
            pendingToolCalls = JSON.parse(value.data) as ToolCallPayload[];
          } catch {
            setError("Invalid toolCalls from server");
          }
        } else if (value.event === "chatFinish" && typeof value.data === "string") {
          try {
            const payload = JSON.parse(value.data) as {
              success?: boolean;
              emptyResponse?: boolean;
              expectedToolCallMissing?: boolean;
            };
            if (payload.emptyResponse && !assistantContent.trim()) {
              params.appendAssistantContent("(No response from model. Try rephrasing or sending another message.)");
            } else if (payload.expectedToolCallMissing && !params.internalRetry) {
              expectedToolCallMissing = true;
            } else if (payload.expectedToolCallMissing && params.internalRetry) {
              params.appendAssistantContent("\n\n(Still no command run. Try rephrasing your request.)");
            }
          } catch {
            // ignore parse errors for chatFinish
          }
        } else if (value.event === "tokenUsage" && typeof value.data === "string") {
          try {
            const usage = JSON.parse(value.data) as { totalTokens?: number };
            if (typeof usage.totalTokens === "number") setLatestTotalTokens(usage.totalTokens);
          } catch {
            // ignore parse errors for tokenUsage
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return {
      pendingToolCalls,
      conversationIdFromStream: conversationIdFromStream ?? params.currentConversationId,
      expectedToolCallMissing: expectedToolCallMissing || undefined,
    };
  };

  const sendMessage = async (submitValue?: string) => {
    let raw = (submitValue ?? inputValue).trim();
    if (raw === "/new" || raw.startsWith("/new ")) {
      setConversationId(null);
      setMessages([]);
      setCommandBlocks([]);
      setCollapsedBlockIds(new Set());
      setError(null);
      setLatestTotalTokens(null);
      setInputValue("");
      return;
    }
    if (raw === "/mode" || raw.startsWith("/mode ")) {
      setShowModeSelect(true);
      setInputValue("");
      return;
    }
    if (raw === "/setup" || raw.startsWith("/setup ")) {
      setSetupApiKeyValue(apiKey);
      setShowSetupPrompt(true);
      setInputValue("");
      return;
    }
    if (raw === "/model" || raw.startsWith("/model ")) {
      setShowModelSelect(true);
      setInputValue("");
      return;
    }
    if (raw === "/history" || raw.startsWith("/history ")) {
      setShowHistoryList(true);
      setHistoryError(null);
      setHistoryList([]);
      setHistoryLoading(true);
      setInputValue("");
      listConversations(userId)
        .then((r) => {
          setHistoryList(r.data ?? []);
        })
        .catch((e) => setHistoryError(e instanceof Error ? e.message : String(e)))
        .finally(() => setHistoryLoading(false));
      return;
    }
    if (raw === "/thinking" || raw.startsWith("/thinking ")) {
      setThinkingEnabled((prev) => !prev);
      setInputValue("");
      return;
    }
    if (raw === "/websearch" || raw.startsWith("/websearch ")) {
      setWebSearchEnabled((prev) => !prev);
      setInputValue("");
      return;
    }
    if (!apiKey) return;
    if (!raw || streaming || runningCommand || !models.length) return;

    const prompt = raw;
    setInputValue("");
    setError(null);
    setCommandOutput("");
    setMessages((prev) => [...prev, { role: "user", content: prompt }, { role: "assistant", content: "" }]);
    setStreaming(true);

    // Index of the assistant message we're streaming to (ref so it stays correct across awaits).
    assistantIndexRef.current = messages.length + 1;

    const appendAssistantContent = (content: string) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") next[next.length - 1] = { ...last, content };
        return next;
      });
    };

    try {
      let currentCid: string | null = conversationId;
      let result = await runStreamLoop({ prompt, appendAssistantContent, currentConversationId: currentCid });
      currentCid = result.conversationIdFromStream ?? currentCid;
      // Auto-retry once when model was expected to run a command but did not (retry not saved to history)
      if (result.expectedToolCallMissing && currentCid && mode === "Terminal Agent") {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") next[next.length - 1] = { ...last, content: "" };
          return next;
        });
        const retryPrompt = `You must use the run_command tool now. User asked: "${prompt}". Call run_command with the appropriate command. Do not reply with only text.`;
        result = await runStreamLoop({
          prompt: retryPrompt,
          appendAssistantContent,
          currentConversationId: currentCid,
          internalRetry: true,
        });
        currentCid = result.conversationIdFromStream ?? currentCid;
      }
      while (result.pendingToolCalls.length > 0 && mode === "Terminal Agent" && currentCid) {
        const cwd = typeof process !== "undefined" ? process.cwd() : ".";
        const toolResults: Array<{ toolCallId: string; toolName: string; result: unknown; isError?: boolean }> = [];
        for (const call of result.pendingToolCalls) {
          if (call.toolName === "run_command") {
            const raw = call.args ?? call.input;
            const cmd = (typeof raw === "object" && raw && "command" in raw && typeof (raw as { command: string }).command === "string")
              ? (raw as { command: string }).command
              : String(raw ?? "");
            setRunningCommand(cmd);
            setCommandOutput("");
            const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, {
              onStdout: (chunk) => setCommandOutput((prev) => prev + chunk),
              onStderr: (chunk) => setCommandOutput((prev) => prev + chunk),
            });
            setRunningCommand(null);
            setRunningCommandCollapsed(false);
            const output = stdout + (stderr ? `\n${stderr}` : "");
            setCommandBlocks((prev) => [...prev, { command: cmd, output, afterMessageIndex: assistantIndexRef.current }]);
            setCommandOutput("");
            toolResults.push({ toolCallId: call.toolCallId, toolName: call.toolName, result: { stdout, stderr, exitCode }, isError: exitCode !== 0 });
          } else {
            toolResults.push({ toolCallId: call.toolCallId, toolName: call.toolName, result: { error: "Unknown tool" }, isError: true });
          }
        }
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
        assistantIndexRef.current += 1;
        result = await runStreamLoop({ toolResults, appendAssistantContent, currentConversationId: currentCid });
        currentCid = result.conversationIdFromStream ?? currentCid;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
      setRunningCommand(null);
      setRunningCommandCollapsed(false);
    }
  };

  const model = models[modelIndex];
  const modelKey = model?.modelKey ?? "—";
  const maxInput = model?.maxInputTokens ?? 1_048_576;
  const currentTotal = latestTotalTokens ?? 0;
  const percent = maxInput > 0 ? Math.round((currentTotal / maxInput) * 100) : 0;
  const tokenCounterText = `${currentTotal} (${percent}%)/${maxInput}`;
  const isEmpty = messages.length === 0;
  const syntaxStyle = useMemo(() => SyntaxStyle.create(), []);

  const header = (
    <box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingX={1}
      paddingY={0}
      minHeight={2}
      border
      borderStyle="single"
      borderColor={theme.border}
      backgroundColor={theme.bgElevated}
    >
      <text>
        <span fg={theme.accent}>oasys</span>
        <span fg={theme.muted}> · </span>
        <span fg={theme.text}>Mode: {mode}</span>
        {thinkingEnabled && (
          <>
            <span fg={theme.muted}> · </span>
            <span fg={theme.assistant}>thinking</span>
          </>
        )}
        {webSearchEnabled && (
          <>
            <span fg={theme.muted}> · </span>
            <span fg={theme.assistant}>web</span>
          </>
        )}
      </text>
      <text>
        <span fg={theme.muted}>{tokenCounterText}</span>
        <span fg={theme.muted}> · </span>
        <span fg={theme.muted}>{modelKey}</span>
      </text>
    </box>
  );

  const systemInfoBar = (
    <box
      flexDirection="row"
      paddingX={1}
      paddingY={0}
      minHeight={1}
      flexShrink={0}
      backgroundColor={theme.bg}
    >
      <text>
        <span fg={theme.muted}>{systemInfoShort}</span>
      </text>
    </box>
  );

  const inputRow = (
    <box flexDirection="column" gap={0} flexShrink={0}>
      {showSetupPrompt ? (
        <box
          flexDirection="column"
          gap={0}
          flexShrink={0}
          border
          borderStyle="single"
          borderColor={theme.border}
          backgroundColor={theme.bgElevated}
        >
          <box paddingX={1} paddingY={1}>
            <text>
              <span fg={theme.muted}>Google AI API Key (Enter to save, Esc to cancel): </span>
            </text>
          </box>
          <box flexDirection="row" paddingX={1} paddingY={0} alignItems="center" gap={1}>
            <input
              value={setupApiKeyValue}
              onInput={(v) => setSetupApiKeyValue(v)}
              onChange={(v) => setSetupApiKeyValue(v)}
              onSubmit={() => {
                saveConfig({ googleApiKey: setupApiKeyValue.trim() || undefined });
                setApiKey(setupApiKeyValue.trim());
                setShowSetupPrompt(false);
              }}
              placeholder="Paste your API key"
              focused
              flexGrow={1}
              backgroundColor={theme.bg}
              textColor={theme.text}
              placeholderColor={theme.muted}
              cursorColor={theme.accent}
            />
          </box>
        </box>
      ) : showModelSelect ? (
        <box
          flexDirection="column"
          gap={0}
          flexShrink={0}
          border
          borderStyle="single"
          borderColor={theme.border}
          backgroundColor={theme.bgElevated}
        >
          <box paddingX={1} paddingY={1}>
            <text>
              <span fg={theme.muted}>Select model (↑↓ Enter): </span>
            </text>
          </box>
          <box paddingX={1}>
            <select
              options={[
                { name: "Cancel", description: "Close", value: "__cancel__" },
                ...models.map((m) => ({
                  name: m.modelKey,
                  description: m.appDisplayName || m.description || "",
                  value: m.modelKey,
                })),
              ]}
              height={Math.min(12, models.length + 2)}
              onSelect={(_index, option) => {
                setShowModelSelect(false);
                if (option?.value && option.value !== "__cancel__") {
                  const idx = models.findIndex((m) => m.modelKey === option.value);
                  if (idx >= 0) setModelIndex(idx);
                }
              }}
              focused
              selectedBackgroundColor={theme.border}
              selectedTextColor={theme.text}
            />
          </box>
        </box>
      ) : showHistoryList ? (
        <box
          flexDirection="column"
          gap={0}
          flexShrink={0}
          border
          borderStyle="single"
          borderColor={theme.border}
          backgroundColor={theme.bgElevated}
        >
          <box paddingX={1} paddingY={1}>
            <text>
              {historyOpeningChat ? (
                <>
                  <span fg={theme.loading}>{LOADING_SPINNER_FRAMES[loadingFrame]}</span>
                  <span fg={theme.loading}> Loading chat…</span>
                </>
              ) : (
                <span fg={theme.muted}>
                  {historyLoading ? (
                    <>
                      <span fg={theme.loading}>{LOADING_SPINNER_FRAMES[loadingFrame]}</span>
                      <span fg={theme.loading}> Loading…</span>
                    </>
                  ) : historyError ? (
                    historyError
                  ) : (
                    "Select chat to open (↑↓ Enter):"
                  )}
                </span>
              )}
            </text>
          </box>
          {!historyLoading && !historyError && !historyOpeningChat && (
            <box paddingX={1}>
              <select
                options={[
                  { name: "Cancel", description: "Close", value: "__cancel__" },
                  ...historyList.map((c) => ({
                    name: (c.name || c.id).slice(0, 48),
                    description: `${c.messages_count} msgs · ${c.updated_at?.slice(0, 19) ?? ""}`,
                    value: c.id,
                  })),
                ]}
                height={Math.min(16, historyList.length + 2)}
                onSelect={async (_index, option) => {
                  if (!option?.value || option.value === "__cancel__") {
                    setShowHistoryList(false);
                    return;
                  }
                  setHistoryOpeningChat(true);
                  try {
                    const res = await getConversationWithMessages(option.value as string, userId);
                    const conv = res.data;
                    const msgs: Message[] = (conv.messages ?? [])
                      .filter((m) => m.role === "user" || m.role === "assistant")
                      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content ?? "" }));
                    setConversationId(conv.id);
                    setMessages(msgs);
                    setCommandBlocks([]);
                    setCollapsedBlockIds(new Set());
                    setLatestTotalTokens(conv.latestTokenUsage?.totalTokens ?? null);
                    setShowHistoryList(false);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                    setShowHistoryList(false);
                  } finally {
                    setHistoryOpeningChat(false);
                  }
                }}
                focused
                selectedBackgroundColor={theme.border}
                selectedTextColor={theme.text}
              />
            </box>
          )}
        </box>
      ) : showModeSelect ? (
        <box
          flexDirection="column"
          gap={0}
          flexShrink={0}
          border
          borderStyle="single"
          borderColor={theme.border}
          backgroundColor={theme.bgElevated}
        >
          <box paddingX={1} paddingY={1}>
            <text>
              <span fg={theme.muted}>Select mode (↑↓ Enter): </span>
            </text>
          </box>
          <box paddingX={1}>
            <select
              options={[
                { name: "Chat", description: "Normal conversation", value: "Chat" },
                { name: "Terminal Agent", description: "Run commands in your terminal", value: "Terminal Agent" },
              ]}
              height={6}
              onSelect={(_index, option) => {
                setMode((option?.value as AppMode) ?? "Chat");
                setShowModeSelect(false);
              }}
              focused
              selectedBackgroundColor={theme.border}
              selectedTextColor={theme.text}
            />
          </box>
        </box>
      ) : runningCommand ? (
    <box
      flexDirection="row"
      alignItems="center"
      gap={1}
      paddingX={1}
      paddingY={0}
      minHeight={2}
      flexShrink={0}
      border
      borderStyle="single"
      borderColor={theme.border}
      backgroundColor={theme.bgElevated}
    >
      <text>
        <span fg={theme.accent}>›</span>
      </text>
      <box flexGrow={1} paddingX={1}>
        <text>
          <span fg={theme.muted}>Running command… </span>
          <span fg={theme.text}>{runningCommand}</span>
        </text>
      </box>
    </box>
  ) : streaming ? (
    <box
      flexDirection="row"
      alignItems="center"
      gap={1}
      paddingX={1}
      paddingY={0}
      minHeight={2}
      flexShrink={0}
      border
      borderStyle="single"
      borderColor={theme.border}
      backgroundColor={theme.bgElevated}
    >
      <text>
        <span fg={theme.accent}>›</span>
      </text>
      <box flexGrow={1} paddingX={1}>
        <text>
          <span fg={theme.muted}>Waiting for response…</span>
        </text>
      </box>
      <text>
        <span fg={theme.muted}>↵</span>
      </text>
    </box>
  ) : (
    <box flexDirection="column" gap={0} flexShrink={0}>
      <box
        flexDirection="row"
        alignItems="center"
        gap={1}
        paddingX={1}
        paddingY={0}
        minHeight={2}
        border
        borderStyle="single"
        borderColor={theme.border}
        backgroundColor={theme.bgElevated}
      >
        <text>
          <span fg={theme.accent}>›</span>
        </text>
        <input
          value={inputValue}
          onInput={(value) => {
            setInputValue(value);
            setShowCommandPalette(value.startsWith("/"));
          }}
          onChange={(value) => {
            setInputValue(value);
            setShowCommandPalette(value.startsWith("/"));
          }}
          onSubmit={(value) => sendMessage(typeof value === "string" ? value : undefined)}
          placeholder={!apiKey ? "Set API key: type / then choose /setup" : mode === "Terminal Agent" ? "Ask anything here (type / for commands)" : "Message… (type / for commands)"}
          focused={!showCommandPalette}
          flexGrow={1}
          backgroundColor={theme.bg}
          textColor={theme.text}
          placeholderColor={theme.muted}
          cursorColor={theme.accent}
        />
        <text>
          <span fg={theme.muted}>↵</span>
        </text>
      </box>
      {showCommandPalette && (
        <box paddingX={1} paddingY={0} minHeight={5} flexDirection="column" gap={0} border borderStyle="single" borderColor={theme.border} backgroundColor={theme.bgElevated}>
          <box paddingY={0}>
            <text>
              <span fg={theme.muted}>Commands (↑↓ choose, Enter select): </span>
            </text>
          </box>
          <select
            options={[
              { name: "Cancel", description: "Close", value: "__cancel__" },
              ...(inputValue === "/" || inputValue === ""
                ? SLASH_COMMANDS
                : SLASH_COMMANDS.filter((c) =>
                    c.name.toLowerCase().startsWith(inputValue.toLowerCase()),
                  )),
            ]}
            height={12}
            onSelect={(_index, option) => {
              setShowCommandPalette(false);
              setInputValue("");
              if (option?.value === "new") {
                setConversationId(null);
                setMessages([]);
                setCommandBlocks([]);
                setError(null);
                setLatestTotalTokens(null);
              }
              if (option?.value === "mode") setShowModeSelect(true);
              if (option?.value === "setup") {
                setSetupApiKeyValue(apiKey);
                setShowSetupPrompt(true);
              }
              if (option?.value === "model") setShowModelSelect(true);
              if (option?.value === "history") {
                setShowHistoryList(true);
                setHistoryError(null);
                setHistoryList([]);
                setHistoryLoading(true);
                listConversations(userId)
                  .then((r) => setHistoryList(r.data ?? []))
                  .catch((e) => setHistoryError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setHistoryLoading(false));
              }
              if (option?.value === "thinking") setThinkingEnabled((prev) => !prev);
              if (option?.value === "websearch") setWebSearchEnabled((prev) => !prev);
            }}
            focused
            selectedBackgroundColor={theme.border}
            selectedTextColor={theme.text}
          />
        </box>
      )}
    </box>
  )}
    </box>
  );

  if (isEmpty) {
    return (
      <box
        flexDirection="column"
        flexGrow={1}
        width="100%"
        height="100%"
        backgroundColor={theme.bg}
      >
        {header}
        <box
          flexGrow={1}
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
        >
          <box flexDirection="column" width={64} alignItems="center" gap={1}>
            <ascii-font text="OASYS" font="slick" color={theme.accent} />
            <text>
              {apiKey ? (
                <span fg={theme.muted}>An AI agent for system assistant via terminal.</span>
              ) : (
                <span fg={theme.muted}>Set your Google AI API key to start. Type / and choose /setup.</span>
              )}
            </text>
            <box flexDirection="row" alignItems="center" marginTop={1}>
              <text>
                <span fg={theme.muted}>model </span>
                <span fg={theme.text}>{modelKey}</span>
              </text>
            </box>
            {error && (
              <box marginTop={1} paddingX={1}>
                <text>
                  <span fg={theme.error}>{error}</span>
                </text>
              </box>
            )}
          </box>
        </box>
        {systemInfoBar}
        {inputRow}
      </box>
    );
  }

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      height="100%"
      width="100%"
      backgroundColor={theme.bg}
    >
      {header}

      <scrollbox
        flexGrow={1}
        flexShrink={1}
        minHeight={8}
        stickyScroll
        stickyStart="bottom"
        style={{
          rootOptions: { backgroundColor: theme.bg },
          wrapperOptions: { backgroundColor: theme.bg },
          viewportOptions: { backgroundColor: theme.bg },
          contentOptions: { backgroundColor: theme.bg },
          scrollbarOptions: {
            showArrows: false,
            trackOptions: {
              foregroundColor: theme.border,
              backgroundColor: theme.bgElevated,
            },
          },
        }}
      >
        {(() => {
          // Build a stable interleaved timeline: message 0, blocks after 0, message 1, blocks after 1, ...
          // So command blocks are separate list items and never get replaced by streaming message updates.
          type TimelineItem = { type: "message"; message: Message; index: number } | { type: "block"; block: CommandBlock; blockIndex: number };
          const items: TimelineItem[] = [];
          let blockCounter = 0;
          messages.forEach((msg, i) => {
            items.push({ type: "message", message: msg, index: i });
            const blocksAfterThis = commandBlocks.filter((b) => b.afterMessageIndex === i);
            blocksAfterThis.forEach((block) => items.push({ type: "block", block, blockIndex: blockCounter++ }));
          });
          return items.map((item) => {
            if (item.type === "message") {
              const { message: msg, index: i } = item;
              const isLastAssistant = msg.role === "assistant" && i === messages.length - 1;
              const showLoadingInline = isLastAssistant && isWaiting && !msg.content;
              const showContent = msg.role === "assistant" && (msg.content || (isLastAssistant && isWaiting && msg.content));
              return (
                <box key={`msg-${i}`} flexDirection="column" gap={0} flexShrink={0}>
                  <box paddingX={2} paddingY={1} flexDirection="row">
                    <text>
                      {msg.role === "user" ? (
                        <>
                          <span fg={theme.user}>▸ </span>
                          <span fg={theme.text}>{msg.content}</span>
                        </>
                      ) : (
                        <>
                          <span fg={theme.assistant}>▸ </span>
                        </>
                      )}
                    </text>
                    {msg.role === "assistant" && (showLoadingInline || showContent) && (
                      <box flexGrow={1} flexDirection="row" alignItems="center" gap={1}>
                        {showLoadingInline ? (
                          <text>
                            <span fg={theme.loading}>{LOADING_SPINNER_FRAMES[loadingFrame]}</span>
                            <span fg={theme.loading}>
                              {runningCommand ? ` Running: ${runningCommand}` : " Thinking…"}
                            </span>
                          </text>
                        ) : (
                          <markdown
                            content={msg.content || " "}
                            syntaxStyle={syntaxStyle}
                            streaming={streaming && isLastAssistant}
                            conceal
                          />
                        )}
                      </box>
                    )}
                  </box>
                </box>
              );
            }
            const { block, blockIndex } = item;
            const blockId = `${block.afterMessageIndex}-${blockIndex}`;
            const isCollapsed = collapsedBlockIds.has(blockId);
            const toggleCollapsed = () => {
              setCollapsedBlockIds((prev) => {
                const next = new Set(prev);
                if (next.has(blockId)) next.delete(blockId);
                else next.add(blockId);
                return next;
              });
            };
            return (
              <box
                key={`block-${block.afterMessageIndex}-${blockIndex}`}
                paddingX={1}
                paddingY={0}
                flexDirection="column"
                gap={0}
                flexShrink={0}
                border
                borderStyle="single"
                borderColor={theme.border}
                backgroundColor={theme.bgElevated}
                marginX={2}
              >
                <box paddingX={0} paddingY={0} minHeight={1} flexDirection="row" alignItems="center" gap={1}>
                  <box
                    focusable
                    onMouseDown={(e) => {
                      e.preventDefault();
                      toggleCollapsed();
                    }}
                    paddingX={0}
                    paddingY={0}
                  >
                    <text>
                      <span fg={theme.accent}>{isCollapsed ? "▶" : "▼"}</span>
                    </text>
                  </box>
                  <text>
                    <span fg={theme.muted}>Command: </span>
                    <span fg={theme.text}>{block.command}</span>
                  </text>
                </box>
                {!isCollapsed && (() => {
                  const contentHeight = outputHeightLines(block.output);
                  return (
                  <box paddingX={0} paddingY={0} minHeight={2} height={1 + contentHeight} flexDirection="column" gap={0}>
                    <box paddingY={0} flexShrink={0}>
                      <text>
                        <span fg={theme.muted}>Output:</span>
                      </text>
                    </box>
                    <box paddingY={0} paddingX={0} minHeight={1} height={contentHeight}>
                      <scrollbox
                        height={contentHeight}
                        stickyScroll
                        stickyStart="bottom"
                        style={{
                          rootOptions: { backgroundColor: theme.bgElevated },
                          wrapperOptions: { backgroundColor: theme.bgElevated },
                          viewportOptions: { backgroundColor: theme.bgElevated },
                          contentOptions: { backgroundColor: theme.bgElevated },
                          scrollbarOptions: {
                            showArrows: false,
                            trackOptions: { foregroundColor: theme.border, backgroundColor: theme.bg },
                          },
                        }}
                      >
                        <text>
                          <span fg={theme.text}>{block.output ? `\n${block.output}` : ""}</span>
                        </text>
                      </scrollbox>
                    </box>
                  </box>
                  );
                })()}
              </box>
            );
          });
        })()}
        {runningCommand && (
          <box paddingX={1} paddingY={0} flexDirection="column" gap={0} flexShrink={0} border borderStyle="single" borderColor={theme.border} backgroundColor={theme.bgElevated} marginX={2}>
            <box paddingX={0} paddingY={0} minHeight={1} flexDirection="row" alignItems="center" gap={1}>
              <box
                focusable
                onMouseDown={(e) => {
                  e.preventDefault();
                  setRunningCommandCollapsed((c) => !c);
                }}
                paddingX={0}
                paddingY={0}
              >
                <text>
                  <span fg={theme.accent}>{runningCommandCollapsed ? "▶" : "▼"}</span>
                </text>
              </box>
              <text>
                <span fg={theme.accent}>⏳</span>
                <span fg={theme.muted}> Running: </span>
                <span fg={theme.text}>{runningCommand}</span>
              </text>
            </box>
            {!runningCommandCollapsed && (() => {
              const contentHeight = outputHeightLines(commandOutput || " ");
              return (
              <box paddingX={0} paddingY={0} minHeight={2} height={1 + contentHeight} flexDirection="column" gap={0}>
                <box paddingY={0} flexShrink={0}>
                  <text>
                    <span fg={theme.muted}>Output:</span>
                  </text>
                </box>
                <box paddingY={0} paddingX={0} minHeight={1} height={contentHeight}>
                  <scrollbox
                    height={contentHeight}
                    stickyScroll
                    stickyStart="bottom"
                    style={{
                      rootOptions: { backgroundColor: theme.bgElevated },
                      wrapperOptions: { backgroundColor: theme.bgElevated },
                      viewportOptions: { backgroundColor: theme.bgElevated },
                      contentOptions: { backgroundColor: theme.bgElevated },
                      scrollbarOptions: {
                        showArrows: false,
                        trackOptions: { foregroundColor: theme.border, backgroundColor: theme.bg },
                      },
                    }}
                  >
                    <text>
                      <span fg={theme.text}>{commandOutput ? `\n${commandOutput}` : "…"}</span>
                    </text>
                  </scrollbox>
                </box>
              </box>
              );
            })()}
          </box>
        )}
      </scrollbox>

      {error && (
        <box
          paddingX={2}
          paddingY={1}
          backgroundColor={theme.bgElevated}
          border
          borderStyle="single"
          borderColor={theme.border}
        >
          <text>
            <span fg={theme.error}>{error}</span>
          </text>
        </box>
      )}

      {systemInfoBar}
      {inputRow}
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
