/**
 * Initial schema for oasys.sqlite. Run once on first use so the app works
 * without requiring `bun run drizzle-setup`. Generated from schema and kept
 * in sync when schema changes (re-run drizzle-kit generate and update this).
 */
export const INIT_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  name text NOT NULL,
  messages_count integer DEFAULT 0 NOT NULL,
  published integer DEFAULT 0 NOT NULL,
  deleted integer DEFAULT 0 NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY NOT NULL,
  conversation_id text NOT NULL,
  content text NOT NULL,
  role text DEFAULT 'user' NOT NULL,
  compiled integer DEFAULT 0 NOT NULL,
  is_summary integer DEFAULT 0 NOT NULL,
  reasoning text,
  tool_calls text,
  sources text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS token_usages (
  id text PRIMARY KEY NOT NULL,
  message_id text NOT NULL,
  conversation_id text NOT NULL,
  user_id text NOT NULL,
  model text NOT NULL,
  input_tokens integer DEFAULT 0 NOT NULL,
  output_tokens integer DEFAULT 0 NOT NULL,
  total_tokens integer DEFAULT 0 NOT NULL,
  reasoning_tokens integer DEFAULT 0 NOT NULL,
  cached_input_tokens integer DEFAULT 0 NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
`.trim();
