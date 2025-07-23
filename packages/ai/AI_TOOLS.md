# Using tools in the AI Agent

The AI agent now supports three classes of tools

- built-in tools: create cell, modify cell, and execute cell
- user-defined tools: A Python function decorated with with `@tool`
- MCP (Model Context Protocol) tools: Configure MCPs with the `~/.runt/mcp.json`
  file

MCP (Model Context Protocol) integration, allowing you to extend AI capabilities
with external tools and services.

User-defined and MCP tools will require the user to approve their use.

## User-defined tools

A user can register a function defined in a Python cell for the AI Agent to call
directly and utilize the result in its response without having to make a new
cell in the notebook to run the function.

To register a function decorate with `@tool`. Here's an example function to
determine the current date and time.

```python
import zoneinfo
import datetime as dt

@tool
def current_date_and_time(timezone: str) -> dt.datetime:
    """The current date and time for the provided timezone"""
    tz = zoneinfo.ZoneInfo(timezone)
    current = dt.datetime.now(tz)
    return current
```

The `@tool` decorator does not modify your function and you can still use it in
your notebook with no side-effects.

Be certain to have executed the cell with the decorated function definition
before chatting with th AI Agent.

Functions are registered to the AI Agent by analyzing the Python source to
generate the appropriate metadata for the AI agent to utilize as a tool. This is
done using
[openai-function-calling](https://github.com/jakecyr/openai-function-calling)
Python package.

In order to register your function for the AI Agent call it must

- have a docstring description
- set a type hint for every input argument
- return a JSON-serializable object
  - or just return a serialized string from your function

When functions are executed by the AI Agent it uses the full state of your
Python kernel. You can depend on variables executed in other cells and utilized
all of your installed packages.

## MCP integration

MCP integration allows your AI assistants to access additional tools beyond the
built-in notebook tools and user-defined tools. These tools can include:

- File system operations
- Web search capabilities
- Database queries
- GitHub repository access
- Custom business logic tools
- And many more...

### 1. Create MCP Configuration File

Create a configuration file at `~/.runt/mcp.json`:

```bash
mkdir -p ~/.runt
touch ~/.runt/mcp.json
```

### 2. Configure MCP Servers

The AI Agent supports STDIO and SSE MCP server types.

### Command-based Servers (STDIO)

Most MCP servers run as separate processes.

NOTE: for STDIO servers the `command` key must be an executable, not the full
command.

```json
{
  "your-server": {
    "command": "npx",
    "args": [
      "-y",
      "@modelcontextprotocol/server-package",
      "additional",
      "arguments"
    ],
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

Here's a comprehensive example showing all supported server types:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/allowed/directory"
      ],
      "name": "Filesystem Server",
      "description": "Access and manipulate files and directories"
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your-brave-api-key-here"
      },
      "name": "Brave Search",
      "description": "Search the web using Brave Search API"
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-github-token-here"
      },
      "name": "GitHub Server",
      "description": "Access GitHub repositories and issues"
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_CONNECTION_STRING": "postgresql://user:password@localhost:5432/database"
      },
      "name": "PostgreSQL Server",
      "description": "Query PostgreSQL databases"
    },
    "sqlite": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sqlite",
        "/path/to/database.db"
      ],
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

## Security Considerations

1. **Filesystem Access**: Only grant access to directories you trust
2. **API Keys**: Store sensitive keys in environment variables
3. **Network Access**: Be cautious with URL-based servers
4. **Command Execution**: MCP servers run with your user permissions
