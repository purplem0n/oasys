import {
	and,
	asc,
	desc,
	eq,
	sql,
	type InferInsertModel,
	type InferSelectModel,
} from "drizzle-orm";
import { conversations, messages, tokenUsages } from "../db/schema";
import { getDb } from "./drizzle";

type ConversationInsert = InferInsertModel<typeof conversations>;
type ConversationUpdate = Partial<ConversationInsert>;
export type ConversationSelect = InferSelectModel<typeof conversations>;
type ConversationId = ConversationSelect["id"];
type MessageInsert = InferInsertModel<typeof messages>;
type MessageUpdate = Partial<MessageInsert>;
export type MessageSelect = InferSelectModel<typeof messages>;
type MessageId = MessageSelect["id"];
type UserId = ConversationInsert["userId"];
type TokenUsageInsert = InferInsertModel<typeof tokenUsages>;
export type TokenUsageSelect = InferSelectModel<typeof tokenUsages>;

const latestTokenUsageColumns = {
	id: sql<string | null>`latest_token_usage.id`,
	messageId: sql<string | null>`latest_token_usage.message_id`,
	conversationId: sql<string | null>`latest_token_usage.conversation_id`,
	userId: sql<string | null>`latest_token_usage.user_id`,
	model: sql<string | null>`latest_token_usage.model`,
	inputTokens: sql<number | null>`latest_token_usage.input_tokens`,
	outputTokens: sql<number | null>`latest_token_usage.output_tokens`,
	totalTokens: sql<number | null>`latest_token_usage.total_tokens`,
	reasoningTokens: sql<number | null>`latest_token_usage.reasoning_tokens`,
	cachedInputTokens: sql<number | null>`latest_token_usage.cached_input_tokens`,
	createdAt: sql<Date | number | null>`latest_token_usage.created_at`,
	updatedAt: sql<Date | number | null>`latest_token_usage.updated_at`,
};

/** SQLite-compatible: one row per conversation_id (latest by created_at) */
const latestTokenUsageSubquery = sql`(
	SELECT * FROM (
		SELECT *, ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC) AS rn
		FROM ${tokenUsages}
	) WHERE rn = 1
) AS latest_token_usage`;

export const conversationDb = {
	create: async (data: ConversationInsert) => {
		const db = getDb();
		const [conversation] = await db
			.insert(conversations)
			.values(data)
			.returning();
		return conversation ?? null;
	},
	update: async ({
		id,
		data,
	}: {
		id: ConversationId;
		data: ConversationUpdate;
	}) => {
		const db = getDb();
		const [conversation] = await db
			.update(conversations)
			.set(data)
			.where(eq(conversations.id, id))
			.returning();
		return conversation ?? null;
	},
	delete: async ({ id }: { id: ConversationId }) => {
		const db = getDb();
		const [conversation] = await db
			.delete(conversations)
			.where(eq(conversations.id, id))
			.returning();
		return conversation ?? null;
	},
	listByUser: async (userId: UserId) => {
		const db = getDb();
		const results = await db
			.select({
				conversation: conversations,
				latestTokenUsage: latestTokenUsageColumns,
			})
			.from(conversations)
			.leftJoin(
				latestTokenUsageSubquery,
				sql`${conversations.id} = latest_token_usage.conversation_id`,
			)
			.where(
				and(
					eq(conversations.userId, userId),
					eq(conversations.deleted, false),
				),
			)
			.orderBy(desc(conversations.updatedAt));

		return results.map((row) => ({
			...row.conversation,
			latestTokenUsage: row.latestTokenUsage.id
				? (row.latestTokenUsage as TokenUsageSelect)
				: null,
		}));
	},
	findById: async ({
		id,
		userId,
	}: {
		id: ConversationId;
		userId: UserId;
	}) => {
		const db = getDb();
		const [result] = await db
			.select({
				conversation: conversations,
				latestTokenUsage: latestTokenUsageColumns,
			})
			.from(conversations)
			.leftJoin(
				sql`(
					SELECT * FROM ${tokenUsages}
					WHERE conversation_id = ${id}
					ORDER BY created_at DESC
					LIMIT 1
				) AS latest_token_usage`,
				sql`${conversations.id} = latest_token_usage.conversation_id`,
			)
			.where(
				and(
					eq(conversations.id, id),
					eq(conversations.userId, userId),
					eq(conversations.deleted, false),
				),
			)
			.limit(1);

		if (!result) {
			return null;
		}

		return {
			...result.conversation,
			latestTokenUsage: result.latestTokenUsage.id
				? (result.latestTokenUsage as TokenUsageSelect)
				: null,
		};
	},
	findByIdWithMessages: async ({
		id,
		userId,
	}: {
		id: ConversationId;
		userId: UserId;
	}) => {
		const db = getDb();
		const [conversationResult] = await db
			.select({
				conversation: conversations,
				latestTokenUsage: latestTokenUsageColumns,
			})
			.from(conversations)
			.leftJoin(
				sql`(
					SELECT * FROM ${tokenUsages}
					WHERE conversation_id = ${id}
					ORDER BY created_at DESC
					LIMIT 1
				) AS latest_token_usage`,
				sql`${conversations.id} = latest_token_usage.conversation_id`,
			)
			.where(
				and(
					eq(conversations.id, id),
					eq(conversations.userId, userId),
					eq(conversations.deleted, false),
				),
			)
			.limit(1);

		if (!conversationResult) {
			return null;
		}

		const conversationMessages = await db
			.select()
			.from(messages)
			.where(eq(messages.conversationId, id))
			.orderBy(asc(messages.createdAt));

		return {
			...conversationResult.conversation,
			messages: conversationMessages,
			latestTokenUsage: conversationResult.latestTokenUsage.id
				? (conversationResult.latestTokenUsage as TokenUsageSelect)
				: null,
		};
	},
};

export const messageDb = {
	create: async (data: MessageInsert) => {
		const db = getDb();
		const [message] = await db
			.insert(messages)
			.values(data)
			.returning();
		return message ?? null;
	},
	update: async ({
		id,
		data,
	}: {
		id: MessageId;
		data: MessageUpdate;
	}) => {
		const db = getDb();
		const [message] = await db
			.update(messages)
			.set(data)
			.where(eq(messages.id, id))
			.returning();
		return message ?? null;
	},
};

export const tokenUsageDb = {
	create: async (data: TokenUsageInsert) => {
		const db = getDb();
		const [tokenUsage] = await db
			.insert(tokenUsages)
			.values(data)
			.returning();
		return tokenUsage ?? null;
	},
};
