import {
  foreignKey,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  messagesCount: integer("messages_count").notNull().default(0),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id").notNull(),
    content: text("content").notNull(),
    role: text("role").notNull().default("user"),
    compiled: integer("compiled", { mode: "boolean" }).notNull().default(false),
    isSummary: integer("is_summary", { mode: "boolean" }).notNull().default(false),
    reasoning: text("reasoning", { mode: "json" })
      .$type<Record<string, unknown> | null>()
      .default(null),
    toolCalls: text("tool_calls", { mode: "json" })
      .$type<Record<string, unknown> | null>()
      .default(null),
    sources: text("sources", { mode: "json" })
      .$type<Record<string, unknown> | null>()
      .default(null),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "messages_conversation_id_fkey",
      columns: [table.conversationId],
      foreignColumns: [conversations.id],
    }).onDelete("cascade"),
  ],
);

export const tokenUsages = sqliteTable(
  "token_usages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    messageId: text("message_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    userId: text("user_id").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "token_usages_message_id_fkey",
      columns: [table.messageId],
      foreignColumns: [messages.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "token_usages_conversation_id_fkey",
      columns: [table.conversationId],
      foreignColumns: [conversations.id],
    }).onDelete("cascade"),
  ],
);
