import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { serve } from "@hono/node-server";
import app from "./server";
import { ensureDb } from "./server/utils/drizzle";
import { App } from "./App";
import { SERVER_PORT } from "./constants";

serve({ fetch: app.fetch, port: SERVER_PORT }, (info) => {
  ensureDb().catch((err) => console.error("DB init failed:", err));
  console.log(`Server running at http://localhost:${info.port}`);
});

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
