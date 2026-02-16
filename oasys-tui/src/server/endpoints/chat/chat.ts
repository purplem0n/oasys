import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import {
    type AppContext,
    ChatStreamTextSchema,
} from "./chat-types";
import { handleGeminiStream } from "../../family/gemini/handler";
import { getModelFamily } from "../../family/families";
import { apiLog } from "../../logger";

const SSE_HEADERS = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
};

const encoder = new TextEncoder();

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

export class ChatStreamRoute extends OpenAPIRoute {
    override schema = {
        tags: ["Chat Stream"],
        summary: "Stream a chat response",
        request: {
            body: {
                content: {
                    "application/x-www-form-urlencoded": {
                        schema: ChatStreamTextSchema,
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Server-Sent Events stream of AI response chunks",
                content: {
                    "text/event-stream": {
                        schema: z.object({
                            data: z.string(),
                        }),
                    },
                },
            },
        },
    };

    override async handle(c: AppContext) {
        try {
            const body = await c.req.parseBody();
            const parsedBody = ChatStreamTextSchema.parse(body);
            const { model } = parsedBody;

            // Determine which family handler to use based on the model
            const modelFamily = getModelFamily(model);

            if (!modelFamily) {
                return createSseErrorResponse(
                    `Unsupported model: ${model}. Please use a supported model.`,
                    400,
                );
            }

            // Route to the appropriate family handler
            switch (modelFamily) {
                case "gemini":
                    return await handleGeminiStream(c, parsedBody);
                default:
                    return createSseErrorResponse(
                        `No handler found for model family: ${modelFamily}`,
                        500,
                    );
            }
        } catch (error) {
            apiLog.error("AI stream error:", error);
            return createSseErrorResponse(
                "Unable to process stream request.",
                500,
            );
        }
    }
}
