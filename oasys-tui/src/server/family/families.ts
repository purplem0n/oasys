import { geminiModels } from "./gemini/handler-models";

const modelFamilies = [
    ...geminiModels.flatMap((model) => {
        return { modelKey: model.modelKey, family: 'gemini' };
    }),
    // more families here soon...
];

export function getModelFamily(modelKey: string) {
    const model = modelFamilies.find((model) => model.modelKey === modelKey);
    if (!model) {
        return null;
    }
    return model.family;
}
