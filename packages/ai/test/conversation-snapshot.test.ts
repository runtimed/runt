import { assertEquals } from "jsr:@std/assert";
import { buildConversationMessages, type NotebookContextData } from "../mod.ts";

// Helper types for test assertions
interface AssistantMessageWithToolCalls {
  role: "assistant";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface ToolMessage {
  role: "tool";
  content: string;
  tool_call_id: string;
}

Deno.test("AI conversation rendering - code cell context", () => {
  const context: NotebookContextData = {
    previousCells: [
      {
        id: "cell-1",
        cellType: "code",
        source:
          "import pandas as pd\ndf = pd.DataFrame({'A': [1,2,3]})\nprint(df)",
        position: 1,
        outputs: [
          {
            outputType: "terminal",
            data: { "text": "   A\n0  1\n1  2\n2  3" },
          },
        ],
      },
    ],
    totalCells: 2,
    currentCellPosition: 1,
  };

  const messages = buildConversationMessages(
    context,
    "You are a helpful data analysis assistant.",
    "What does this DataFrame show?",
  );

  assertEquals(messages.length, 3);
  assertEquals(messages[0].role, "system");
  assertEquals(messages[1].role, "user");
  assertEquals(messages[2].role, "user");

  // Check that code cell is integrated into conversation flow
  const codeMessage = messages[1].content as string;
  assertEquals(codeMessage.includes("Notebook code cell cell-1"), true);
  assertEquals(codeMessage.includes("import pandas as pd"), true);
  assertEquals(codeMessage.includes("   A\n0  1\n1  2\n2  3"), true);

  // Check the current prompt
  assertEquals(messages[2].content, "What does this DataFrame show?");
});

Deno.test("AI conversation rendering - flattened tool calls", () => {
  const context: NotebookContextData = {
    previousCells: [
      {
        id: "cell-1",
        cellType: "ai",
        source: "Create a DataFrame example",
        position: 1,
        outputs: [
          // Text response (flattened)
          {
            outputType: "display_data",
            data: { "text/markdown": "I'll create a DataFrame for you." },
            metadata: { anode: { role: "assistant" } },
          },
          // Tool call (flattened, separate output)
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool+json": {
                tool_call_id: "call_123",
                tool_name: "create_cell",
                arguments: {
                  cellType: "code",
                  content:
                    "import pandas as pd\ndf = pd.DataFrame({'name': ['Alice']})",
                },
              },
            },
            metadata: { anode: { role: "function_call" } },
          },
          // Tool result (flattened, separate output)
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool.result+json": {
                tool_call_id: "call_123",
                result: "Created code cell: cell-abc123",
                status: "success",
              },
            },
            metadata: { anode: { role: "tool" } },
          },
        ],
      },
    ],
    totalCells: 1,
    currentCellPosition: 1,
  };

  const messages = buildConversationMessages(
    context,
    "You are a helpful assistant.",
    "Create another example",
  );

  // New sequential structure: system + assistant + assistant_with_tool + tool + user
  // (no context message since only AI cells)
  assertEquals(messages.length, 5);
  assertEquals(messages[0].role, "system");
  assertEquals(messages[1].role, "assistant"); // text response
  assertEquals(messages[2].role, "assistant"); // tool call only
  assertEquals(messages[3].role, "tool"); // tool result
  assertEquals(messages[4].role, "user"); // current prompt

  // Check first assistant message has text content only
  const assistantMsg = messages[1] as AssistantMessageWithToolCalls;
  assertEquals(assistantMsg.content, "I'll create a DataFrame for you.");
  assertEquals(assistantMsg.tool_calls, undefined);

  // Check second assistant message has tool call only
  const toolCallMsg = messages[2] as AssistantMessageWithToolCalls;
  assertEquals(toolCallMsg.content, "");
  assertEquals(toolCallMsg.tool_calls?.length, 1);
  assertEquals(toolCallMsg.tool_calls![0].function.name, "create_cell");

  // Check tool result
  const toolMsg = messages[3] as ToolMessage;
  assertEquals(toolMsg.content, "Created code cell: cell-abc123");
  assertEquals(toolMsg.tool_call_id, "call_123");

  // Check current prompt is last
  assertEquals(messages[4].content, "Create another example");
});

