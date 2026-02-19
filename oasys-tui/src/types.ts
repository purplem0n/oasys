export type AppMode = "Chat" | "Terminal Agent";

export type Message = { role: "user" | "assistant"; content: string };

export type CommandBlock = { command: string; output: string; afterMessageIndex: number };
