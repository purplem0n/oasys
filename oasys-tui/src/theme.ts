/** Sleek dark theme (Tokyo Night–inspired) */
export const theme = {
  bg: "#16161e",
  bgElevated: "#1a1b26",
  border: "#3b4261",
  text: "#c0caf5",
  muted: "#565f89",
  user: "#7aa2f7",
  assistant: "#9ece6a",
  accent: "#bb9af7",
  error: "#f7768e",
  /** Bright cyan for loading indicators – high contrast on dark bg */
  loading: "#7dcfff",
} as const;

export type Theme = typeof theme;
