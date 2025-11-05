import { RuntOpenAIClient } from "./openai-client.ts";
import type { OpenAIConfig } from "./openai-client.ts";
import type { AiModel } from "@runtimed/agent-core";
import { logger } from "@runtimed/agent-core";

export class GroqClient extends RuntOpenAIClient {
  override provider: string = "groq";
  override defaultConfig: OpenAIConfig = {
    baseURL: "https://api.groq.com/openai/v1",
  };

  override getConfigMessage(): string {
    const configMessage = `# Groq Configuration Required

Groq API key not found. Please set \`GROQ_API_KEY\` environment variable.`;
    return configMessage;
  }

  override discoverAiModels(): Promise<AiModel[]> {
    if (!this.isReady()) {
      logger.warn(
        `${this.provider} client not ready, returning empty models list`,
      );
      return Promise.resolve([]);
    }
    const groqModels: AiModel[] = [
      {
        provider: "groq",
        name: "moonshotai/kimi-k2-instruct-0905",
        displayName: "Kimi K2 Instruct 0905",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "moonshotai/kimi-k2-instruct",
        displayName: "Kimi K2 Instruct",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "qwen/qwen3-32b",
        displayName: "Qwen 3 32B",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "llama-3.1-8b-instant",
        displayName: "Llama 3.1 8B Instant",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "openai/gpt-oss-120b",
        displayName: "GPT OSS 120B",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "gemma2-9b-it",
        displayName: "Gemma 2 9B",
        capabilities: ["completion", "tools"],
        decomissioned: true,
      },
      {
        provider: "groq",
        name: "groq/compound-mini",
        displayName: "Groq Compound Mini",
        capabilities: ["completion", "thinking"],
      },
      {
        provider: "groq",
        name: "groq/compound",
        displayName: "Groq Compound",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "meta-llama/llama-4-scout-17b-16e-instruct",
        displayName: "Llama 4 Scout 17B",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "meta-llama/llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick 17B",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "openai/gpt-oss-20b",
        displayName: "GPT OSS 20B",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "llama-3.3-70b-versatile",
        displayName: "Llama 3.3 70B Versatile",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "allam-2-7b",
        displayName: "Allam 2 7B",
        capabilities: ["completion"],
      },
    ];
    return Promise.resolve(groqModels);
  }
}

export class AnacondaAIClient extends GroqClient {
  override provider: string = "anaconda";
  override envPrefix: string = "RUNT";
  override defaultConfig: OpenAIConfig = {
    baseURL: "https://anaconda.com/api/assistant/v3/groq",
    defaultHeaders: {
      "X-Client-Version": "0.3.0",
      "X-Client-Source": "anaconda-runt-dev",
    },
  };

  override async discoverAiModels(): Promise<AiModel[]> {
    const models = await super.discoverAiModels();

    for (const model of models) {
      model.provider = "anaconda";
    }

    return models;
  }

  override getConfigMessage(): string {
    const configMessage = `# Anaconda/Runt Configuration Required

RUNT API key not found. Please set \`RUNT_API_KEY\` environment variable.`;
    return configMessage;
  }
}
