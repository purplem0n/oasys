import React, { useEffect, useRef, useState } from "react";
import {
  fetchModels,
  streamChat,
  listConversations,
  getConversationWithMessages,
  type AIModel,
  type ToolCallPayload,
  type ConversationListItem,
} from "../api";
import { loadConfig, saveConfig, getOrCreateUserId } from "../config";
import { getSystemInfo, getExtendedSystemInfo, formatSystemInfoShort, formatSystemInfoJSON, type SystemInfo } from "../systemInfo";
import { runCommand } from "../utils/command";
import { DEFAULT_MODEL_KEY, LOADING_SPINNER_FRAMES, LOADING_SPINNER_INTERVAL_MS } from "../constants";
import type { AppMode, Message, CommandBlock } from "../types";

export interface UseChatReturn {
  // State
  messages: Message[];
  inputValue: string;
  setInputValue: (v: string | ((prev: string) => string)) => void;
  streaming: boolean;
  models: AIModel[];
  modelIndex: number;
  setModelIndex: (v: number | ((prev: number) => number)) => void;
  conversationId: string | null;
  latestTotalTokens: number | null;
  error: string | null;
  setError: (v: string | null) => void;
  mode: AppMode;
  setMode: (v: AppMode | ((prev: AppMode) => AppMode)) => void;
  showModeSelect: boolean;
  setShowModeSelect: (v: boolean) => void;
  showCommandPalette: boolean;
  setShowCommandPalette: (v: boolean) => void;
  runningCommand: string | null;
  runningCommandCollapsed: boolean;
  setRunningCommandCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  commandOutput: string;
  commandBlocks: CommandBlock[];
  collapsedBlockIds: Set<string>;
  setCollapsedBlockIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  loadingFrame: number;
  systemInfo: SystemInfo;
  userId: string;
  apiKey: string;
  setApiKey: (v: string) => void;
  showSetupPrompt: boolean;
  setShowSetupPrompt: (v: boolean) => void;
  setupApiKeyValue: string;
  setSetupApiKeyValue: (v: string) => void;
  showModelSelect: boolean;
  setShowModelSelect: (v: boolean) => void;
  showHistoryList: boolean;
  setShowHistoryList: (v: boolean) => void;
  historyList: ConversationListItem[];
  setHistoryList: React.Dispatch<React.SetStateAction<ConversationListItem[]>>;
  historyLoading: boolean;
  historyError: string | null;
  setHistoryError: (v: string | null) => void;
  historyOpeningChat: boolean;
  setHistoryOpeningChat: (v: boolean) => void;
  thinkingEnabled: boolean;
  setThinkingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  webSearchEnabled: boolean;
  setWebSearchEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  // Actions
  sendMessage: (submitValue?: string) => Promise<void>;
  saveSetupApiKey: () => void;
  openHistoryAndLoad: () => void;
  selectModelByKey: (modelKey: string) => void;
  openConversation: (conversationId: string) => Promise<void>;
  runCommandFromPalette: (value: string) => void;
  toggleBlockCollapsed: (blockId: string) => void;
  // Derived
  model: AIModel | undefined;
  modelKey: string;
  tokenCounterText: string;
  isEmpty: boolean;
  systemInfoShort: string;
  isWaiting: boolean;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [models, setModels] = useState<AIModel[]>([]);
  const [modelIndex, setModelIndex] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [latestTotalTokens, setLatestTotalTokens] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AppMode>("Terminal Agent");
  const [showModeSelect, setShowModeSelect] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [runningCommandCollapsed, setRunningCommandCollapsed] = useState(false);
  const [commandOutput, setCommandOutput] = useState("");
  const [commandBlocks, setCommandBlocks] = useState<CommandBlock[]>([]);
  const [collapsedBlockIds, setCollapsedBlockIds] = useState<Set<string>>(new Set());
  const [loadingFrame, setLoadingFrame] = useState(0);
  const assistantIndexRef = useRef(0);
  const [systemInfo, setSystemInfo] = useState<SystemInfo>(() => getSystemInfo());

