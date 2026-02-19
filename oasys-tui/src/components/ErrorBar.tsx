import { theme } from "../theme";

interface ErrorBarProps {
  error: string;
}

export function ErrorBar({ error }: ErrorBarProps) {
  return (
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
  );
}
