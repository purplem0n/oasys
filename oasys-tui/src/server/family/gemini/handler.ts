import { z } from "zod";
import {
	type AppContext,
	ChatStreamTextSchema as AIStreamSchema,
} from "../../endpoints/chat/chat-types";
import {
	type GoogleGenerativeAIProviderOptions,
	createGoogleGenerativeAI,
	google,
} from "@ai-sdk/google";
import {
	createGateway,
	generateText,
	streamText,
	tool,
	type AssistantModelMessage,
	type ModelMessage,
	type ToolContent,
	type UserModelMessage,
} from "ai";
import {
	type ConversationSelect,
	type MessageSelect,
	conversationDb,
	messageDb,
	tokenUsageDb,
} from "../../utils/db";
import { streamSSE } from 'hono/streaming'
import { geminiModels } from "./handler-models";
import type { AIModel } from "../../types/model-types";
import { apiLog } from "../../logger";

const SSE_HEADERS = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-cache",
	Connection: "keep-alive",
};

const encoder = new TextEncoder();

const wrapJsonColumn = <T>(value: T | null | undefined) =>
	value === undefined || value === null
		? null
		: ({ value } satisfies Record<string, unknown>);

const createSseErrorResponse = (message: string, status = 400) => {
	const errorStream = new ReadableStream({
		start(controller) {
			controller.enqueue(
				encoder.encode(
					`data: ${JSON.stringify({ error: message })}\n\n`,
				),
			);
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});

	return new Response(errorStream, {
		status,
		headers: SSE_HEADERS,
	});
};

const getConversationName = (prompt: string) => {
	const trimmed = prompt.trim();
	if (!trimmed) {
		return `Conversation ${new Date().toISOString()}`;
	}

	return trimmed.slice(0, 50);
};

const findModelConfig = (modelKey: string): AIModel | undefined => {
	return geminiModels.find((m) => m.modelKey === modelKey);
};

const TERMINAL_AGENT_SYSTEM = `You are a Terminal Agent that helps users configure their system and run commands, especially on Linux but also on any OS. You assist by suggesting and running shell commands in the user's current working directory.

Tool usage (critical):
- run_command: Use this for ANY action that must run on the user's machine. You MUST invoke the tool (make a tool call)—do not write "run_command:..." or the tool name in your message text. The command only runs when you actually call the tool. Examples: checking if something is installed (which X, X --version), listing files, reading configs. Do NOT use web search to simulate command output—only run_command gives you actual output from this machine.
- Web search (if available): Use only for general knowledge, documentation, or pasted errors. Never use web search when the correct action is to execute a command on the user's machine (e.g. "is Python installed?" → invoke run_command with "which python", not a search). To use web search you must invoke the web search tool—do not write "google_search", "web search", or any search syntax inside <command> or in your message; that does nothing.

Rules:
- Run one command at a time. After receiving a tool result, respond in plain language then use the tool again if needed.
- Before the first tool call in a turn, give a one-sentence explanation (e.g. "I'll list the files in your home directory."), then immediately invoke the run_command tool—do not output the command as text.
- Never write "run_command", "run_command(", "Calling:", "Invoking:", or code blocks like \`\`\`run_command\\n...\\n\`\`\` in your message. The only way to run a command is to use the actual tool call; writing it in your text does nothing and confuses the user.
- Never output raw JSON, function names, or internal structures. Reply only in clear, human-readable text (and use the tool call separately).
- When you receive command output, interpret it and answer the user; if you need another command, say so in words then use the tool once.
- If the user asks something that needs no shell command (e.g. a general-knowledge question), still invoke run_command with a harmless command that conveys your answer (e.g. echo 'Your answer here') so the tool is used; then summarize in your reply.
- If a command fails, explain in plain language and suggest fixes. Be concise and safe: avoid destructive commands without user context.
- If you ever need to indicate a command in your message (always prefer using the tool), wrap it in <command>...</command> so it can be executed, e.g. <command>df -h</command> or <command>ls -aux | grep steam</command>. Use this format only as fallback; the proper way is to invoke the run_command tool. <command> must contain only a shell command (bash, ls, curl, etc.). Never put web search, google_search, or any non-shell API call inside <command>—it will be run as a shell command and fail.`;

const runCommandTool = tool({
	description: "Execute a shell command on the user's machine and get real stdout/stderr. You MUST invoke this tool (make a tool call). Do NOT write the command or 'run_command' or 'Calling: run_command(...)' in your text—that does nothing. Use for: listing files (ls), checking installs (which X, X --version), reading configs, any shell command. This is the only way to get actual output from the user's system.",
	inputSchema: z.object({
		command: z.string().describe("The full shell command to run (e.g. 'ls -la ~', 'which python')."),
	}),
	// No execute: client runs the command and sends result via toolResults
});

/** Classifier layer: does the user message require running a command on the client? Not persisted to chat history. */
const CLASSIFY_SYSTEM = `You are a classifier. Does the user's message require running a shell command on their machine (e.g. list files, check installs, run a script, show config, see disk space)? Answer only TRUE or FALSE.`;

/** Rephrase the user message so it clearly asks to run a command; used when the model replied with text instead of a tool call. Not saved to chat history. */
const REPHRASE_SYSTEM = `Rephrase the user's request into a single short sentence that clearly asks to execute a command on their machine. Keep the same intent. Output only the rephrased request, no explanation, no preamble, no "run_command" or tool names. Example: "list files in the current directory" -> "List the files in my current directory."`;

async function rephraseForToolUse(
	model: string,
	userPrompt: string,
	modelClient: ReturnType<typeof createGoogleGenerativeAI> | ReturnType<typeof createGateway>,
	useGateway: boolean,
): Promise<string> {
	const modelId = useGateway ? `google/${model}` : model;
	try {
		const { text } = await generateText({
			model: useGateway
				? (modelClient as ReturnType<typeof createGateway>)(modelId)
				: (modelClient as ReturnType<typeof createGoogleGenerativeAI>)(model),
			system: REPHRASE_SYSTEM,
			messages: [{ role: "user", content: userPrompt }],
			maxOutputTokens: 120,
		});
		const rephrased = text.trim();
		return rephrased || userPrompt;
	} catch (e) {
		apiLog.error("Rephrase failed, using original message:", e);
		return userPrompt;
	}
}

async function classifyExpectsCommandRun(
	model: string,
	userPrompt: string,
	modelClient: ReturnType<typeof createGoogleGenerativeAI> | ReturnType<typeof createGateway>,
	useGateway: boolean,
): Promise<boolean> {
	const modelId = useGateway ? `google/${model}` : model;
	try {
		const { text } = await generateText({
			model: useGateway
				? (modelClient as ReturnType<typeof createGateway>)(modelId)
				: (modelClient as ReturnType<typeof createGoogleGenerativeAI>)(model),
			system: CLASSIFY_SYSTEM,
			messages: [{ role: "user", content: userPrompt }],
			maxOutputTokens: 10,
		});
		const normalized = text.trim().toUpperCase();
		return normalized.startsWith("TRUE") || normalized === "TRUE";
	} catch (e) {
		apiLog.error("Classifier failed, assuming expectToolCall=true for safety:", e);
		return true;
	}
}

const configureThinking = (
	modelConfig: AIModel | undefined,
	thinkingEnabled: boolean,
	providedValue?: string | number,
): GoogleGenerativeAIProviderOptions["thinkingConfig"] | undefined => {
	// If no model config found or thinking is unsupported, don't configure thinking
	if (!modelConfig || modelConfig.capabilities.thinking === "unsupported") {
		return undefined;
	}

	// Find thinking special params
	const thinkingParams = modelConfig.specialParams.find(
		(param) => param.capability === "thinking",
	);

	if (!thinkingParams) {
		return undefined;
	}

	const { apiParamField, allowedValues } = thinkingParams;

	// Handle thinkingLevel (Gemini 3 models)
	if (apiParamField === "thinkingLevel") {
		// Use providedValue if available, otherwise fallback to default based on thinkingEnabled
		const thinkingLevel = providedValue && typeof providedValue === "string" && allowedValues.includes(providedValue)
			? providedValue
			: thinkingEnabled
				? "high"
				: "low";

		return {
			thinkingLevel: thinkingLevel as "low" | "high",
			includeThoughts: thinkingEnabled,
		};
	}

	// Handle thinkingBudget (Gemini 2.5 models)
	if (apiParamField === "thinkingBudget") {
		// If only -1 is allowed (e.g., Gemini 2.5 Pro), thinking is always required
		// But still use providedValue if it's valid
		if (allowedValues.length === 1 && allowedValues[0] === -1) {
			const thinkingBudget = providedValue !== undefined && typeof providedValue === "number" && allowedValues.includes(providedValue)
				? providedValue
				: -1;
			return {
				thinkingBudget,
				includeThoughts: true,
			};
		}

		// Use providedValue if available and valid, otherwise fallback to default based on thinkingEnabled
		const thinkingBudget = providedValue !== undefined && typeof providedValue === "number" && allowedValues.includes(providedValue)
			? providedValue
			: thinkingEnabled
				? -1
				: 0;

		return {
			thinkingBudget,
			includeThoughts: thinkingEnabled,
		};
	}

	return undefined;
};

type StoredToolCall = { toolCallId: string; toolName: string; input?: unknown; args?: unknown };

/** When the model wrote the command in text instead of using the tool, try to extract it so we can run it anyway. */
function extractCommandFromAssistantText(text: string): string | null {
	if (!text || typeof text !== "string") return null;
	const t = text.trim();
	// Preferred: <command>...</command> (deterministic format from system prompt)
	const commandTag = /<command>([\s\S]*?)<\/command>/.exec(t);
	if (commandTag?.[1]) {
		const cmd = commandTag[1].trim();
		if (cmd.length > 0 && cmd.length < 2048) return cmd;
	}
	// run_command("df -h") or run_command('df -h')
	const quoted = /run_command\s*\(\s*["']([^"']+)["']\s*\)/.exec(t);
	if (quoted?.[1]) return quoted[1].trim();
	// ```run_command\ndf -h\n``` or ``` run_command df -h ```
	const codeBlock = /```\s*run_command\s*\n([\s\S]*?)```/.exec(t);
	if (codeBlock?.[1]) return codeBlock[1].trim();
	// Calling: run_command("df -h")
	const calling = /Calling:\s*run_command\s*\(\s*["']([^"']+)["']\s*\)/.exec(t);
	if (calling?.[1]) return calling[1].trim();
	// Single line that looks like a shell command: e.g. `df -h` on its own line
	const backtickLine = /^`([^`]+)`\s*$/m.exec(t);
	if (backtickLine?.[1]) {
		const cmd = backtickLine[1].trim();
		if (cmd.length > 0 && cmd.length < 256) return cmd;
	}
	// Model emitted tool call as literal JSON in stream (e.g. {"toolName": "run_command", "arguments": {"command": "lsblk"}})
	const jsonToolCall = /"toolName"\s*:\s*"run_command"[\s\S]*?"(?:arguments|input)"\s*:\s*\{[\s\S]*?"command"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(t);
	if (jsonToolCall?.[1]) {
		const cmd = jsonToolCall[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
		if (cmd.length > 0 && cmd.length < 2048) return cmd;
	}
	return null;
}

/** Remove a run_command JSON block from assistant text so we don't store or show it to the user. */
function stripRunCommandJsonFromText(text: string): string {
	if (!text || typeof text !== "string") return text;
	const t = text.trim();
	const runCommandMarker = /"toolName"\s*:\s*"run_command"/.exec(t);
	if (!runCommandMarker) return text;
	const idx = runCommandMarker.index;
	const braceStart = t.lastIndexOf("{", idx);
	if (braceStart === -1) return text;
	let depth = 0;
	let endIndex = -1;
	for (let i = braceStart; i < t.length; i++) {
		if (t[i] === "{") depth++;
		else if (t[i] === "}") {
			depth--;
			if (depth === 0) {
				endIndex = i;
				break;
			}
		}
	}
	if (endIndex === -1) return text;
	const before = t.slice(0, braceStart).trimEnd();
	const after = t.slice(endIndex + 1).trimStart();
	return (before + (after ? "\n" + after : "")).trim();
}

/** Format run_command result for the model as plain text to avoid JSON/structure echoing. */
function formatRunCommandResultForModel(result: unknown): string {
	if (result && typeof result === "object" && "stdout" in result) {
		const r = result as { stdout?: string; stderr?: string; exitCode?: number };
		const lines: string[] = [`Exit code: ${r.exitCode ?? "?"}`];
		const stdout = typeof r.stdout === "string" ? r.stdout.trim() : "";
		const stderr = typeof r.stderr === "string" ? r.stderr.trim() : "";
		lines.push("stdout:", stdout || "(empty)");
		if (stderr) lines.push("stderr:", stderr);
		return lines.join("\n");
	}
	if (result && typeof result === "object" && "error" in result) {
		return `Error: ${(result as { error?: unknown }).error ?? "Unknown"}`;
	}
	return String(result ?? "");
}

function messageToModelMessage(msg: MessageSelect): ModelMessage {
	if (msg.role === "user") {
		return { role: "user", content: msg.content } satisfies UserModelMessage;
	}
	if (msg.role === "assistant") {
		const rawToolCalls = msg.toolCalls as { value?: StoredToolCall[] } | null | undefined;
		const toolCallsList = rawToolCalls?.value ?? (Array.isArray(rawToolCalls) ? rawToolCalls : []);
		if (toolCallsList.length > 0) {
			const parts: Array<{ type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }> = [];
			if (msg.content) parts.push({ type: "text", text: msg.content });
			for (const t of toolCallsList as StoredToolCall[]) {
				parts.push({
					type: "tool-call",
					toolCallId: t.toolCallId,
					toolName: t.toolName,
					input: t.input ?? t.args ?? {},
				});
			}
			return { role: "assistant", content: parts };
		}
		return { role: "assistant", content: msg.content } satisfies AssistantModelMessage;
	}
	return { role: "user", content: String(msg.content) } satisfies UserModelMessage;
}

export async function handleGeminiStream(c: AppContext, body: z.infer<typeof AIStreamSchema>) {
	const {
		userId,
		conversationId: providedConversationId,
		prompt,
		model,
		mode = "chat",
		systemInfo,
		toolResults,
		webSearch = true,
		thinking = true,
		thinkingValue,
		urlContext = false,
		internalRetry = false,
		rephrase = false,
		googleGenerativeAiApiKey: userGoogleApiKey,
		aiGatewayApiKey: userGatewayApiKey,
	} = body;

	const isContinuation = Array.isArray(toolResults) && toolResults.length > 0;
	if (internalRetry) {
		if (!providedConversationId) {
			return createSseErrorResponse("internalRetry requires conversationId.", 400);
		}
		if (!rephrase && (typeof prompt !== "string" || !prompt.trim())) {
			return createSseErrorResponse("internalRetry without rephrase requires prompt (retry instruction).", 400);
		}
	} else if (isContinuation) {
		if (!providedConversationId) {
			return createSseErrorResponse("conversationId required when sending toolResults.", 400);
		}
	} else {
		const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : "";
		if (!trimmedPrompt) {
			return createSseErrorResponse("prompt is required when not sending toolResults.", 400);
		}
	}

	const authHeader = c.req.header("Authorization");
	if (authHeader) {
		apiLog.debug(
			"Authorization header detected. TODO: validate bearer token.",
		);
	}

	// Determine API client early so we can run the classifier (not persisted) before main flow
	let modelClient: ReturnType<typeof createGoogleGenerativeAI> | ReturnType<typeof createGateway>;
	let useGateway = false;
	if (userGatewayApiKey) {
		const gateway = createGateway({ apiKey: userGatewayApiKey });
		modelClient = gateway;
		useGateway = true;
	} else if (userGoogleApiKey) {
		modelClient = createGoogleGenerativeAI({ apiKey: userGoogleApiKey });
	} else {
		return createSseErrorResponse(
			"Google AI API key or Gateway API key is required. Set your API key in the client (e.g. /setup in TUI).",
			400,
		);
	}

	// Classifier layer: does this message require running a command? Not saved to chat history. Skip on internalRetry.
	let expectToolCall = false;
	if (
		!internalRetry &&
		mode === "terminal_agent" &&
		!isContinuation &&
		typeof prompt === "string" &&
		prompt.trim().length > 0
	) {
		expectToolCall = await classifyExpectsCommandRun(model, prompt.trim(), modelClient, useGateway);
		apiLog.info("Classifier expectToolCall:", expectToolCall, "userMessage:", prompt.trim().slice(0, 80));
	}
	if (internalRetry) {
		expectToolCall = true; // Retry is always to get a tool call.
	}

	let conversationMessages: ModelMessage[] = [];
	let conversationId = providedConversationId ?? null;
	let createdConversation: ConversationSelect | null = null;
	/** When internalRetry: id of the last (failed) assistant message to update instead of creating new. */
	let lastAssistantMessageId: string | null = null;
	let messagesPayload: ModelMessage[] = [];

	if (internalRetry) {
		const existingConversation =
			await conversationDb.findByIdWithMessages({
				id: providedConversationId!,
				userId,
			});
		if (!existingConversation) {
			return createSseErrorResponse("Conversation not found for internalRetry.", 404);
		}
		const messages = existingConversation.messages.filter((m) => !m.compiled);
		const lastMsg = messages[messages.length - 1];
		if (!lastMsg || lastMsg.role !== "assistant") {
			return createSseErrorResponse("internalRetry requires last message to be assistant.", 400);
		}
		lastAssistantMessageId = lastMsg.id;
		conversationMessages = messages.map(messageToModelMessage);
		conversationId = existingConversation.id;
		let retryPrompt: string;
		if (rephrase) {
			const lastUserMsg = messages.filter((m) => m.role === "user").pop();
			if (!lastUserMsg?.content) {
				return createSseErrorResponse("internalRetry with rephrase requires a user message in the conversation.", 400);
			}
			retryPrompt = await rephraseForToolUse(model, String(lastUserMsg.content).trim(), modelClient, useGateway);
			apiLog.info("Auto-rephrase: using rephrased prompt", retryPrompt.slice(0, 80));
		} else {
			retryPrompt = prompt!.trim();
		}
		// Retry/rephrase prompt is not persisted; only used for this request.
		messagesPayload = [...conversationMessages, { role: "user" as const, content: retryPrompt }];
		apiLog.info("Internal retry: updating last assistant message", lastAssistantMessageId);
	} else if (providedConversationId) {
		const existingConversation =
			await conversationDb.findByIdWithMessages({
				id: providedConversationId,
				userId,
			});

		if (!existingConversation) {
			return createSseErrorResponse("Conversation not found.", 404);
		}

		conversationMessages = existingConversation.messages
			.filter((message) => !message.compiled)
			.map(messageToModelMessage);

		conversationId = existingConversation.id;
	} else if (!isContinuation) {
		createdConversation = await conversationDb.create({
			userId,
			name: getConversationName(typeof prompt === "string" ? prompt : ""),
		});

		if (!createdConversation) {
			return createSseErrorResponse(
				"Failed to create conversation.",
				500,
			);
		}

		conversationId = createdConversation.id;
	}

	if (!conversationId) {
		return createSseErrorResponse(
			"Unable to resolve conversation.",
			500,
		);
	}
	const cid = conversationId;
	apiLog.startConversation(cid);

	if (!internalRetry && isContinuation) {
		const content = toolResults!.map((r) => {
			// For run_command, send a plain-text summary so the model gets readable context and is less likely to echo JSON/internal format.
			const value =
				mode === "terminal_agent" && r.toolName === "run_command"
					? formatRunCommandResultForModel(r.result)
					: r.result;
			return {
				type: "tool-result" as const,
				toolCallId: r.toolCallId,
				toolName: r.toolName,
				output: r.isError
					? ({ type: "error-json" as const, value } as const)
					: ({ type: "json" as const, value } as const),
			};
		}) as ToolContent;
		const toolMessage: ModelMessage = { role: "tool", content };
		messagesPayload = [...conversationMessages, toolMessage];
	} else if (!internalRetry) {
		const promptMessage: UserModelMessage = { role: "user", content: prompt! };
		messagesPayload = [...conversationMessages, promptMessage];
		await Promise.all([
			messageDb.create({
				conversationId,
				role: "user",
				content: prompt!,
			}),
			conversationDb.update({
				id: conversationId,
				data: {
					messagesCount: conversationMessages.length + 1,
				},
			}),
		]);
	}

	// Conditionally build tools object. All tools are supported in all modes; prompt instructs
	// when to use run_command vs web search in Terminal Agent.
	const tools: Record<string, any> = {};
	if (webSearch) {
		tools.google_search = google.tools.googleSearch({});
	}
	if (urlContext) {
		tools.url_context = google.tools.urlContext({});
	}
	if (mode === "terminal_agent") {
		tools.run_command = runCommandTool;
	}

	// Find model configuration
	const modelConfig = findModelConfig(model);

	// Conditionally build provider options
	const providerOptions: GoogleGenerativeAIProviderOptions = {
		responseModalities: ["TEXT"],
		threshold: "OFF",
	};

	// Configure thinking based on model configuration
	const thinkingConfig = configureThinking(modelConfig, thinking, thinkingValue);
	if (thinkingConfig) {
		providerOptions.thinkingConfig = thinkingConfig;
	}

	// Build streamText options based on whether we're using gateway or direct API
	// When using gateway, model format should be 'google/model-name'
	const modelId = useGateway ? `google/${model}` : model;

	const terminalAgentPrompt =
		mode === "terminal_agent"
			? webSearch
				? `${TERMINAL_AGENT_SYSTEM}\n\nWeb search is available. Use run_command for anything that must execute on the user's machine (e.g. checking installs, running commands). Use web search only for documentation or general lookups, not to simulate command output.`
				: TERMINAL_AGENT_SYSTEM
			: null;
	const systemPrompt =
		terminalAgentPrompt != null
			? systemInfo
				? `${terminalAgentPrompt}\n\nUser system context (use this to tailor commands):\n${systemInfo}`
				: terminalAgentPrompt
			: undefined;

	const streamTextOptions: Parameters<typeof streamText>[0] = {
		model: useGateway 
			? (modelClient as ReturnType<typeof createGateway>)(modelId)
			: (modelClient as ReturnType<typeof createGoogleGenerativeAI>)(model),
		system: systemPrompt,
		tools: Object.keys(tools).length > 0 ? tools : undefined,
		messages: messagesPayload,
		// When classifier said this message requires a command, force run_command so we get a tool call.
		...(mode === "terminal_agent" && tools.run_command && expectToolCall
			? { toolChoice: { type: "tool" as const, toolName: "run_command" } }
			: {}),
		providerOptions: {
			google: providerOptions,
		},
	};

	const {
		textStream,
		reasoning,
		toolCalls,
		sources,
		totalUsage,
	} = streamText(streamTextOptions);

	apiLog.info("messagesPayloadCount:", messagesPayload.length);

	let assistantResponse = "";

	c.header('Content-Encoding', 'Identity')
	return streamSSE(
		c,
		async (chat) => {
			chat.onAbort(() => {
				apiLog.info("Stream aborted");
			});

			// Build sanitized request data for debugging/monitoring
			const userMessage = typeof prompt === "string" ? prompt.trim() : undefined;
			const sanitizedRequestData = {
				client: useGateway ? createGateway.name : createGoogleGenerativeAI.name,
				usingUserProvidedKeys: {
					gateway: !!userGatewayApiKey,
					google: !!userGoogleApiKey,
				},
				model: {
					requested: model,
					actual: modelId,
				},
				userMessage: userMessage ?? "(continuation: tool results)",
				tools: {
					enabled: Object.keys(tools).length > 0,
					webSearch,
					urlContext,
				},
				messages: {
					count: messagesPayload.length,
				},
				thinking: {
					enabled: thinking,
					configured: !!thinkingConfig,
					config: thinkingConfig ? {
						...thinkingConfig,
					} : null,
				},
				providerOptions: {
					responseModalities: providerOptions.responseModalities,
					threshold: providerOptions.threshold,
				},
			};

			const aiSDKRequestEvent = {
				event: 'aiSDKRequest',
				data: sanitizedRequestData,
			};
			apiLog.info(aiSDKRequestEvent);
			await chat.writeln(JSON.stringify(aiSDKRequestEvent));

			for await (const textPart of textStream) {
				assistantResponse += textPart;
				const sseData = {
					event: 'chatOutput',
					data: textPart,
				};
				apiLog.debug(sseData);
				await chat.writeln(JSON.stringify(sseData));
			}

			const conversationIdEvent = {
				event: 'conversationId',
				data: cid,
			};
			apiLog.info(conversationIdEvent);
			await chat.writeln(JSON.stringify(conversationIdEvent));

			// DB operations - these are independent, run in parallel
			const [reasoningResult, toolCallsResult, sourcesResult, totalUsageResult] = await Promise.all([
				reasoning,
				toolCalls,
				sources,
				totalUsage,
			]);

			// If model wrote the command in text (e.g. <command>...</command> or JSON tool block) instead of using the tool, extract and emit a synthetic tool call.
			// Do this whenever we have no tool calls and some assistant text (not only when classifier said expectToolCall), so e.g. "measure my internet speed" -> <command>which speedtest-cli</command> still runs.
			let effectiveToolCalls = Array.isArray(toolCallsResult) ? toolCallsResult : [];
			if (effectiveToolCalls.length === 0 && mode === "terminal_agent" && assistantResponse) {
				const extracted = extractCommandFromAssistantText(assistantResponse);
				if (extracted) {
					effectiveToolCalls = [
						{ type: "tool-call" as const, toolCallId: "fallback-0", toolName: "run_command", input: { command: extracted } },
					];
					apiLog.info("Terminal Agent: extracted command from assistant text (synthetic tool call):", extracted.slice(0, 60));
					// Strip run_command JSON (or similar) from stored content so the user doesn't see raw tool-call JSON.
					assistantResponse = stripRunCommandJsonFromText(assistantResponse);
				}
			}

			if (effectiveToolCalls.length > 0) {
				const toolCallsEvent = {
					event: "toolCalls",
					data: JSON.stringify(effectiveToolCalls),
				};
				await chat.writeln(JSON.stringify(toolCallsEvent));
			} else if (expectToolCall) {
				// Classifier said command required but the model returned no tool call (provider/model quirk).
				apiLog.error("Terminal Agent: expectToolCall was true but got no tool call. userMessage:", userMessage);
			}

			let createdMessage: MessageSelect | null = null;
			if (assistantResponse || effectiveToolCalls.length > 0) {
				if (lastAssistantMessageId) {
					// Internal retry: update the failed assistant message instead of creating new
					createdMessage = await messageDb.update({
						id: lastAssistantMessageId,
						data: {
							content: assistantResponse || "",
							reasoning: wrapJsonColumn(reasoningResult),
							toolCalls: wrapJsonColumn(effectiveToolCalls),
							sources: wrapJsonColumn(sourcesResult),
						},
					});
				} else {
					// Create new assistant message and update conversation count
					const [newMessage] = await Promise.all([
						messageDb.create({
							conversationId: cid,
							role: "assistant",
							content: assistantResponse || "",
							reasoning: wrapJsonColumn(reasoningResult),
							toolCalls: wrapJsonColumn(effectiveToolCalls),
							sources: wrapJsonColumn(sourcesResult),
						}),
						conversationDb.update({
							id: cid,
							data: {
								messagesCount: messagesPayload.length + 1,
							},
						}),
					]);
					createdMessage = newMessage;
					if (createdConversation) {
						const createdConversationEvent = {
							event: 'createdConversation',
							data: JSON.stringify(createdConversation),
						};
						apiLog.info(createdConversationEvent);
						await chat.writeln(JSON.stringify(createdConversationEvent));
					}
				}
				const createdMessageEvent = {
					event: 'createdMessage',
					data: JSON.stringify(createdMessage),
				};
				apiLog.info(createdMessageEvent);
				await chat.writeln(JSON.stringify(createdMessageEvent));

				if (totalUsageResult && createdMessage) {
					const tokenUsage = await tokenUsageDb.create({
						userId,
						messageId: createdMessage.id,
						conversationId: cid,
						model,
						inputTokens: totalUsageResult.inputTokens,
						outputTokens: totalUsageResult.outputTokens,
						totalTokens: totalUsageResult.totalTokens,
						reasoningTokens: totalUsageResult.reasoningTokens,
						cachedInputTokens: totalUsageResult.cachedInputTokens,
					});
					const tokenUsageEvent = {
						event: 'tokenUsage',
						data: JSON.stringify(tokenUsage),
					};
					apiLog.info(tokenUsageEvent);
					await chat.writeln(JSON.stringify(tokenUsageEvent));
				} else {
					if (!totalUsageResult) {
						apiLog.error("Total usage not found. Total usage:", totalUsageResult);
					}
					if (!createdMessage) {
						apiLog.error("Message ID not available for token usage tracking.");
					}
				}
			} else {
				// Stream completed with no text and no tool calls (e.g. after many tool rounds).
				// Signal via chatFinish so the client can show "No response" or retry instead of treating as fatal.
				// No message is created for this turn.
			}

			const expectedToolCallMissing =
				expectToolCall && effectiveToolCalls.length === 0;
			const chatFinish = {
				event: 'chatFinish',
				data: JSON.stringify({
					success: true,
					emptyResponse: !assistantResponse && effectiveToolCalls.length === 0,
					expectedToolCallMissing: expectedToolCallMissing || undefined,
				}),
			};
			apiLog.info(chatFinish);
			await chat.writeln(JSON.stringify(chatFinish));

			// Close stream - textStream is already done after for-await loop
			await chat.close();

			apiLog.info("Stream closed");
			return;
		},
		async (err, chat) => {
			const error = {
				event: 'error',
				data: `An error occurred: ${err}`,
			};
			apiLog.error(error);
			await chat.writeln(JSON.stringify(error));
			// Only cancel if stream is still active
			try {
				await textStream.cancel();
			} catch (cancelError) {
				// Stream may already be done, ignore
			}
			await chat.close();
			apiLog.info("Stream closed");
			return;
		},
	);
}
