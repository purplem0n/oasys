import { theme } from "../theme";

interface EmptyStateProps {
  apiKey: string;
  modelKey: string;
  error: string | null;
}

export function EmptyState({ apiKey, modelKey, error }: EmptyStateProps) {
  return (
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
  );
}
