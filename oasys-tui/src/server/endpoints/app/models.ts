import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { geminiModels } from "../../family/gemini/handler-models";
import { AIModelSchema } from "../../types/model-types";
import type { AppContext } from "../chat/chat-types";

export class ModelsRoute extends OpenAPIRoute {
	override schema = {
		tags: ["App"],
		summary: "Fetch available AI models",
		description: "Returns all available AI models for frontend configuration.",
		request: {},
		responses: {
			"200": {
				description: "Available AI models",
				content: {
					"application/json": {
						schema: z.object({
							gemini: z.array(AIModelSchema),
							// more families here soon...
						}),
					},
				},
			},
		},
	};

	override async handle(c: AppContext) {
		return c.json({
			gemini: geminiModels,
			// more families here soon...
		});
	}
}

