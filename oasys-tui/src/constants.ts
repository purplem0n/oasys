/** Braille-style spinner: bold and highly visible */
export const LOADING_SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
export const LOADING_SPINNER_INTERVAL_MS = 60;

export const SLASH_COMMANDS: { name: string; description: string; value: string }[] = [
  { name: "/new", description: "Start a new empty chat room", value: "new" },
  { name: "/mode", description: "Switch Chat or Terminal Agent mode", value: "mode" },
  { name: "/setup", description: "Set Google AI API key", value: "setup" },
  { name: "/model", description: "Select model", value: "model" },
  { name: "/history", description: "Open chat history", value: "history" },
  { name: "/thinking", description: "Toggle thinking/reasoning mode", value: "thinking" },
  { name: "/websearch", description: "Toggle web search", value: "websearch" },
];

export const SERVER_PORT = 9990;
export const DEFAULT_MODEL_KEY = "gemini-flash-lite-latest";