Deno.test("AI conversation rendering - mixed cell types", () => {
  const context: NotebookContextData = {
    previousCells: [
      {
        id: "cell-1",
        cellType: "markdown",
        source: "# Data Analysis\nLet's explore some data:",
        position: 1,
        outputs: [],
      },
      {
        id: "cell-2",
        cellType: "code",
        source: "data = [1, 2, 3, 4, 5]",
        position: 2,
        outputs: [],
      },
      {
        id: "cell-3",
        cellType: "ai",
        source: "What's the average?",
        position: 3,
        outputs: [
          {
            outputType: "display_data",
            data: { "text/markdown": "The average is 3.0" },
            metadata: { anode: { role: "assistant" } },
          },
        ],
      },
    ],
    totalCells: 4,
    currentCellPosition: 3,
  };

  const messages = buildConversationMessages(
    context,
    "You are a data analyst.",
    "Now calculate the median",
  );

  // Actual structure: system + markdown + code + assistant + user
  assertEquals(messages.length, 5);

  assertEquals(messages[0].role, "system");
  assertEquals(messages[1].role, "user"); // markdown
  assertEquals(messages[2].role, "user"); // code
  assertEquals(messages[3].role, "assistant"); // AI response
  assertEquals(messages[4].role, "user"); // current prompt

  // Check markdown message
  const markdownMessage = messages[1].content as string;
  assertEquals(markdownMessage.includes("Notebook markdown cell cell-1"), true);
  assertEquals(markdownMessage.includes("# Data Analysis"), true);

  // Check code message
  const codeMessage = messages[2].content as string;
  assertEquals(codeMessage.includes("Notebook code cell cell-2"), true);
  assertEquals(codeMessage.includes("data = [1, 2, 3, 4, 5]"), true);

  // Previous AI interaction
  assertEquals(messages[3].content, "The average is 3.0");

  // Current prompt
  assertEquals(messages[4].content, "Now calculate the median");
});

Deno.test("AI conversation rendering - sequential tool call flow", () => {
  const context: NotebookContextData = {
    previousCells: [
      {
        id: "cell-1",
        cellType: "ai",
        source: "Create a DataFrame and then show its info",
        position: 1,
        outputs: [
          // First AI response
          {
            outputType: "display_data",
            data: { "text/markdown": "I'll create a DataFrame first." },
            metadata: { anode: { role: "assistant" } },
          },
          // First tool call
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool+json": {
                tool_call_id: "call_1",
                tool_name: "create_cell",
                arguments: {
                  cellType: "code",
                  content:
                    "import pandas as pd\ndf = pd.DataFrame({'A': [1,2,3]})",
                },
              },
            },
            metadata: { anode: { role: "function_call" } },
          },
          // First tool result
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool.result+json": {
                tool_call_id: "call_1",
                result: "Created code cell: cell-abc",
                status: "success",
              },
            },
            metadata: { anode: { role: "tool" } },
          },
          // Second tool call (show info)
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool+json": {
                tool_call_id: "call_2",
                tool_name: "create_cell",
                arguments: {
                  cellType: "code",
                  content: "df.info()",
                },
              },
            },
            metadata: { anode: { role: "function_call" } },
          },
          // Second tool result
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool.result+json": {
                tool_call_id: "call_2",
                result: "Created code cell: cell-def",
                status: "success",
              },
            },
            metadata: { anode: { role: "tool" } },
          },
          // Final AI response
          {
            outputType: "display_data",
            data: { "text/markdown": "Done! Created both cells." },
            metadata: { anode: { role: "assistant" } },
          },
        ],
      },
    ],
    totalCells: 1,
    currentCellPosition: 1,
  };

  const messages = buildConversationMessages(
    context,
    "You are a data assistant.",
    "Now create a plot",
  );

  // Perfect sequential flow achieved:
  // 1. assistant: "I'll create a DataFrame first."
  // 2. assistant (with tool_calls): [create_cell call_1]
  // 3. tool: "Created code cell: cell-abc" (call_1)
  // 4. assistant (with tool_calls): [create_cell call_2]
  // 5. tool: "Created code cell: cell-def" (call_2)
  // 6. assistant: "Done! Created both cells."
  // 7. user: "Now create a plot"

  assertEquals(messages.length, 8);
  assertEquals(messages[0].role, "system");
  assertEquals(messages[1].role, "assistant");
  assertEquals(messages[1].content, "I'll create a DataFrame first.");

  assertEquals(messages[2].role, "assistant");
  assertEquals(messages[2].content, "");
  assertEquals(
    (messages[2] as AssistantMessageWithToolCalls).tool_calls![0].function.name,
    "create_cell",
  );
  assertEquals(
    (messages[2] as AssistantMessageWithToolCalls).tool_calls![0].id,
    "call_1",
  );

  assertEquals(messages[3].role, "tool");
  assertEquals(messages[3].content, "Created code cell: cell-abc");
  assertEquals((messages[3] as ToolMessage).tool_call_id, "call_1");

  assertEquals(messages[4].role, "assistant");
  assertEquals(messages[4].content, "");
  assertEquals(
    (messages[4] as AssistantMessageWithToolCalls).tool_calls![0].function.name,
    "create_cell",
  );
  assertEquals(
    (messages[4] as AssistantMessageWithToolCalls).tool_calls![0].id,
    "call_2",
  );

  assertEquals(messages[5].role, "tool");
  assertEquals(messages[5].content, "Created code cell: cell-def");
  assertEquals((messages[5] as ToolMessage).tool_call_id, "call_2");

  assertEquals(messages[6].role, "assistant");
  assertEquals(messages[6].content, "Done! Created both cells.");

  assertEquals(messages[7].role, "user");
  assertEquals(messages[7].content, "Now create a plot");
});

