import { Str } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";

export type AppContext = Context<{ Bindings: Env }>;

// Helper to properly parse boolean strings from form data
// Handles "true", "false", "1", "0", and actual booleans
const booleanFromString = z.preprocess(
	(val) => {
		if (typeof val === "boolean") return val;
		if (typeof val === "string") {
			const lower = val.toLowerCase().trim();
			if (lower === "true" || lower === "1") return true;
			if (lower === "false" || lower === "0" || lower === "") return false;
		}
		if (typeof val === "number") return val !== 0;
		return val;
	},
	z.boolean(),
);

export const ToolResultSchema = z.object({
	toolCallId: z.string(),
	toolName: z.string(),
	result: z.unknown(),
	isError: z.boolean().optional().default(false),
});

export const ChatStreamTextSchema = z.object({
	userId: Str({
		example: "machineId_randomString",
		description: "Opaque client identifier used as auth token.",
	}),
	conversationId: z
		.string()
		.uuid()
		.optional()
		.describe("Existing conversation to continue; omit to start new."),
	prompt: Str({ example: "Write a vegetarian lasagna recipe for 4 people." }).optional(),
	model: z.string(),
	mode: z
		.enum(["chat", "terminal_agent"])
		.optional()
		.default("chat")
		.describe("Chat: normal conversation. terminal_agent: assist with running commands (run_command tool)."),
	systemInfo: z
		.string()
		.optional()
		.describe("JSON string of system context (OS, hardware) for terminal_agent mode."),
	toolResults: z.preprocess(
		(val) => {
			if (val == null || val === "") return undefined;
			if (typeof val === "string") {
				try {
					return JSON.parse(val) as unknown;
				} catch {
					return val;
				}
			}
			return val;
		},
		z.array(ToolResultSchema).optional(),
	).optional().describe("Tool execution results from client; used to continue after tool calls (e.g. run_command)."),
	webSearch: booleanFromString
		.optional()
		.default(true)
		.describe("Enable web search tool."),
	thinking: booleanFromString
		.optional()
		.default(true)
		.describe("Enable thinking/reasoning mode."),
	thinkingValue: z
		.union([z.string(), z.number()])
		.optional()
		.describe("Thinking parameter value (e.g., 'low'/'high' for thinkingLevel, or 0/-1 for thinkingBudget)."),
	urlContext: booleanFromString
		.optional()
		.default(false)
		.describe("Enable URL context fetching for URLs in the prompt."),
	internalRetry: booleanFromString
		.optional()
		.describe("Internal: retry after expectedToolCallMissing. Retry prompt is not saved to chat history."),
	rephrase: booleanFromString
		.optional()
		.describe("When used with internalRetry: rephrase the last user message to elicit a tool call; prompt may be omitted."),
	googleGenerativeAiApiKey: z
		.string()
		.optional()
		.describe("User-provided Google Generative AI API key. If provided, will be used instead of environment variable."),
	aiGatewayApiKey: z
		.string()
		.optional()
		.describe("User-provided AI Gateway API key. If provided, will use Vercel AI Gateway instead of direct Model Provider API."),
});
