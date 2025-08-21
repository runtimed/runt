# Runtime Agent Refactoring - Handoff Document

## 🎯 Project Goal

Refactor the runtime agent system to support browser usage by extracting platform-agnostic core logic and creating platform-specific adapters. This enables browser-based runtime agents (like Pyodide) that can share a LiveStore instance with React UI components.

## ✅ Current Status: Phase 1 Complete

### What's Been Accomplished

1. **Package Structure Created**
   - `@runt/runtime-core` - Platform-agnostic core logic ✅
   - `@runt/runtime-node` - Server/Deno platform adapter (scaffolded)
   - `@runt/runtime-browser` - Browser platform adapter (scaffolded)
   - All packages added to workspace in `deno.json` ✅

2. **Store-First Architecture Implemented**
   - RuntimeAgent now takes `Store` as constructor parameter ✅
   - Removed platform-specific LiveStore creation from core ✅
   - Simplified `RuntimeAgentOptions` interface ✅

3. **Core RuntimeAgent Refactored**
   - Clean compilation without errors ✅
   - Execution logic preserved ✅
   - Platform-specific code removed ✅

### Key Architecture Changes

**Before (Platform-Coupled):**
```typescript
const config = createRuntimeConfig(args) // CLI/env parsing
const agent = new RuntimeAgent(config, capabilities) // Creates own store
```

**After (Store-First):**
```typescript
const store = await createStorePromise({ adapter, schema }) // From React app
const agent = new RuntimeAgent(store, capabilities, {
  runtimeId: 'browser-echo',
  runtimeType: 'echo',
  clientId: user.sub, // CRITICAL: Must be authenticated user ID
})
```

## 📁 Current File Structure

```
runt/
├── PLAN.md                           # Architecture requirements ✅
├── HANDOFF.md                        # This document ✅
└── packages/
    ├── runtime-core/                 # ✅ COMPLETE
    │   ├── src/
    │   │   ├── runtime-agent.ts      # ✅ Store-first RuntimeAgent
    │   │   ├── types.ts              # ✅ Simplified interfaces
    │   │   ├── logging.ts            # ✅ Platform-agnostic logging
    │   │   ├── artifact-client.ts    # ✅ HTTP-based artifact upload
    │   │   └── media/                # ✅ Media handling utilities
    │   ├── mod.ts                    # ✅ Clean exports
    │   └── deno.json                 # ✅ Package config
    ├── runtime-node/                 # 🚧 SCAFFOLDED (needs implementation)
    │   └── (copied from lib, needs cleanup)
    ├── runtime-browser/              # 🚧 SCAFFOLDED (needs implementation)
    │   └── (copied from lib, needs cleanup)
    └── lib/                          # 📦 ORIGINAL (unchanged)
        └── (existing implementation)
```

## 🔄 Key Interface Changes

### RuntimeAgentOptions (Simplified)
```typescript
// OLD: Complex platform-specific options
interface RuntimeAgentOptions {
  readonly runtimeId: string;
  readonly runtimeType: string;
  readonly capabilities: Readonly<RuntimeCapabilities>;
  readonly syncUrl: string;
  readonly authToken: string;
  readonly notebookId: string;
  readonly imageArtifactThresholdBytes?: number;
  readonly artifactClient?: IArtifactClient;
  readonly environmentOptions: Readonly<{...}>;
}

// NEW: Platform-agnostic options
interface RuntimeAgentOptions {
  runtimeId: string;
  runtimeType: string;
  clientId: string;        // REQUIRED - must be authenticated user ID
  sessionId?: string;      // Optional - generated if not provided
}
```

### RuntimeAgent Constructor
```typescript
// OLD: Takes config, creates own store
constructor(
  public config: RuntimeConfig,
  private capabilities: RuntimeCapabilities,
  private handlers: RuntimeAgentEventHandlers = {},
)

// NEW: Takes existing store
constructor(
  public readonly store: Store<any>,
  private capabilities: RuntimeCapabilities,
  public readonly options: RuntimeAgentOptions,
  private handlers: RuntimeAgentEventHandlers = {},
  artifactClient?: IArtifactClient,
)
```