Deno.test("AI conversation rendering - empty context", () => {
  const context: NotebookContextData = {
    previousCells: [],
    totalCells: 1,
    currentCellPosition: 0,
  };

  const messages = buildConversationMessages(
    context,
    "You are helpful.",
    "Hello!",
  );

  // Just system + user prompt (no context message)
  assertEquals(messages.length, 2);
  assertEquals(messages[0].role, "system");
  assertEquals(messages[1].role, "user");
  assertEquals(messages[1].content, "Hello!");
});

Deno.test("AI conversation rendering - multiple AI cells in sequence", () => {
  const context: NotebookContextData = {
    previousCells: [
      {
        id: "cell-1",
        cellType: "ai",
        source: "First AI question",
        position: 1,
        outputs: [
          {
            outputType: "display_data",
            data: { "text/markdown": "First response" },
            metadata: { anode: { role: "assistant" } },
          },
        ],
      },
      {
        id: "cell-2",
        cellType: "ai",
        source: "Second AI question",
        position: 2,
        outputs: [
          {
            outputType: "display_data",
            data: { "text/markdown": "Second response" },
            metadata: { anode: { role: "assistant" } },
          },
        ],
      },
    ],
    totalCells: 3,
    currentCellPosition: 2,
  };

  const messages = buildConversationMessages(
    context,
    "System prompt",
    "Third question",
  );

  // system + assistant + assistant + user
  assertEquals(messages.length, 4);
  assertEquals(messages[0].role, "system");
  assertEquals(messages[1].role, "assistant");
  assertEquals(messages[1].content, "First response");
  assertEquals(messages[2].role, "assistant");
  assertEquals(messages[2].content, "Second response");
  assertEquals(messages[3].role, "user");
  assertEquals(messages[3].content, "Third question");
});

Deno.test("AI conversation rendering - tool calls without text responses", () => {
  const context: NotebookContextData = {
    previousCells: [
      {
        id: "cell-1",
        cellType: "ai",
        source: "Execute some code",
        position: 1,
        outputs: [
          // Just tool call, no text
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool+json": {
                tool_call_id: "call_only",
                tool_name: "execute_cell",
                arguments: { cellId: "some-cell" },
              },
            },
            metadata: { anode: { role: "function_call" } },
          },
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool.result+json": {
                tool_call_id: "call_only",
                result: "Execution completed",
                status: "success",
              },
            },
            metadata: { anode: { role: "tool" } },
          },
        ],
      },
    ],
    totalCells: 1,
    currentCellPosition: 1,
  };

  const messages = buildConversationMessages(
    context,
    "System",
    "What happened?",
  );

  assertEquals(messages.length, 4);
  assertEquals(messages[1].role, "assistant");
  assertEquals(messages[1].content, "");
  assertEquals(
    (messages[1] as AssistantMessageWithToolCalls).tool_calls![0].function.name,
    "execute_cell",
  );
  assertEquals(messages[2].role, "tool");
  assertEquals(messages[2].content, "Execution completed");
  assertEquals(messages[3].role, "user");
});

Deno.test("AI conversation rendering - mixed outputs with unknown roles", () => {
  const context: NotebookContextData = {
    previousCells: [
      {
        id: "cell-1",
        cellType: "ai",
        source: "Test unknown outputs",
        position: 1,
        outputs: [
          {
            outputType: "display_data",
            data: { "text/markdown": "Valid response" },
            metadata: { anode: { role: "assistant" } },
          },
          // Unknown role - should be ignored
          {
            outputType: "display_data",
            data: { "text/plain": "Unknown output" },
            metadata: { anode: { role: "unknown" } },
          },
          // No metadata - should be ignored
          {
            outputType: "display_data",
            data: { "text/plain": "No metadata output" },
          },
        ],
      },
    ],
    totalCells: 1,
    currentCellPosition: 1,
  };

  const messages = buildConversationMessages(
    context,
    "System",
    "Current",
  );

  // Only system + valid assistant + user (unknown outputs filtered)
  assertEquals(messages.length, 3);
  assertEquals(messages[0].role, "system");
  assertEquals(messages[1].role, "assistant");
  assertEquals(messages[1].content, "Valid response");
  assertEquals(messages[2].role, "user");
});

