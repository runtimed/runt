# MCP (Model Context Protocol) Integration

The AI package now supports MCP (Model Context Protocol) integration, allowing you to extend AI capabilities with external tools and services.

## Overview

MCP integration allows your AI assistants to access additional tools beyond the built-in notebook tools. These tools can include:

- File system operations
- Web search capabilities
- Database queries
- GitHub repository access
- Custom business logic tools
- And many more...

## Configuration

### 1. Create MCP Configuration File

Create a configuration file at `~/.anode/mcp.json`:

```bash
mkdir -p ~/.anode
touch ~/.anode/mcp.json
```

### 2. Configure MCP Servers

Edit `~/.anode/mcp.json` to configure your desired MCP servers. Here's a comprehensive example showing all supported server types:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx -y @modelcontextprotocol/server-filesystem",
      "args": ["/path/to/allowed/directory"],
      "name": "Filesystem Server",
      "description": "Access and manipulate files and directories"
    },
    "brave-search": {
      "command": "npx -y @modelcontextprotocol/server-brave-search",
      "env": {
        "BRAVE_API_KEY": "your-brave-api-key-here"
      },
      "name": "Brave Search",
      "description": "Search the web using Brave Search API"
    },
    "github": {
      "command": "npx -y @modelcontextprotocol/server-github",
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-github-token-here"
      },
      "name": "GitHub Server",
      "description": "Access GitHub repositories and issues"
    },
    "postgres": {
      "command": "npx -y @modelcontextprotocol/server-postgres",
      "env": {
        "POSTGRES_CONNECTION_STRING": "postgresql://user:password@localhost:5432/database"
      },
      "name": "PostgreSQL Server",
      "description": "Query PostgreSQL databases"
    },
    "sqlite": {
      "command": "npx -y @modelcontextprotocol/server-sqlite",
      "args": ["/path/to/database.db"],
      "name": "SQLite Server", 
      "description": "Query SQLite databases"
    },
    "custom-sse-server": {
      "url": "http://localhost:8080/sse",
      "name": "Custom SSE Server",
      "description": "Custom MCP server using Server-Sent Events"
    }
  }
}
```

## Server Types

### Command-based Servers

Most MCP servers run as separate processes:

```json
{
  "your-server": {
    "command": "npx -y @modelcontextprotocol/server-package",
    "args": ["additional", "arguments"],
    "env": {
      "API_KEY": "your-api-key-here"
    },
    "name": "Server Name",
    "description": "Server description"
  }
}
```

### URL-based Servers (SSE)

For servers that use Server-Sent Events:

```json
{
  "your-sse-server": {
    "url": "http://localhost:8080/sse",
    "name": "SSE Server",
    "description": "Custom SSE-based server"
  }
}
```

## Available Official MCP Servers

Here are some popular official MCP servers you can use:

### Filesystem Access
```bash
npm install -g @modelcontextprotocol/server-filesystem
```

### Web Search (Brave)
```bash
npm install -g @modelcontextprotocol/server-brave-search
```
Requires: `BRAVE_API_KEY` environment variable

### GitHub Integration
```bash
npm install -g @modelcontextprotocol/server-github
```
Requires: `GITHUB_PERSONAL_ACCESS_TOKEN` environment variable

### Database Access
```bash
# PostgreSQL
npm install -g @modelcontextprotocol/server-postgres

# SQLite
npm install -g @modelcontextprotocol/server-sqlite
```

## Usage

Once configured, MCP tools are automatically available to AI assistants alongside built-in notebook tools. Tools are named with the format `serverName:toolName`.

### Example Usage

1. **File Operations**: `filesystem:read_file`, `filesystem:write_file`
2. **Web Search**: `brave-search:brave_web_search`
3. **GitHub Operations**: `github:create_issue`, `github:get_repo`
4. **Database Queries**: `postgres:query`, `sqlite:execute_query`

## Implementation Details

### Tool Discovery

The system automatically:
1. Reads configuration from `~/.anode/mcp.json`
2. Connects to configured MCP servers
3. Discovers available tools from each server
4. Makes tools available to AI assistants

### Tool Execution

When an AI assistant calls an MCP tool:
1. The tool name is parsed to extract server and tool names
2. The appropriate MCP server is located
3. The tool is executed with the provided arguments
4. Results are returned to the AI assistant

### Error Handling

- Failed server connections are logged but don't prevent startup
- Individual tool failures are reported to the AI assistant
- The system gracefully degrades to built-in tools if MCP is unavailable

## Security Considerations

1. **Filesystem Access**: Only grant access to directories you trust
2. **API Keys**: Store sensitive keys in environment variables
3. **Network Access**: Be cautious with URL-based servers
4. **Command Execution**: MCP servers run with your user permissions

## Troubleshooting

### Server Connection Issues

Check server logs and ensure:
- Required packages are installed globally
- Environment variables are set correctly
- File paths and permissions are correct

#### Using Full Paths to Executables

When using full paths in the `command` array, ensure:

1. **File exists**: The executable file exists at the specified path
2. **Permissions**: The file has execute permissions (`chmod +x /path/to/executable`)
3. **Correct format**: Use proper string and args format:
   ```json
   {
     "my-server": {
       "command": "/usr/local/bin/my-mcp-server",
       "args": ["--flag", "value"],
       "name": "My Server"
     }
   }
   ```

#### Common Path Issues

- **Permission denied**: Check file permissions with `ls -la /path/to/executable`
- **File not found**: Verify the path exists with `which executable-name` or `ls /path/to/executable`
- **Empty path**: Ensure the command string is not empty and contains a valid executable path

### Tool Discovery Problems

Verify:
- Server configuration syntax in `mcp.json`
- Server startup and connection success
- Tool compatibility with MCP specification

### Performance Considerations

- MCP tools add latency compared to built-in tools
- Network-based operations may be slower
- Consider caching for frequently used operations

## Examples

The configuration section above provides a complete example with multiple server types and configurations covering filesystem access, web search, GitHub integration, database access, and custom SSE servers. 