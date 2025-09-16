import { RuntOpenAIClient } from "./openai-client.ts";
import type { NotebookTool } from "./tool-registry.ts";

interface GroqConfig {
    apiKey?: string;
    baseURL?: string;
    organization?: string;
    defaultHeaders?: Record<string, string>;
    provider?: string;
}

export class GroqClient extends RuntOpenAIClient {
    constructor(config?: GroqConfig, notebookTools: NotebookTool[] = []) {
      // Set default provider to 'groq' if not explicitly provided
        const groqConfig = {
            provider: "groq",
            ...config, // This allows config.provider to override the default
        };
        super(groqConfig, notebookTools);
    }
}
