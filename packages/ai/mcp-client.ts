import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "@runt/lib";
import { join } from "@std/path";

const logger = createLogger("mcp-client");
interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  name: string;
  description?: string;
}

interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

function assertIsMCPConfig(val: unknown): asserts val is MCPConfig {
  if (
    typeof val !== "object" ||
    val === null ||
    !("mcpServers" in val)
  ) {
    throw new Error("Invalid config: missing 'mcpServers'");
  }

  const servers = val.mcpServers;
  if (
    typeof servers !== "object" ||
    servers === null ||
    Array.isArray(servers)
  ) {
    throw new Error("Invalid 'mcpServers': must be an object");
  }

  for (const [key, server] of Object.entries(servers)) {
    if (
      typeof server !== "object" ||
      server === null ||
      "name" in server &&
        typeof server.name !== "string"
    ) {
      throw new Error(
        `Invalid MCPServerConfig at key '${key}': must have a string 'name'`,
      );
    }

    if ("command" in server && typeof server.command !== "string") {
      throw new Error(`Invalid 'command' in '${key}': must be a string`);
    }

    if ("args" in server && !Array.isArray(server.args)) {
      throw new Error(
        `Invalid 'args' in '${key}': must be an array of strings`,
      );
    } else if (
      "args" in server &&
      Array.isArray(server.args) &&
      !server.args.every((arg: unknown) => typeof arg === "string")
    ) {
      throw new Error(`Invalid 'args' in '${key}': all items must be strings`);
    }

    if ("env" in server && typeof server.env !== "object") {
      throw new Error(`Invalid 'env' in '${key}': must be an object`);
    } else if (
      "env" in server &&
      typeof server.env === "object" &&
      server.env !== null
    ) {
      for (const [envKey, envVal] of Object.entries(server.env)) {
        if (typeof envVal !== "string") {
          throw new Error(
            `Invalid 'env' in '${key}': key '${envKey}' must map to a string`,
          );
        }
      }
    }

    if ("url" in server && typeof server.url !== "string") {
      throw new Error(`Invalid 'url' in '${key}': must be a string`);
    }

    if (
      "description" in server &&
      typeof server.description !== "string"
    ) {
      throw new Error(`Invalid 'description' in '${key}': must be a string`);
    }
  }
}

interface MCPTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  serverName: string;
}

const fileExists = (path: string): Promise<boolean> =>
  Deno.stat(path).then(() => true).catch(() => false);