## 🎯 Next Steps: Phase 2 Implementation

### Priority 1: Browser Package Implementation

**Create `@runt/runtime-browser`:**

1. **Clean up copied files**
   ```bash
   cd packages/runtime-browser
   rm -rf src/config.ts src/runtime-runner.ts examples/
   rm src/*.test.ts  # Remove tests that don't apply
   ```

2. **Create browser-specific exports in `mod.ts`:**
   ```typescript
   // Re-export core
   export * from "@runt/runtime-core";
   
   // Browser-specific utilities
   export { createBrowserRuntimeAgent } from "./src/browser-runtime.ts";
   export type { BrowserRuntimeOptions } from "./src/browser-types.ts";
   ```

3. **Implement `src/browser-runtime.ts`:**
   ```typescript
   export function createBrowserRuntimeAgent(
     store: Store<typeof schema>,
     capabilities: RuntimeCapabilities,
     options?: Partial<RuntimeAgentOptions>
   ): RuntimeAgent {
     const agent = new RuntimeAgent(store, capabilities, {
       runtimeId: options?.runtimeId || `browser-${crypto.randomUUID()}`,
       runtimeType: options?.runtimeType || 'echo',
       clientId: options?.clientId, // MUST be provided - user ID
       ...options
     })
     
     // Browser-specific lifecycle
     setupBrowserLifecycle(agent)
     
     return agent
   }
   
   function setupBrowserLifecycle(agent: RuntimeAgent) {
     const cleanup = () => agent.shutdown()
     window.addEventListener('beforeunload', cleanup)
   }
   ```

4. **Create echo agent example:**
   ```typescript
   // Simple echo execution handler for testing
   agent.onExecution(async (context) => {
     await context.result({ 
       'text/plain': `Echo: ${context.cell.source}` 
     })
     return { success: true }
   })
   ```

### Priority 2: Node Package Implementation

**Create `@runt/runtime-node`:**

1. **Move platform-specific code from `@runt/lib`:**
   - `src/config.ts` (CLI parsing, env vars)
   - `src/runtime-runner.ts` (CLI entrypoint)
   - Signal handlers (SIGINT/SIGTERM)
   - Authentication discovery logic

2. **Create node-specific wrapper:**
   ```typescript
   export async function createNodeRuntimeAgent(
     args: string[],
     capabilities: RuntimeCapabilities
   ): Promise<{ agent: RuntimeAgent, store: Store }> {
     const config = parseRuntimeArgs(args) // CLI parsing
     
     const adapter = makeAdapter({
       storage: { type: 'fs' },
       sync: { backend: makeCfSync({ url: config.syncUrl }) },
       clientId: config.clientId, // REQUIRED from CLI
     })
     
     const store = await createStorePromise({
       adapter, schema,
       storeId: config.notebookId,
       syncPayload: { authToken: config.authToken }
     })
     
     const agent = new RuntimeAgent(store, capabilities, {
       runtimeId: config.runtimeId,
       runtimeType: config.runtimeType,
       clientId: config.clientId,
     })
     
     setupNodeLifecycle(agent, store)
     return { agent, store }
   }
   ```

### Priority 3: React Integration Example

**Browser integration in anode React app:**
```typescript
const useBrowserRuntime = () => {
  const { store } = useStore() // Existing LiveStore
  const { user } = useAuthenticatedUser()
  
  const startBrowserRuntime = async () => {
    const { createBrowserRuntimeAgent } = await import('@runt/runtime-browser')
    
    const agent = createBrowserRuntimeAgent(store, {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    }, {
      runtimeId: 'browser-echo',
      runtimeType: 'echo',
      clientId: user.sub, // Critical: use authenticated user ID
    })
    
    // Echo handler for testing
    agent.onExecution(async (context) => {
      await context.result({ 'text/plain': `Echo: ${context.cell.source}` })
      return { success: true }
    })
    
    await agent.start()
    return agent
  }
  
  return { startBrowserRuntime }
}
```

