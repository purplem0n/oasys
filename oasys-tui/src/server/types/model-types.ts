import { z } from "zod";

const capabilityLevel = z.enum(['required', 'optional', 'unsupported']);

export const ModelCapabilitiesSchema = z.object({
    audioGeneration: capabilityLevel,
    batchApi: capabilityLevel,
    caching: capabilityLevel,
    codeExecution: capabilityLevel,
    fileSearch: capabilityLevel,
    functionCalling: capabilityLevel,
    googleMapsGrounding: capabilityLevel,
    imageGeneration: capabilityLevel,
    liveApi: capabilityLevel,
    structuredOutput: capabilityLevel,
    thinking: capabilityLevel,
    urlContext: capabilityLevel,
    webSearch: capabilityLevel,
});

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelSpecialParamsSchema = z.object({
    capability: z.enum(['audioGeneration', 'batchApi', 'caching', 'codeExecution', 'fileSearch', 'functionCalling', 'googleMapsGrounding', 'imageGeneration', 'liveApi', 'structuredOutput', 'thinking', 'urlContext', 'webSearch']),
    allowedValues: z.array(z.any()).nonempty(),
    apiParamField: z.string(),
    description: z.string().nonempty(),
});

export type ModelSpecialParams = z.infer<typeof ModelSpecialParamsSchema>;

/** Max input context size in tokens (from Gemini docs). Used for token counter in UI. */
export const AIModelSchema = z.object({
    appDisplayName: z.string(),
    purpose: z.string(),
    modelKey: z.string(),
    description: z.string(),
    capabilities: ModelCapabilitiesSchema,
    specialParams: z.array(ModelSpecialParamsSchema),
    maxInputTokens: z.number().optional(),
});

export type AIModel = z.infer<typeof AIModelSchema>;
