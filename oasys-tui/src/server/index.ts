import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ChatStreamRoute as ChatStreamTextRoute } from "./endpoints/chat/chat";
import { ConversationListRoute, ConversationRoute, ConversationDetailRoute, ConversationDeleteRoute } from "./endpoints/app/conversations";
import { ModelsRoute } from "./endpoints/app/models";


// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Add CORS middleware
app.use(
	"/*",
	cors({
		origin: "*",
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "Accept", "Cache-Control"],
		exposeHeaders: ["Content-Length", "Content-Type"],
		credentials: true,
	})
);

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Register OpenAPI endpoints
openapi.post("/chat/stream-text", ChatStreamTextRoute);
openapi.get("/models", ModelsRoute);
openapi.get("/conversations", ConversationListRoute);
openapi.get("/conversations/:conversationId", ConversationRoute);
openapi.get("/conversations/:conversationId/messages", ConversationDetailRoute);
openapi.delete("/conversations/:conversationId", ConversationDeleteRoute);

// You may also register routes for non OpenAPI directly on Hono
// app.get('/test', (c) => c.text('Hono!'))

// Export the Hono app
export default app;
