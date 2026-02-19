import { useMemo } from "react";
import { SyntaxStyle } from "@opentui/core";
import { theme } from "../theme";
import { LOADING_SPINNER_FRAMES } from "../constants";
import { stripCommandMarkup } from "../utils/command";
import { outputHeightLines } from "../utils/command";
import { CommandBlockView } from "./CommandBlockView";
import type { Message, CommandBlock } from "../types";
import type { UseChatReturn } from "../hooks/useChat";

interface ChatTimelineProps {
  chat: UseChatReturn;
}

type TimelineItem =
  | { type: "message"; message: Message; index: number }
  | { type: "block"; block: CommandBlock; blockIndex: number };

export function ChatTimeline({ chat }: ChatTimelineProps) {
  const {
    messages,
    commandBlocks,
    collapsedBlockIds,
    setRunningCommandCollapsed,
    loadingFrame,
    streaming,
    runningCommand,
    runningCommandCollapsed,
    commandOutput,
    isWaiting,
    toggleBlockCollapsed,
  } = chat;

  const syntaxStyle = useMemo(() => SyntaxStyle.create(), []);

  const items: TimelineItem[] = [];
  let blockCounter = 0;
  messages.forEach((msg, i) => {
    items.push({ type: "message", message: msg, index: i });
    const blocksAfterThis = commandBlocks.filter((b) => b.afterMessageIndex === i);
    blocksAfterThis.forEach((block) => items.push({ type: "block", block, blockIndex: blockCounter++ }));
  });

  return (
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
      {items.map((item) => {
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
                        content={stripCommandMarkup(msg.content) || " "}
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
        return (
          <CommandBlockView
            key={`block-${block.afterMessageIndex}-${blockIndex}`}
            block={block}
            blockId={blockId}
            isCollapsed={isCollapsed}
            onToggleCollapsed={() => toggleBlockCollapsed(blockId)}
          />
        );
      })}
      {runningCommand && (
        <box paddingX={1} paddingY={0} flexDirection="column" gap={0} flexShrink={0} border borderStyle="single" borderColor={theme.border} backgroundColor={theme.bgElevated} marginX={2}>
          <box paddingX={0} paddingY={0} minHeight={1} flexDirection="row" alignItems="center" gap={1}>
            <box
              focusable
              onMouseDown={(e: { preventDefault: () => void }) => {
                e.preventDefault();
                setRunningCommandCollapsed((c: boolean) => !c);
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
  );
}