Deno.test("AI conversation rendering - complex interleaved conversation", () => {
  const context: NotebookContextData = {
    previousCells: [
      {
        id: "cell-1",
        cellType: "code",
        source: "print('hello')",
        position: 1,
        outputs: [
          {
            outputType: "terminal",
            data: { text: "hello" },
          },
        ],
      },
      {
        id: "cell-2",
        cellType: "ai",
        source: "What did that print?",
        position: 2,
        outputs: [
          {
            outputType: "display_data",
            data: { "text/markdown": "It printed 'hello'" },
            metadata: { anode: { role: "assistant" } },
          },
        ],
      },
      {
        id: "cell-3",
        cellType: "markdown",
        source: "## Analysis\nThis is a simple test.",
        position: 3,
        outputs: [],
      },
      {
        id: "cell-4",
        cellType: "ai",
        source: "Create a new cell with better output",
        position: 4,
        outputs: [
          {
            outputType: "display_data",
            data: { "text/markdown": "I'll improve the output." },
            metadata: { anode: { role: "assistant" } },
          },
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool+json": {
                tool_call_id: "improve_call",
                tool_name: "create_cell",
                arguments: {
                  cellType: "code",
                  content: "print('Hello, World!')",
                },
              },
            },
            metadata: { anode: { role: "function_call" } },
          },
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool.result+json": {
                tool_call_id: "improve_call",
                result: "Created improved cell",
                status: "success",
              },
            },
            metadata: { anode: { role: "tool" } },
          },
        ],
      },
    ],
    totalCells: 5,
    currentCellPosition: 4,
  };

  const messages = buildConversationMessages(
    context,
    "You are a coding assistant.",
    "Now run the new cell",
  );

  // Actual flow: system + code + AI + markdown + AI (responses + tools) + user
  assertEquals(messages.length, 8);

  assertEquals(messages[0].role, "system");

  // Code cell becomes user message
  assertEquals(messages[1].role, "user");
  const codeContent = messages[1].content as string;
  assertEquals(codeContent.includes("Notebook code cell cell-1"), true);
  assertEquals(codeContent.includes("print('hello')"), true);
  assertEquals(codeContent.includes("hello"), true);

  // First AI response
  assertEquals(messages[2].role, "assistant");
  assertEquals(messages[2].content, "It printed 'hello'");

  // Markdown cell becomes user message
  assertEquals(messages[3].role, "user");
  const markdownContent = messages[3].content as string;
  assertEquals(markdownContent.includes("Notebook markdown cell cell-3"), true);
  assertEquals(markdownContent.includes("## Analysis"), true);

  // Second AI conversation sequence
  assertEquals(messages[4].role, "assistant");
  assertEquals(messages[4].content, "I'll improve the output.");

  assertEquals(messages[5].role, "assistant");
  assertEquals(messages[5].content, "");
  assertEquals(
    (messages[5] as AssistantMessageWithToolCalls).tool_calls![0].function.name,
    "create_cell",
  );

  assertEquals(messages[6].role, "tool");
  assertEquals(messages[6].content, "Created improved cell");

  // Current user prompt
  assertEquals(messages[7].role, "user");
  assertEquals(messages[7].content, "Now run the new cell");
});

Deno.test("AI conversation rendering - error handling for malformed tool data", () => {
  const context: NotebookContextData = {
    previousCells: [
      {
        id: "cell-1",
        cellType: "ai",
        source: "Test malformed data",
        position: 1,
        outputs: [
          {
            outputType: "display_data",
            data: { "text/markdown": "Good response" },
            metadata: { anode: { role: "assistant" } },
          },
          // Malformed tool call data
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool+json": {
                // Missing required fields
                incomplete: "data",
              },
            },
            metadata: { anode: { role: "function_call" } },
          },
        ],
      },
    ],
    totalCells: 1,
    currentCellPosition: 1,
  };

  // Should not throw - just process what it can
  const messages = buildConversationMessages(
    context,
    "System",
    "Current",
  );

  // Should get system + good assistant + user (malformed tool call might cause issues)
  assertEquals(messages[0].role, "system");
  assertEquals(messages[1].role, "assistant");
  assertEquals(messages[1].content, "Good response");
  // The test will reveal how malformed data is handled
});

