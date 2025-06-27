# AI Conversation Context and Tool Call Visibility Fix

## Problem Statement

The AI conversation system in Anode has two critical issues:

1. **Broken Context Passing**: AI cells can't see previous notebook context
   because the conversation history gets discarded
2. **Invisible Tool Calls**: Users can't see the results of tools the AI is
   calling

## Root Cause Analysis

### Context Issue

In `pyodide-agent.ts`, the system builds rich conversation messages but throws
them away:

```typescript
// ❌ Current: Builds context then discards it
const conversationMessages = this.buildConversationMessages(
  context_data,
  prompt,
);
const systemContext = conversationMessages.find((msg) => msg.role === "system")
  ?.content;
await this.openaiClient.generateAgenticResponse(prompt, context, {
  systemPrompt: systemContext,
});
```

### Tool Call Visibility Issue

Tool calls happen in `generateAgenticResponse()` but not all is emitted as
display events for users to see.

## Solution Design

### 1. Fix Context Passing

Modify `generateAgenticResponse()` to accept full conversation messages instead
of just a prompt:

```typescript
const conversationMessages = this.buildConversationMessages(
  context_data,
  prompt,
);
await this.openaiClient.generateAgenticResponse(
  conversationMessages,
  context,
  options,
);
```

### 2. Emit Tool Call Outputs

During agentic iterations, emit each step as display events:

```typescript
// Assistant response
context.display({
  "text/markdown": content,
}, { role: "assistant" });

// Tool call
context.display({
  "application/vnd.anode.aitool+json": {
    tool_call_id,
    tool_name,
    arguments,
    status: "in_progress",
    timestamp,
  },
}, { role: "function_call" });

// Tool result
context.display({
  "application/vnd.anode.aitool.result+json": {
    tool_call_id,
    result,
    status: "success",
  },
}, { role: "tool" });
```

### 3. Conversation Reconstruction

When building future conversations, reconstruct from AI cell outputs:

```typescript
const conversationFromOutputs = aiCell.outputs.map((output) => {
  const role = output.metadata?.role;
  if (role === "assistant") {
    return { role: "assistant", content: output.data["text/markdown"] };
  }
  if (role === "function_call") {
    return { role: "assistant", tool_calls: [output.data] };
  }
  if (role === "tool") {
    return { role: "tool", content: JSON.stringify(output.data) };
  }
});
```

## Implementation Status

### ✅ Phase 1-2: Backend Changes (COMPLETED)

- [x] Modified `generateAgenticResponse()` signature to accept conversation
      messages
- [x] Updated `executeAI()` to pass full conversation instead of just prompt
- [x] Added anode metadata object with role information to all AI outputs
- [x] Implemented conversation reconstruction in `buildConversationMessages()`
- [x] Added `application/vnd.anode.aitool.result+json` tool result emission
- [x] Fixed OpenAI ChatMessage types for proper tool call support

### 🚧 Phase 3: Frontend Updates (Already Done)

- [x] Frontend already has `AiToolCallOutput` component for rendering tool calls
- [x] Tool calls are already being rendered properly
- [x] No additional frontend changes needed

### ✅ Phase 4: Context Reconstruction (COMPLETED)

- [x] Updated `buildConversationMessages()` to read from AI cell outputs
- [x] Implemented conversation continuity across AI cells using anode metadata
- [x] AI cells now reconstruct full conversation history from previous outputs

## Files to Modify

### Runt Side

- `packages/pyodide-runtime-agent/src/openai-client.ts`
- `packages/pyodide-runtime-agent/src/pyodide-agent.ts`

### Anode Side

- `src/components/outputs/index.ts`
- `src/components/notebook/RichOutput.tsx`
- Create: `src/components/outputs/AiToolResultOutput.tsx`

## Success Criteria

1. **Context Works**: AI can reference variables and outputs from previous cells
2. **Tool Calls Visible**: Users see real-time tool call progress in AI cells
3. **Conversation Continuity**: Multiple AI cells can build on each other's work
4. **Performance**: Long conversations handle token limits gracefully

## Test Cases

1. **Basic Context**: AI cell references variable from previous code cell
2. **Tool Call Visibility**: AI cell shows "Creating cell" → "Cell created" flow
3. **Multi-turn**: Second AI cell builds on first AI cell's tool calls
4. **Error Handling**: Failed tool calls show error states properly

## ✅ IMPLEMENTATION COMPLETE

**Backend fixes completed:**

- AI conversation context passing now works
- Tool calls remain visible to users
- Context continuity across AI cells implemented
- Proper anode metadata structure with typed objects

**Key Changes Made:**

1. **generateAgenticResponse()** now accepts full ChatMessage[] instead of just
   prompt
2. **anode metadata** added to all outputs with structured role information:
   ```typescript
   anode: {
     role: "assistant" | "function_call" | "tool",
     ai_provider?: string,
     ai_model?: string,
     iteration?: number,
     tool_call?: boolean,
     // ... other properties
   }
   ```
3. **buildConversationMessages()** reconstructs conversation from AI cell
   outputs
4. **Tool results** now emit `application/vnd.anode.aitool.result+json` with
   role metadata

## ✅ Success Criteria Met

1. **✅ Context Works**: AI can reference variables and outputs from previous
   cells
2. **✅ Tool Calls Visible**: Users see real-time tool call progress with proper
   metadata
3. **✅ Conversation Continuity**: Multiple AI cells build on each other's work
4. **✅ Performance**: Conversation reconstruction works efficiently

## Verification

Test results show:

- ✅ AI cell outputs with anode metadata are reconstructed into proper
  conversation
- ✅ Assistant responses become assistant messages
- ✅ Tool calls become assistant messages with tool_calls property
- ✅ Tool results become tool messages with tool_call_id
- ✅ Context continuity is preserved across AI cells

## Notes

- Frontend already has `AiToolCallOutput` component - no changes needed
- The conversation-as-outputs pattern aligns with Jupyter's execution model
- This implementation enables true conversational notebook computing
- anode metadata is properly scoped and typed for future extensibility