export class MCPClient {
  private clients = new Map<string, Client>();
  private tools: MCPTool[] = [];
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const config = await this.loadConfig();
    await this.connectToServers(config);
    await this.discoverTools();
    this.isInitialized = true;
    logger.info(
      `MCP client initialized with ${this.tools.length} tools from ${this.clients.size} servers`,
    );
  }

  private async loadConfig(): Promise<MCPConfig> {
    const homeDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
    const configPath = join(homeDir, ".runt", "mcp.json");

    // Check if file exists, if not then return empty config
    if (!(await fileExists(configPath))) {
      logger.info(`MCP config file not found at ${configPath}`);
      return { mcpServers: {} };
    }

    const config: MCPConfig = await Deno.readTextFile(configPath).then(
      (txt) => {
        const config = JSON.parse(txt);
        assertIsMCPConfig(config);
        return config;
      },
    ).catch((error) => {
      logger.error(error);
      return { mcpServers: {} };
    });

    logger.info(`Loaded MCP config from ${configPath}`, {
      serverCount: Object.keys(config.mcpServers).length,
      servers: Object.keys(config.mcpServers),
    });

    return config;
  }

  private async connectToServers(config: MCPConfig): Promise<void> {
    const connectionPromises = Object.entries(config.mcpServers).map(
      async ([serverName, serverConfig]) => {
        try {
          await this.connectToServer(serverName, serverConfig);
        } catch (error) {
          logger.error(`Failed to connect to MCP server ${serverName}`, error);
        }
      },
    );

    await Promise.allSettled(connectionPromises);
  }

  private async connectToServer(
    serverName: string,
    config: MCPServerConfig,
  ): Promise<void> {
    logger.info(`Connecting to MCP server: ${serverName}`, {
      hasCommand: !!config.command,
      hasUrl: !!config.url,
    });

    let transport;
    let client;

    try {
      if (config.command) {
        // Stdio transport for command-based servers
        // Parse the command string into command and arguments
        const commandParts = config.command.split(" ");
        const command = commandParts[0];
        if (!command) {
          throw new Error(`Invalid command specified for server ${serverName}`);
        }
        const commandArgs = commandParts.slice(1);

        transport = new StdioClientTransport({
          command: command,
          args: commandArgs.concat(config.args || []),
          env: { ...Deno.env.toObject(), ...(config.env || {}) },
        });
      } else if (config.url) {
        // SSE transport for URL-based servers
        transport = new SSEClientTransport(new URL(config.url));
      } else {
        throw new Error(
          `Server ${serverName} must specify either 'command' or 'url'`,
        );
      }

      client = new Client(
        {
          name: "runt-ai",
          version: "1.0.0",
        },
        {
          capabilities: {
            tools: {},
          },
        },
      );

      await client.connect(transport);
      this.clients.set(serverName, client);

      logger.info(`Successfully connected to MCP server: ${serverName}`);
    } catch (error) {
      logger.error(`Failed to connect to MCP server ${serverName}`, error);
      if (transport) {
        try {
          await transport.close();
        } catch (closeError) {
          logger.debug(`Error closing transport for ${serverName}`, {
            error: String(closeError),
          });
        }
      }
      throw error;
    }
  }

  private async discoverTools(): Promise<void> {
    this.tools = [];

    const discoveryPromises = Array.from(this.clients.entries()).map(
      async ([serverName, client]) => {
        try {
          const response = await client.listTools();
          const tools = ListToolsResultSchema.parse(response).tools;

          for (const tool of tools) {
            this.tools.push({
              name: `mcp__${serverName}__${tool.name}`,
              description: tool.description || `Tool from ${serverName}`,
              parameters: tool.inputSchema as {
                type: string;
                properties: Record<string, unknown>;
                required?: string[];
              },
              serverName,
            });
          }

          logger.info(
            `Discovered ${tools.length} tools from server ${serverName}`,
            {
              tools: tools.map((t) => t.name),
            },
          );
        } catch (error) {
          logger.error(
            `Failed to discover tools from server ${serverName}`,
            error,
          );
        }
      },
    );

    await Promise.allSettled(discoveryPromises);
  }

  getTools(): MCPTool[] {
    return [...this.tools];
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (!this.isInitialized) {
      throw new Error("MCP client not initialized");
    }

    // Parse server name and tool name
    const colonIndex = toolName.indexOf(":");
    if (colonIndex === -1) {
      throw new Error(
        `Invalid MCP tool name format: ${toolName}. Expected format: serverName:toolName`,
      );
    }

    const serverName = toolName.substring(0, colonIndex);
    const actualToolName = toolName.substring(colonIndex + 1);

    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    try {
      logger.info(
        `Calling MCP tool ${actualToolName} on server ${serverName}`,
        { args },
      );

      const response = await client.callTool({
        name: actualToolName,
        arguments: args,
      });

      const result = CallToolResultSchema.parse(response);

      // Process the tool result content
      if (result.content && result.content.length > 0) {
        const content = result.content[0];
        if (!content) {
          return `Tool ${toolName} executed successfully`;
        }
        if (content.type === "text") {
          return (content as { text: string }).text;
        } else if (content.type === "image") {
          return `[Image result from ${toolName}]`;
        } else if (content.type === "resource") {
          const resource =
            (content as { resource?: { uri?: string } }).resource;
          return `[Resource result from ${toolName}: ${
            resource?.uri || "unknown"
          }]`;
        }
      }

      return `Tool ${toolName} executed successfully`;
    } catch (error) {
      logger.error(`Error calling MCP tool ${toolName}`, error);
      throw new Error(
        `MCP tool call failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async close(): Promise<void> {
    const closePromises = Array.from(this.clients.values()).map(
      async (client) => {
        try {
          await client.close();
        } catch (error) {
          logger.debug("Error closing MCP client", { error: String(error) });
        }
      },
    );

    await Promise.allSettled(closePromises);
    this.clients.clear();
    this.tools = [];
    this.isInitialized = false;
    logger.info("MCP client closed");
  }
}

// Global MCP client instance
let mcpClient: MCPClient | null = null;

export async function getMCPClient(): Promise<MCPClient> {
  if (!mcpClient) {
    mcpClient = new MCPClient();
    await mcpClient.initialize();
  }
  return mcpClient;
}

export async function closeMCPClient(): Promise<void> {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
  }
}