  const [userId] = useState<string>(() => getOrCreateUserId());
  const [apiKey, setApiKey] = useState<string>(() => loadConfig().googleApiKey ?? "");
  const [showSetupPrompt, setShowSetupPrompt] = useState(() => !loadConfig().googleApiKey);
  const [setupApiKeyValue, setSetupApiKeyValue] = useState("");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [showHistoryList, setShowHistoryList] = useState(false);
  const [historyList, setHistoryList] = useState<ConversationListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyOpeningChat, setHistoryOpeningChat] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);

  useEffect(() => {
    getExtendedSystemInfo().then(() => {
      setSystemInfo({ ...getSystemInfo() });
    });
  }, []);

  const isWaiting = Boolean(streaming || runningCommand || historyOpeningChat || historyLoading);
  useEffect(() => {
    if (!isWaiting) return;
    const interval = setInterval(() => {
      setLoadingFrame((f) => (f + 1) % LOADING_SPINNER_FRAMES.length);
    }, LOADING_SPINNER_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isWaiting]);
  const systemInfoShort = formatSystemInfoShort(systemInfo);

  useEffect(() => {
    fetchModels()
      .then((r) => {
        const list = r.gemini ?? [];
        setModels(list);
        if (list.length) {
          const idx = list.findIndex((m) => m.modelKey === DEFAULT_MODEL_KEY);
          setModelIndex(idx >= 0 ? idx : 0);
        }
      })
      .catch((e) => setError(String(e.message)));
  }, []);

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
    rephrase?: boolean;
  }): Promise<{
    pendingToolCalls: ToolCallPayload[];
    conversationIdFromStream: string | null;
    expectedToolCallMissing?: boolean;
  }> => {
    const model = models[modelIndex]?.modelKey ?? DEFAULT_MODEL_KEY;
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
      rephrase: params.rephrase,
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
        .then((r) => setHistoryList(r.data ?? []))
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
      const maxRephraseAttempts = 8;
      let rephraseAttemptsLeft = maxRephraseAttempts;
      while (result.expectedToolCallMissing && currentCid && mode === "Terminal Agent" && rephraseAttemptsLeft > 0) {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") next[next.length - 1] = { ...last, content: "" };
          return next;
        });
        result = await runStreamLoop({
          appendAssistantContent,
          currentConversationId: currentCid,
          internalRetry: true,
          rephrase: true,
        });
        currentCid = result.conversationIdFromStream ?? currentCid;
        if (result.pendingToolCalls.length > 0) break;
        if (!result.expectedToolCallMissing) break;
        rephraseAttemptsLeft--;
        if (rephraseAttemptsLeft <= 0) {
          appendAssistantContent("\n\n(Still no command run after several attempts. Try rephrasing your request.)");
        }
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

  const saveSetupApiKey = () => {
    saveConfig({ googleApiKey: setupApiKeyValue.trim() || undefined });
    setApiKey(setupApiKeyValue.trim());
    setShowSetupPrompt(false);
  };

  const openHistoryAndLoad = () => {
    setShowHistoryList(true);
    setHistoryError(null);
    setHistoryList([]);
    setHistoryLoading(true);
    listConversations(userId)
      .then((r) => setHistoryList(r.data ?? []))
      .catch((e) => setHistoryError(e instanceof Error ? e.message : String(e)))
      .finally(() => setHistoryLoading(false));
  };

  const selectModelByKey = (modelKey: string) => {
    const idx = models.findIndex((m) => m.modelKey === modelKey);
    if (idx >= 0) setModelIndex(idx);
  };

  const openConversation = async (convId: string) => {
    setHistoryOpeningChat(true);
    try {
      const res = await getConversationWithMessages(convId, userId);
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
  };

  const runCommandFromPalette = (value: string) => {
    setShowCommandPalette(false);
    setInputValue("");
    if (value === "new") {
      setConversationId(null);
      setMessages([]);
      setCommandBlocks([]);
      setError(null);
      setLatestTotalTokens(null);
    }
    if (value === "mode") setShowModeSelect(true);
    if (value === "setup") {
      setSetupApiKeyValue(apiKey);
      setShowSetupPrompt(true);
    }
    if (value === "model") setShowModelSelect(true);
    if (value === "history") openHistoryAndLoad();
    if (value === "thinking") setThinkingEnabled((prev) => !prev);
    if (value === "websearch") setWebSearchEnabled((prev) => !prev);
  };

  const toggleBlockCollapsed = (blockId: string) => {
    setCollapsedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  };

  return {
    messages,
    inputValue,
    setInputValue,
    streaming,
    models,
    modelIndex,
    setModelIndex,
    conversationId,
    latestTotalTokens,
    error,
    setError,
    mode,
    setMode,
    showModeSelect,
    setShowModeSelect,
    showCommandPalette,
    setShowCommandPalette,
    runningCommand,
    runningCommandCollapsed,
    setRunningCommandCollapsed,
    commandOutput,
    commandBlocks,
    collapsedBlockIds,
    setCollapsedBlockIds,
    loadingFrame,
    systemInfo,
    userId,
    apiKey,
    setApiKey,
    showSetupPrompt,
    setShowSetupPrompt,
    setupApiKeyValue,
    setSetupApiKeyValue,
    showModelSelect,
    setShowModelSelect,
    showHistoryList,
    setShowHistoryList,
    historyList,
    setHistoryList,
    historyLoading,
    historyError,
    setHistoryError,
    historyOpeningChat,
    setHistoryOpeningChat,
    thinkingEnabled,
    setThinkingEnabled,
    webSearchEnabled,
    setWebSearchEnabled,
    sendMessage,
    saveSetupApiKey,
    openHistoryAndLoad,
    selectModelByKey,
    openConversation,
    runCommandFromPalette,
    toggleBlockCollapsed,
    model,
    modelKey,
    tokenCounterText,
    isEmpty,
    systemInfoShort,
    isWaiting,
  };
}