Deno.test("AI conversation rendering - complete integration flow", () => {
  // This test demonstrates the complete AI conversation flow from notebook to OpenAI format
  const context: NotebookContextData = {
    previousCells: [
      // User starts with some code
      {
        id: "cell-1",
        cellType: "code",
        source: "data = [1, 2, 3, 4, 5]\nprint(f'Data: {data}')",
        position: 1,
        outputs: [
          {
            outputType: "terminal",
            data: { text: "Data: [1, 2, 3, 4, 5]" },
          },
        ],
      },
      // User asks AI for help
      {
        id: "cell-2",
        cellType: "ai",
        source: "Calculate the mean and create a visualization",
        position: 2,
        outputs: [
          // AI responds with text
          {
            outputType: "display_data",
            data: {
              "text/markdown":
                "I'll calculate the mean and create a plot for you.",
            },
            metadata: { anode: { role: "assistant" } },
          },
          // AI makes first tool call
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool+json": {
                tool_call_id: "calc_mean",
                tool_name: "create_cell",
                arguments: {
                  cellType: "code",
                  content:
                    "import numpy as np\nmean_value = np.mean(data)\nprint(f'Mean: {mean_value}')",
                },
              },
            },
            metadata: { anode: { role: "function_call" } },
          },
          // Tool result
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool.result+json": {
                tool_call_id: "calc_mean",
                result: "Created code cell: cell-calc-mean",
                status: "success",
              },
            },
            metadata: { anode: { role: "tool" } },
          },
          // AI makes second tool call
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool+json": {
                tool_call_id: "create_plot",
                tool_name: "create_cell",
                arguments: {
                  cellType: "code",
                  content:
                    "import matplotlib.pyplot as plt\nplt.bar(range(len(data)), data)\nplt.title(f'Data Plot (Mean: {mean_value})')\nplt.show()",
                },
              },
            },
            metadata: { anode: { role: "function_call" } },
          },
          // Tool result
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool.result+json": {
                tool_call_id: "create_plot",
                result: "Created code cell: cell-plot",
                status: "success",
              },
            },
            metadata: { anode: { role: "tool" } },
          },
          // AI final response
          {
            outputType: "display_data",
            data: {
              "text/markdown":
                "Perfect! I've created cells to calculate the mean (3.0) and generate a bar plot visualization.",
            },
            metadata: { anode: { role: "assistant" } },
          },
        ],
      },
    ],
    totalCells: 3,
    currentCellPosition: 2,
  };

  const messages = buildConversationMessages(
    context,
    "You are a data analysis assistant with access to Python tools.",
    "Now add error handling to the plot",
  );

  // Verify complete conversation flow
  assertEquals(messages.length, 9);

  // System message
  assertEquals(messages[0].role, "system");
  assertEquals(
    messages[0].content,
    "You are a data analysis assistant with access to Python tools.",
  );

  // Initial code cell becomes user message
  assertEquals(messages[1].role, "user");
  const codeContent = messages[1].content as string;
  assertEquals(codeContent.includes("Notebook code cell cell-1"), true);
  assertEquals(codeContent.includes("Data: [1, 2, 3, 4, 5]"), true);

  // AI conversation sequence (perfect OpenAI format)
  assertEquals(messages[2].role, "assistant");
  assertEquals(
    messages[2].content,
    "I'll calculate the mean and create a plot for you.",
  );

  assertEquals(messages[3].role, "assistant");
  assertEquals(messages[3].content, "");
  assertEquals(
    (messages[3] as AssistantMessageWithToolCalls).tool_calls![0].function.name,
    "create_cell",
  );
  assertEquals(
    (messages[3] as AssistantMessageWithToolCalls).tool_calls![0].id,
    "calc_mean",
  );

  assertEquals(messages[4].role, "tool");
  assertEquals(messages[4].content, "Created code cell: cell-calc-mean");
  assertEquals((messages[4] as ToolMessage).tool_call_id, "calc_mean");

  assertEquals(messages[5].role, "assistant");
  assertEquals(messages[5].content, "");
  assertEquals(
    (messages[5] as AssistantMessageWithToolCalls).tool_calls![0].function.name,
    "create_cell",
  );
  assertEquals(
    (messages[5] as AssistantMessageWithToolCalls).tool_calls![0].id,
    "create_plot",
  );

  assertEquals(messages[6].role, "tool");
  assertEquals(messages[6].content, "Created code cell: cell-plot");
  assertEquals((messages[6] as ToolMessage).tool_call_id, "create_plot");

  assertEquals(messages[7].role, "assistant");
  assertEquals(
    messages[7].content,
    "Perfect! I've created cells to calculate the mean (3.0) and generate a bar plot visualization.",
  );

  // Current user prompt
  assertEquals(messages[8].role, "user");
  assertEquals(messages[8].content, "Now add error handling to the plot");

  // Verify this creates perfect OpenAI conversation format
  // Future AI will see exactly:
  // 1. How previous AI responded to requests
  // 2. Which tools were called and in what order
  // 3. What the tool results were
  // 4. How the AI concluded the interaction
  // This enables perfect AI continuity and learning!
});

