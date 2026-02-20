import { theme } from "../theme";
import { LOADING_SPINNER_FRAMES, SLASH_COMMANDS } from "../constants";
import type { AIModel } from "../api";
import type { ConversationListItem } from "../api";
import type { UseChatReturn } from "../hooks/useChat";

interface InputRowProps {
  chat: UseChatReturn;
}

export function InputRow({ chat }: InputRowProps) {
  const {
    showSetupPrompt,
    setupApiKeyValue,
    setSetupApiKeyValue,
    saveSetupApiKey,
    showModelSelect,
    setShowModelSelect,
    models,
    selectModelByKey,
    showHistoryList,
    setShowHistoryList,
    historyLoading,
    historyError,
    historyOpeningChat,
    historyList,
    openConversation,
    runningCommand,
    streaming,
    inputValue,
    setInputValue,
    setShowCommandPalette,
    showCommandPalette,
    sendMessage,
    apiKey,
    loadingFrame,
    runCommandFromPalette,
  } = chat;

  if (showSetupPrompt) {
    return (
      <box flexDirection="column" gap={0} flexShrink={0}>
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
              onSubmit={saveSetupApiKey}
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
      </box>
    );
  }

  if (showModelSelect) {
    return (
      <box flexDirection="column" gap={0} flexShrink={0}>
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
                ...models.map((m: AIModel) => ({
                  name: m.modelKey,
                  description: m.appDisplayName || m.description || "",
                  value: m.modelKey,
                })),
              ]}
              height={Math.min(12, models.length + 2)}
              onSelect={(_index: number, option) => {
                setShowModelSelect(false);
                if (option?.value && option.value !== "__cancel__") {
                  selectModelByKey(option.value);
                }
              }}
              focused
              selectedBackgroundColor={theme.border}
              selectedTextColor={theme.text}
            />
          </box>
        </box>
      </box>
    );
  }

  if (showHistoryList) {
    return (
      <box flexDirection="column" gap={0} flexShrink={0}>
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
                  ...historyList.map((c: ConversationListItem) => ({
                    name: (c.name || c.id).slice(0, 48),
                    description: `${c.messages_count} msgs · ${c.updated_at?.slice(0, 19) ?? ""}`,
                    value: c.id,
                  })),
                ]}
                height={Math.min(16, historyList.length + 2)}
                onSelect={async (_index: number, option) => {
                  if (!option?.value || option.value === "__cancel__") {
                    setShowHistoryList(false);
                    return;
                  }
                  await openConversation(option.value);
                }}
                focused
                selectedBackgroundColor={theme.border}
                selectedTextColor={theme.text}
              />
            </box>
          )}
        </box>
      </box>
    );
  }

  if (runningCommand) {
    return (
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
    );
  }

  if (streaming) {
    return (
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
    );
  }

  return (
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
          onInput={(value: string) => {
            setInputValue(value);
            setShowCommandPalette(value.startsWith("/"));
          }}
          onChange={(value: string) => {
            setInputValue(value);
            setShowCommandPalette(value.startsWith("/"));
          }}
          onSubmit={(valueOrEvent: string | unknown) => {
            const value = typeof valueOrEvent === "string" ? valueOrEvent : undefined;
            sendMessage(value);
          }}
          placeholder={!apiKey ? "Set API key: type / then choose /setup" : "Ask anything here (type / for commands)"}
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
                : SLASH_COMMANDS.filter((c) => c.name.toLowerCase().startsWith(inputValue.toLowerCase()))),
            ]}
            height={12}
            onSelect={(_index: number, option) => {
              if (option?.value) runCommandFromPalette(option.value);
            }}
            focused
            selectedBackgroundColor={theme.border}
            selectedTextColor={theme.text}
          />
        </box>
      )}
    </box>
  );
}