## 🔍 Testing Strategy

### Phase 2 Testing Checklist

1. **Core Package Tests**
   - [ ] RuntimeAgent constructor with store parameter
   - [ ] Session management and LiveStore integration
   - [ ] Execution context and output methods

2. **Browser Package Tests**
   - [ ] Echo agent execution
   - [ ] Browser lifecycle management
   - [ ] Store sharing with React app

3. **Node Package Tests**  
   - [ ] CLI argument parsing
   - [ ] Signal handlers
   - [ ] Original functionality preserved

4. **Integration Tests**
   - [ ] Browser runtime works with React LiveStore
   - [ ] Multiple runtimes can share same store
   - [ ] User ID consistency across platforms

## ⚠️ Critical Requirements

### Client ID Consistency
- **MUST** use authenticated user ID as `clientId`
- **DO NOT** use random generation or host inheritance
- This ensures audit trails and permission consistency

### Single Runtime Constraint
- Existing schema enforces one active runtime per notebook
- New architecture maintains this constraint
- Runtime displacement logic preserved

### Store Lifecycle
- RuntimeAgent **does not** own the Store
- Platform adapters handle Store creation/lifecycle
- Browser: Store created by React app
- Node: Store created by CLI wrapper

## 🐛 Known Issues & Gotchas

1. **Test Files Removed**: Platform-specific tests were removed from core package
   - Need to recreate relevant tests in platform packages
   - Original tests can be found in git history

2. **Dependencies**: Core package has minimal dependencies
   - No `@livestore/adapter-node` or CLI parsing libraries
   - Platform packages add their specific dependencies

3. **Media/Artifact Handling**: Simplified in core
   - Size-based artifact upload logic can be added by platform packages
   - Core just returns inline content for images

## 📚 Reference Materials

### Essential Documentation for New Agents

**External Documentation:**
- **LiveStore Full Documentation**: https://docs.livestore.dev/llms-full.txt
  - Complete LiveStore architecture and patterns
  - Web adapter usage (critical for browser implementation)
  - Store creation and lifecycle management
  - Event sourcing patterns

**Project Documentation:**
- **`PLAN.md`**: Complete architecture requirements and decisions
- **`runt/packages/schema/mod.ts`**: Runtime session events and materializers
- **`runt/packages/schema/types.ts`**: Core type definitions and MIME types
- **`runt/packages/schema/tables.ts`**: Database schema including runtime sessions

### Key Files to Understand

**Core Implementation (✅ Complete):**
- `packages/runtime-core/src/runtime-agent.ts` - New store-first RuntimeAgent
- `packages/runtime-core/src/types.ts` - Simplified interfaces
- `packages/runtime-core/mod.ts` - Clean exports

**Original Implementation (Reference):**
- `packages/lib/src/runtime-agent.ts` - Original platform-coupled implementation
- `packages/lib/src/config.ts` - CLI parsing and environment handling
- `packages/lib/src/types.ts` - Full original interfaces
- `packages/lib/examples/echo-agent.ts` - Working echo agent example

**Schema Integration:**
- `packages/schema/mod.ts` - Lines 51-482: Core events
- `packages/schema/mod.ts` - Lines 579-1215: Materializers
- `packages/schema/tables.ts` - Lines 90-110: Runtime sessions table
- `packages/schema/queries/index.ts` - Runtime session queries

### React Integration Context