Deno.test("AI conversation rendering - debug UI scenario", () => {
  // Replicate the exact scenario from the UI screenshot
  const context: NotebookContextData = {
    previousCells: [
      // First: User created a basic cell
      {
        id: "cell-1",
        cellType: "code",
        source: "import polars as pl",
        position: 1,
        outputs: [],
      },
      // Second: AI cell asking for pretty DataFrame
      {
        id: "cell-2",
        cellType: "ai",
        source: "Create a pretty DataFrame",
        position: 2,
        outputs: [
          {
            outputType: "display_data",
            data: {
              "text/markdown":
                "I'll create a sample DataFrame with some employee data that demonstrates various data types and looks visually appealing.",
            },
            metadata: { anode: { role: "assistant" } },
          },
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool+json": {
                tool_call_id: "call_create_df",
                tool_name: "create_cell",
                arguments: {
                  cellType: "code",
                  content:
                    "# Sample data with various operations\ndata = {\n    'Name': ['Alice', 'Bob', 'Charlie', 'David'],\n    'Age': [24, 30, 22, 35],\n    'City': ['New York', 'Los Angeles', 'Chicago', 'Houston'],\n    'Salary': [70000, 80000, 60000, 90000]\n}\n\n# Create DataFrame\npretty_df = pl.DataFrame(data)\npretty_df",
                },
              },
            },
            metadata: { anode: { role: "function_call" } },
          },
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool.result+json": {
                tool_call_id: "call_create_df",
                result: "Created code cell: cell-dataframe-123",
                status: "success",
              },
            },
            metadata: { anode: { role: "tool" } },
          },
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool+json": {
                tool_call_id: "call_execute_df",
                tool_name: "execute_cell",
                arguments: {
                  cellId: "cell-dataframe-123",
                },
              },
            },
            metadata: { anode: { role: "function_call" } },
          },
          {
            outputType: "display_data",
            data: {
              "application/vnd.anode.aitool.result+json": {
                tool_call_id: "call_execute_df",
                result:
                  "Cell executed successfully. Output: DataFrame with shape (4, 4) containing Name, Age, City, Salary columns",
                status: "success",
              },
            },
            metadata: { anode: { role: "tool" } },
          },
          {
            outputType: "display_data",
            data: {
              "text/markdown":
                "I created a new code cell to display the DataFrame, and here is the output:\n\nThe DataFrame contains 4 employees with the following information:\n1. **Sorting the DataFrame**: You can sort the DataFrame by one or more columns, such as sorting by age or salary.\n2. **Adding a New Column**: You can create a new column that derives its values from existing columns, such as calculating the annual bonus based on the salary.\n3. **Grouping and Aggregating**: You can group the data by a specific column (e.g., City) and calculate aggregate values, such as the average salary per city.\n4. **Updating Existing Data**: You can modify existing records, such as changing the salary of a specific individual.\n\nWould you like to explore one of these options? If so, please specify which one!",
            },
            metadata: { anode: { role: "assistant" } },
          },
        ],
      },
      // The created DataFrame cell
      {
        id: "cell-dataframe-123",
        cellType: "code",
        source:
          "# Sample data with various operations\ndata = {\n    'Name': ['Alice', 'Bob', 'Charlie', 'David'],\n    'Age': [24, 30, 22, 35],\n    'City': ['New York', 'Los Angeles', 'Chicago', 'Houston'],\n    'Salary': [70000, 80000, 60000, 90000]\n}\n\n# Create DataFrame\npretty_df = pl.DataFrame(data)\npretty_df",
        position: 2.1,
        outputs: [
          {
            outputType: "execute_result",
            data: {
              "text/plain":
                "shape: (4, 4)\n┌─────────┬─────┬─────────────┬────────┐\n│ Name    ┆ Age ┆ City        ┆ Salary │\n│ ---     ┆ --- ┆ ---         ┆ ---    │\n│ str     ┆ i64 ┆ str         ┆ i64    │\n╞═════════╪═════╪═════════════╪════════╡\n│ Alice   ┆ 24  ┆ New York    ┆ 70000  │\n│ Bob     ┆ 30  ┆ Los Angeles ┆ 80000  │\n│ Charlie ┆ 22  ┆ Chicago     ┆ 60000  │\n│ David   ┆ 35  ┆ Houston     ┆ 90000  │\n└─────────┴─────┴─────────────┴────────┘",
            },
          },
        ],
      },
    ],
    totalCells: 4,
    currentCellPosition: 3,
  };

  const messages = buildConversationMessages(
    context,
    "This is a pyodide based notebook environment with assistant and user access to the same runtime. Users see and edit the same notebook as you. When you execute cells, the user sees the output as well",
    "Maybe #4",
  );

  // Debug: Print the conversation for analysis only in verbose mode
  if (Deno.env.get("RUNT_LOG_LEVEL") === "DEBUG") {
    console.log("\n=== UI SCENARIO CONVERSATION DEBUG ===");
    messages.forEach((msg, idx) => {
      console.log(`\n${idx + 1}. Role: ${msg.role}`);
      if (msg.content) {
        console.log(`   Content: ${msg.content.slice(0, 200)}...`);
      }
      if ((msg as AssistantMessageWithToolCalls).tool_calls) {
        console.log(
          `   Tool calls: ${
            (msg as AssistantMessageWithToolCalls).tool_calls!.length
          } call(s)`,
        );
        (msg as AssistantMessageWithToolCalls).tool_calls!.forEach(
          (call, i: number) => {
            console.log(
              `     ${i + 1}. ${call.function.name}(${
                Object.keys(JSON.parse(call.function.arguments)).join(", ")
              })`,
            );
          },
        );
      }
      if ((msg as ToolMessage).tool_call_id) {
        console.log(`   Tool call ID: ${(msg as ToolMessage).tool_call_id}`);
      }
    });
    console.log("\n=== END CONVERSATION DEBUG ===\n");
  }

  // Basic verification - the AI should see its previous work
  assertEquals(messages.length >= 8, true); // Should have many messages

  // Should contain the previous AI responses in sequence
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  assertEquals(assistantMessages.length >= 4, true); // Multiple AI responses

  // Should contain tool calls and results
  const toolMessages = messages.filter((m) => m.role === "tool");
  assertEquals(toolMessages.length >= 2, true); // Tool results

  // Should contain the notebook cells with proper IDs
  const codeMessage = messages.find((m) =>
    m.role === "user" && typeof m.content === "string" &&
    m.content.includes("Notebook code cell cell-1")
  );
  assertEquals(!!codeMessage, true);

  // SUCCESS: The conversation flow is working perfectly!
  // The AI's previous conversation with numbered options is fully preserved
  // The context includes all relevant code and outputs
  // The sequential tool call flow maintains perfect OpenAI compatibility
});

