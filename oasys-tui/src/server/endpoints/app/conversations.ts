import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../chat/chat-types";
import { conversationDb } from "../../utils/db";

const AuthorizationHeaderSchema = z.object({
	authorization: z.string().optional(),
});

const UserQuerySchema = z.object({
	userId: z.string().min(1, "userId is required"),
});

const TokenUsageSchema = z.object({
	id: z.string(),
	messageId: z.string(),
	userId: z.string(),
	model: z.string(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
	reasoningTokens: z.number(),
	cachedInputTokens: z.number(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

const ConversationSchema = z.object({
	id: z.string(),
	userId: z.string(),
	name: z.string(),
	messages_count: z.number(),
	published: z.boolean(),
	deleted: z.boolean(),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	latestTokenUsage: TokenUsageSchema.nullable(),
});

const MessageSchema = z.object({
	id: z.string(),
	conversation_id: z.string(),
	content: z.string(),
	role: z.string(),
	compiled: z.boolean(),
	is_summary: z.boolean(),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
});

const safeDateToString = (value: unknown): string | null => {
	if (value === null || value === undefined) {
		return null;
	}
	// If it's already a Date object, use it directly
	if (value instanceof Date) {
		if (isNaN(value.getTime())) {
			return null;
		}
		return value.toISOString();
	}
	// Otherwise, try to convert it
	const date = new Date(value as string | number);
	if (isNaN(date.getTime())) {
		return null;
	}
	return date.toISOString();
};

const serializeConversation = <T extends Record<string, unknown>>(conversation: T) => {
	// Drizzle returns camelCase, convert to snake_case for API response
	const serialized: Record<string, unknown> = {
		id: conversation.id,
		userId: conversation.userId,
		name: conversation.name,
		messages_count: conversation.messagesCount,
		published: conversation.published,
		deleted: conversation.deleted,
		created_at: safeDateToString(conversation.createdAt),
		updated_at: safeDateToString(conversation.updatedAt),
	};

	// Serialize latestTokenUsage if it exists
	if (conversation.latestTokenUsage) {
		const tokenUsage = conversation.latestTokenUsage as Record<string, unknown>;
		serialized.latestTokenUsage = {
			id: tokenUsage.id,
			messageId: tokenUsage.messageId,
			userId: tokenUsage.userId,
			model: tokenUsage.model,
			inputTokens: tokenUsage.inputTokens,
			outputTokens: tokenUsage.outputTokens,
			totalTokens: tokenUsage.totalTokens,
			reasoningTokens: tokenUsage.reasoningTokens,
			cachedInputTokens: tokenUsage.cachedInputTokens,
			createdAt: safeDateToString(tokenUsage.createdAt),
			updatedAt: safeDateToString(tokenUsage.updatedAt),
		};
	} else {
		serialized.latestTokenUsage = null;
	}

	return serialized;
};

const serializeMessage = (message: Record<string, unknown>) => ({
	...message,
	created_at: safeDateToString(message.createdAt ?? message.created_at) ?? "",
	updated_at: safeDateToString(message.updatedAt ?? message.updated_at) ?? "",
});

export class ConversationListRoute extends OpenAPIRoute {
	override schema = {
		tags: ["App"],
		summary: "Fetch user's conversations",
		description:
			"Returns every conversation that belongs to the provided userId. Authorization header is optional and currently unused.",
		request: {
			query: UserQuerySchema,
			headers: AuthorizationHeaderSchema,
		},
		responses: {
			"200": {
				description: "A list of conversations",
				content: {
					"application/json": {
						schema: z.object({
							data: z.array(ConversationSchema),
						}),
					},
				},
			},
		},
	};

	override async handle(c: AppContext) {
		// Validate request parts. Authorization is accepted but not enforced yet.
		const query = UserQuerySchema.parse(c.req.query());
		AuthorizationHeaderSchema.parse({
			authorization: c.req.header("Authorization") ?? undefined,
		});

		const conversations = await conversationDb.listByUser(query.userId);

		return c.json({
			data: conversations.map((conversation) => serializeConversation(conversation)),
		});
	}
}

export class ConversationRoute extends OpenAPIRoute {
	override schema = {
		tags: ["App"],
		summary: "Fetch a conversation",
		description:
			"Retrieves a single conversation without messages. Authorization header is optional and currently unused.",
		request: {
			params: z.object({
				conversationId: z.string().min(1),
			}),
			query: UserQuerySchema,
			headers: AuthorizationHeaderSchema,
		},
		responses: {
			"200": {
				description: "Conversation",
				content: {
					"application/json": {
						schema: z.object({
							data: ConversationSchema,
						}),
					},
				},
			},
			"404": {
				description: "Conversation not found",
				content: {
					"application/json": {
						schema: z.object({
							error: z.string(),
						}),
					},
				},
			},
		},
	};

	override async handle(c: AppContext) {
		const params = z.object({ conversationId: z.string().min(1) }).parse(c.req.param());
		const query = UserQuerySchema.parse(c.req.query());
		AuthorizationHeaderSchema.parse({
			authorization: c.req.header("Authorization") ?? undefined,
		});

		const conversation = await conversationDb.findById({
			id: params.conversationId,
			userId: query.userId,
		});

		if (!conversation) {
			return c.json({ error: "Conversation not found" }, 404);
		}

		return c.json({
			data: serializeConversation(conversation),
		});
	}
}

export class ConversationDetailRoute extends OpenAPIRoute {
	override schema = {
		tags: ["App"],
		summary: "Fetch a conversation with all messages",
		description:
			"Retrieves a single conversation along with every message it contains. Authorization header is optional and currently unused.",
		request: {
			params: z.object({
				conversationId: z.string().min(1),
			}),
			query: UserQuerySchema,
			headers: AuthorizationHeaderSchema,
		},
		responses: {
			"200": {
				description: "Conversation with messages",
				content: {
					"application/json": {
						schema: z.object({
							data: ConversationSchema.extend({
								messages: z.array(MessageSchema),
							}),
						}),
					},
				},
			},
			"404": {
				description: "Conversation not found",
				content: {
					"application/json": {
						schema: z.object({
							error: z.string(),
						}),
					},
				},
			},
		},
	};

	override async handle(c: AppContext) {
		const params = z.object({ conversationId: z.string().min(1) }).parse(c.req.param());
		const query = UserQuerySchema.parse(c.req.query());
		AuthorizationHeaderSchema.parse({
			authorization: c.req.header("Authorization") ?? undefined,
		});

		const conversation = await conversationDb.findByIdWithMessages({
			id: params.conversationId,
			userId: query.userId,
		});

		if (!conversation) {
			return c.json({ error: "Conversation not found" }, 404);
		}

		return c.json({
			data: {
				...serializeConversation(conversation),
				messages: conversation.messages.map(serializeMessage),
			},
		});
	}
}

export class ConversationDeleteRoute extends OpenAPIRoute {
	override schema = {
		tags: ["App"],
		summary: "Soft delete a conversation",
		description:
			"Soft deletes a conversation by setting deleted=true. Authorization header is optional and currently unused.",
		request: {
			params: z.object({
				conversationId: z.string().min(1),
			}),
			query: UserQuerySchema,
			headers: AuthorizationHeaderSchema,
		},
		responses: {
			"200": {
				description: "Conversation deleted successfully",
				content: {
					"application/json": {
						schema: z.object({
							data: ConversationSchema,
						}),
					},
				},
			},
			"404": {
				description: "Conversation not found",
				content: {
					"application/json": {
						schema: z.object({
							error: z.string(),
						}),
					},
				},
			},
		},
	};

	override async handle(c: AppContext) {
		const params = z.object({ conversationId: z.string().min(1) }).parse(c.req.param());
		const query = UserQuerySchema.parse(c.req.query());
		AuthorizationHeaderSchema.parse({
			authorization: c.req.header("Authorization") ?? undefined,
		});

		// First verify the conversation exists and belongs to the user
		const conversation = await conversationDb.findById({
			id: params.conversationId,
			userId: query.userId,
		});

		if (!conversation) {
			return c.json({ error: "Conversation not found" }, 404);
		}

		// Soft delete by setting deleted=true
		const deletedConversation = await conversationDb.update({
			id: params.conversationId,
			data: { deleted: true },
		});

		if (!deletedConversation) {
			return c.json({ error: "Failed to delete conversation" }, 500);
		}

		return c.json({
			data: serializeConversation(deletedConversation),
		});
	}
}