**anode LiveStore Setup (from user context):**
```typescript
// This is how the React app creates the LiveStore instance
const adapter = makePersistedAdapter({
  storage: { type: "opfs" },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  resetPersistence,
  clientId, // This ties to authenticated user
});

const syncPayload = useRef({
  get authToken() {
    const tokenString = localStorage.getItem("openid_tokens");
    const tokens = tokenString ? JSON.parse(tokenString) : null;
    return tokens?.accessToken || "";
  },
  clientId, // Same user ID that runtime agent must use
});
```

### LiveStore Patterns to Follow

**Web Adapter Usage:**
- Study `@livestore/adapter-web` documentation
- `makePersistedAdapter` with OPFS storage
- Shared worker for cross-tab communication
- `clientId` consistency critical for user identity

**Store Creation Pattern:**
```typescript
const store = await createStorePromise({
  adapter,
  schema,
  storeId: notebookId,
  syncPayload: { authToken, clientId }
})
```

**Event Sourcing:**
- Runtime session lifecycle: `runtimeSessionStarted` → `runtimeSessionStatusChanged` → `runtimeSessionTerminated`
- Execution queue: `executionRequested` → `executionAssigned` → `executionStarted` → `executionCompleted`
- Output events: `terminalOutputAdded`, `multimediaDisplayOutputAdded`, etc.

### Examples and Tests

**Working Examples (Reference Only):**
- `packages/lib/examples/echo-agent.ts` - Complete working echo agent
- `packages/lib/examples/enhanced-output-example.ts` - Rich output handling
- `packages/lib/examples/streaming-demo.ts` - Streaming output patterns

**Test Patterns:**
- `packages/lib/src/runtime-agent.test.ts` - RuntimeAgent constructor tests
- `packages/lib/test/integration.test.ts` - LiveStore integration patterns
- Look at git history for removed test files that might provide insights

### Browser-Specific Resources

**Web APIs to Use:**
- `crypto.randomUUID()` for session IDs
- `window.addEventListener('beforeunload')` for cleanup
- `localStorage` for configuration
- `URL` constructor for parsing config from search params

**Avoid These Deno APIs:**
- `Deno.addSignalListener` → Use `window.addEventListener`
- `Deno.env.get()` → Use `localStorage` or URL params
- `Deno.pid` → Use `crypto.randomUUID()`
- `@std/cli/parse-args` → Browser doesn't need CLI parsing

### Questions to Research

When implementing, you may need to research:

1. **How does `makePersistedAdapter` work?** → Check LiveStore web adapter docs
2. **What's the exact schema for runtime events?** → See `packages/schema/mod.ts`  
3. **How do multiple runtimes get displaced?** → Look at existing `runtimeSessionTerminated` logic
4. **What's the authentication flow?** → The user's React app handles this, runtime just uses `clientId`
5. **How do execution contexts work?** → Study `ExecutionContext` interface and existing output methods

## 🚀 Future Phases (Post Phase 2)

1. **Phase 3: Pyodide Integration**
   - Move pyodide runtime to browser package
   - Replace echo agent with Python execution
   - Web Worker optimization

2. **Phase 4: Advanced Features**
   - Shared Worker persistence
   - Multiple runtime types simultaneously
   - Error boundaries and state persistence

## 💡 Success Criteria

**Phase 2 Complete When:**
- [ ] Browser package compiles and works with React app
- [ ] Node package preserves all existing CLI functionality  
- [ ] Echo agent successfully executes in browser
- [ ] Store sharing works between React UI and browser runtime
- [ ] All tests passing
- [ ] Documentation updated

## 🤝 Handoff Notes

This refactoring preserves all existing functionality while enabling browser usage through clean separation of concerns. The store-first architecture is the key insight that makes this work.

The foundation is solid - core package compiles cleanly and implements the new architecture correctly. The remaining work is primarily plumbing and integration.

**Key files to focus on next:**
1. `packages/runtime-browser/src/browser-runtime.ts` 
2. `packages/runtime-node/src/node-runtime.ts`
3. Integration examples and tests

Good luck! 🚀