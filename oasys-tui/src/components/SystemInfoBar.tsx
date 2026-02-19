import { theme } from "../theme";

interface SystemInfoBarProps {
  systemInfoShort: string;
}

export function SystemInfoBar({ systemInfoShort }: SystemInfoBarProps) {
  return (
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
}