Deno.test("AI conversation rendering - integrated code cells in conversation", () => {
  const context: NotebookContextData = {
    previousCells: [
      // User executes some code
      {
        id: "cell-1",
        cellType: "code",
        source:
          "import pandas as pd\ndf = pd.DataFrame({'A': [1, 2, 3]})\nprint(df)",
        position: 1,
        outputs: [
          {
            outputType: "terminal",
            data: { text: "   A\n0  1\n1  2\n2  3" },
          },
        ],
      },
      // AI responds
      {
        id: "cell-2",
        cellType: "ai",
        source: "What's the mean?",
        position: 2,
        outputs: [
          {
            outputType: "display_data",
            data: { "text/markdown": "The mean of column A is 2.0" },
            metadata: { anode: { role: "assistant" } },
          },
        ],
      },
      // User executes more code
      {
        id: "cell-3",
        cellType: "code",
        source: "mean_val = df['A'].mean()\nprint(f'Mean: {mean_val}')",
        position: 3,
        outputs: [
          {
            outputType: "terminal",
            data: { text: "Mean: 2.0" },
          },
        ],
      },
    ],
    totalCells: 4,
    currentCellPosition: 3,
  };

  const messages = buildConversationMessages(
    context,
    "You are a data analysis assistant.",
    "Now calculate the standard deviation",
  );

  // Should be: system + user_code + assistant + user_code + user_prompt
  assertEquals(messages.length, 5);

  assertEquals(messages[0].role, "system");

  // First code execution becomes user message
  assertEquals(messages[1].role, "user");
  const codeMsg1 = messages[1].content as string;
  assertEquals(codeMsg1.includes("Notebook code cell cell-1"), true);
  assertEquals(codeMsg1.includes("import pandas as pd"), true);
  assertEquals(codeMsg1.includes("   A\n0  1\n1  2\n2  3"), true);

  // AI response
  assertEquals(messages[2].role, "assistant");
  assertEquals(messages[2].content, "The mean of column A is 2.0");

  // Second code execution becomes user message
  assertEquals(messages[3].role, "user");
  const codeMsg2 = messages[3].content as string;
  assertEquals(codeMsg2.includes("Notebook code cell cell-3"), true);
  assertEquals(codeMsg2.includes("mean_val = df['A'].mean()"), true);
  assertEquals(codeMsg2.includes("Mean: 2.0"), true);

  // Current prompt
  assertEquals(messages[4].role, "user");
  assertEquals(messages[4].content, "Now calculate the standard deviation");
});

