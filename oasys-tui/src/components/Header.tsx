import { theme } from "../theme";
import type { AppMode } from "../types";

interface HeaderProps {
  mode: AppMode;
  thinkingEnabled: boolean;
  webSearchEnabled: boolean;
  tokenCounterText: string;
  modelKey: string;
}

export function Header({ mode, thinkingEnabled, webSearchEnabled, tokenCounterText, modelKey }: HeaderProps) {
  return (
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
}
