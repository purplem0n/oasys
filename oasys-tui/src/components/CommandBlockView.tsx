import { theme } from "../theme";
import { outputHeightLines } from "../utils/command";
import type { CommandBlock } from "../types";

interface CommandBlockViewProps {
  block: CommandBlock;
  blockId: string;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}

export function CommandBlockView({ block, blockId, isCollapsed, onToggleCollapsed }: CommandBlockViewProps) {
  const contentHeight = outputHeightLines(block.output);
  return (
    <box
      key={`block-${blockId}`}
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
          onMouseDown={(e: { preventDefault: () => void }) => {
            e.preventDefault();
            onToggleCollapsed();
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
      {!isCollapsed && (
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
      )}
    </box>
  );
}