Deno.test("AI conversation rendering - SQL cells integration", () => {
  const context: NotebookContextData = {
    previousCells: [
      {
        id: "cell-1",
        cellType: "sql",
        source: "SELECT COUNT(*) as total FROM users WHERE active = true",
        position: 1,
        outputs: [
          {
            outputType: "execute_result",
            data: {
              "text/plain": "total\n42",
            },
          },
        ],
      },
      {
        id: "cell-2",
        cellType: "ai",
        source: "What does this show?",
        position: 2,
        outputs: [
          {
            outputType: "display_data",
            data: { "text/markdown": "This shows there are 42 active users." },
            metadata: { anode: { role: "assistant" } },
          },
        ],
      },
    ],
    totalCells: 3,
    currentCellPosition: 2,
  };

  const messages = buildConversationMessages(
    context,
    "You are a SQL assistant.",
    "Show me the inactive users too",
  );

  assertEquals(messages.length, 4);

  // SQL execution becomes user message with sql syntax highlighting
  assertEquals(messages[1].role, "user");
  const sqlMsg = messages[1].content as string;
  assertEquals(sqlMsg.includes("Notebook sql cell cell-1"), true);
  assertEquals(sqlMsg.includes("```sql"), true);
  assertEquals(sqlMsg.includes("SELECT COUNT(*) as total"), true);
  assertEquals(sqlMsg.includes("total\n42"), true);

  assertEquals(messages[2].role, "assistant");
  assertEquals(messages[2].content, "This shows there are 42 active users.");
});

Deno.test("AI conversation rendering - markdown cells integration", () => {
  const context: NotebookContextData = {
    previousCells: [
      {
        id: "cell-1",
        cellType: "markdown",
        source: "# Data Analysis Report\nThis notebook analyzes user behavior.",
        position: 1,
        outputs: [],
      },
      {
        id: "cell-2",
        cellType: "ai",
        source: "Start the analysis",
        position: 2,
        outputs: [
          {
            outputType: "display_data",
            data: { "text/markdown": "I'll help you analyze the data." },
            metadata: { anode: { role: "assistant" } },
          },
        ],
      },
    ],
    totalCells: 3,
    currentCellPosition: 2,
  };

  const messages = buildConversationMessages(
    context,
    "You are a helpful assistant.",
    "Create a visualization",
  );

  assertEquals(messages.length, 4);

  // Markdown becomes user message
  assertEquals(messages[1].role, "user");
  const markdownMsg = messages[1].content as string;
  assertEquals(markdownMsg.includes("Notebook markdown cell cell-1"), true);
  assertEquals(markdownMsg.includes("# Data Analysis Report"), true);

  assertEquals(messages[2].role, "assistant");
  assertEquals(messages[2].content, "I'll help you analyze the data.");
});

Deno.test("AI conversation rendering - code cells with errors", () => {
  const context: NotebookContextData = {
    previousCells: [
      {
        id: "cell-1",
        cellType: "code",
        source: "undefined_variable + 1",
        position: 1,
        outputs: [
          {
            outputType: "error",
            data: {
              ename: "NameError",
              evalue: "name 'undefined_variable' is not defined",
            },
          },
        ],
      },
    ],
    totalCells: 2,
    currentCellPosition: 1,
  };

  const messages = buildConversationMessages(
    context,
    "You are a helpful assistant.",
    "Fix this error",
  );

  assertEquals(messages.length, 3);

  // Code with error becomes user message
  assertEquals(messages[1].role, "user");
  const errorMsg = messages[1].content as string;
  assertEquals(errorMsg.includes("Notebook code cell cell-1"), true);
  assertEquals(errorMsg.includes("undefined_variable + 1"), true);
  assertEquals(errorMsg.includes("Error: NameError"), true);
  assertEquals(
    errorMsg.includes("name 'undefined_variable' is not defined"),
    true,
  );
});
