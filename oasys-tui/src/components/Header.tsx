import { getAppVersion } from "../constants";
import { theme } from "../theme";

interface HeaderProps {
  thinkingEnabled: boolean;
  webSearchEnabled: boolean;
  tokenCounterText: string;
  modelKey: string;
}

export function Header({ thinkingEnabled, webSearchEnabled, tokenCounterText, modelKey }: HeaderProps) {
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
        <span fg={theme.accent}>oasys v{getAppVersion()}</span>
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
