import { useChat } from "./hooks/useChat";
import { theme } from "./theme";
import { Header, SystemInfoBar, InputRow, ErrorBar, EmptyState, ChatTimeline } from "./components";

export function App() {
  const chat = useChat();
  const { isEmpty, error } = chat;

  if (isEmpty) {
    return (
      <box
        flexDirection="column"
        flexGrow={1}
        width="100%"
        height="100%"
        backgroundColor={theme.bg}
      >
        <Header
          thinkingEnabled={chat.thinkingEnabled}
          webSearchEnabled={chat.webSearchEnabled}
          tokenCounterText={chat.tokenCounterText}
          modelKey={chat.modelKey}
        />
        <EmptyState apiKey={chat.apiKey} modelKey={chat.modelKey} error={error} />
        <SystemInfoBar systemInfoShort={chat.systemInfoShort} />
        <InputRow chat={chat} />
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
      <Header
        thinkingEnabled={chat.thinkingEnabled}
        webSearchEnabled={chat.webSearchEnabled}
        tokenCounterText={chat.tokenCounterText}
        modelKey={chat.modelKey}
      />
      <ChatTimeline chat={chat} />
      {error && <ErrorBar error={error} />}
      <SystemInfoBar systemInfoShort={chat.systemInfoShort} />
      <InputRow chat={chat} />
    </box>
  );
}
