# Runtime Agent Refactoring Plan

## Current Problem

The `@runt/lib` package is heavily coupled to Deno/server environments and
cannot be used in browsers. This prevents creating browser-based runtime agents
(like pyodide) that could share a LiveStore instance with the React UI.

### Current Issues

- Heavy reliance on Deno APIs (`Deno.addSignalListener`, `Deno.env`, `Deno.pid`)
- CLI argument parsing with `@std/cli`
- File system operations for auth discovery
- `@livestore/adapter-node` dependency
- Process-based lifecycle management

## Goal ✅ PHASE 1 COMPLETE

Create a browser-compatible runtime agent system that:

1. **Shares LiveStore Instance**: Integrates with existing React app's LiveStore
   instance
2. **Platform Agnostic Core**: Core runtime logic works across platforms
3. **Clean Separation**: Platform-specific concerns isolated to separate
   packages
4. **User Identity**: Uses authenticated user ID consistently across platforms
5. **Single Runtime**: Maintains existing constraint of one active runtime per
   notebook

## Architecture Changes

### Key Insight: Store-First Design ✅ IMPLEMENTED

Instead of RuntimeAgent creating its own LiveStore instance:

```typescript
// OLD: Runtime agent owns the store
const config = createRuntimeConfig(args);
const agent = new RuntimeAgent(config, capabilities);

// NEW: Runtime agent plugs into existing store ✅ DONE
const store = await createStoreFromConfig(config); // or from React app
const agent = new RuntimeAgent(store, capabilities, options);
```

### Benefits

- Single source of truth (one LiveStore instance)
- No duplicate configuration or setup
- Natural integration with React UI
- Multiple runtimes can share same store
- Simpler browser deployment

## Package Structure

### `@runt/runtime-core`

**Platform-agnostic core logic**

```typescript
export class RuntimeAgent {
  constructor(
    private store: Store<typeof schema>,
    private capabilities: RuntimeCapabilities,
    private options: RuntimeAgentOptions,
  );
}

export interface RuntimeAgentOptions {
  runtimeId: string;
  runtimeType: string;
  clientId: string; // REQUIRED - must be user ID
  sessionId?: string;
}
```

**Contents:**

- Core `RuntimeAgent` class (store-based)
- `ExecutionContext` interface and output methods
- Media handling (`validateMediaBundle`, type guards)
- `ArtifactClient` (uses fetch API)
- Logging utilities
- All platform-agnostic types

### `@runt/runtime-node`

**Server/Deno platform adapter**

```typescript
export async function createNodeRuntimeAgent(
  args: string[],
  capabilities: RuntimeCapabilities,
): Promise<{ agent: RuntimeAgent; store: Store }>;
```

**Contents:**

- CLI argument parsing (`parseRuntimeArgs`)
- Environment variable handling
- Signal handlers (SIGINT/SIGTERM)
- `@livestore/adapter-node` integration
- Process-based lifecycle management
- File system auth discovery
- Re-exports from `@runt/runtime-core`

### `@runt/runtime-browser`

**Browser platform adapter**

```typescript
export function createBrowserRuntimeAgent(
  store: Store<typeof schema>, // Passed from React app
  capabilities: RuntimeCapabilities,
  options?: Partial<RuntimeAgentOptions>,
): RuntimeAgent;
```

**Contents:**

- Browser lifecycle management (`beforeunload` handlers)
- Configuration from URL params/localStorage
- `@livestore/adapter-web` integration helpers
- Browser-specific utilities
- Re-exports from `@runt/runtime-core`

## Schema Integration

### Runtime Session Management

Uses existing schema events and tables:

- `runtimeSessionStarted` - Announces new runtime
- `runtimeSessionTerminated` - Cleanup on shutdown
- `runtimeSessions` table - Tracks active runtimes
- Single active runtime constraint maintained

### Client ID Consistency

**Critical Requirement**: `clientId` must be authenticated user ID

```typescript
// Browser (from React auth context)
const { user } = useAuthenticatedUser();
const agent = createBrowserRuntimeAgent(store, capabilities, {
  clientId: user.sub, // Same as LiveStore clientId
});

// Node (from CLI)
const agent = await createNodeRuntimeAgent(args, capabilities);
// CLI must include --client-id <user-id> argument
```

## Implementation Phases

### Phase 1: Package Refactoring ✅ COMPLETE

1. **Extract Core**: ✅ Moved platform-agnostic code to `@runt/runtime-core`
2. **Create Node Package**: ✅ Moved Deno/server code to `@runt/runtime-deno`
3. **Create Browser Package**: ✅ Created basic browser adapter with echo agent
4. **Update Dependencies**: ✅ Migrated existing packages to new structure
5. **Test Migration**: ✅ All functionality preserved and tests passing
6. **API Migration**: ✅ Updated RuntimeAgent to store-first design
7. **Backward Compatibility**: ✅ Created bridge functions for smooth migration

### Phase 2: Browser Integration ⏭️ NEXT FOCUS

1. **React Integration**: Hook to start/stop browser runtime from UI
2. **Store Sharing**: Ensure browser runtime uses same LiveStore as React
3. **Lifecycle Management**: Proper cleanup and error handling
4. **Testing**: Browser-specific test scenarios

### Phase 3: Pyodide Runtime (Future)

1. **Pyodide Integration**: Replace echo agent with Python execution
2. **Web Worker**: Optional shared worker optimization
3. **Performance**: Lazy loading, warm instances
4. **Rich Output**: Matplotlib, pandas, HTML rendering

### Phase 4: Advanced Features (Future)

1. **Multiple Runtimes**: JS + Python simultaneously (if needed)
2. **Shared Workers**: Cross-tab runtime persistence
3. **Error Boundaries**: Sophisticated error handling
4. **State Persistence**: Runtime state across page reloads

## Browser Integration Example

### In React App (anode)

```typescript
const useBrowserRuntime = () => {
  const { store } = useStore(); // Existing LiveStore
  const { user } = useAuthenticatedUser();

  const startBrowserRuntime = async () => {
    const { createBrowserRuntimeAgent } = await import("@runt/runtime-browser");

    const agent = createBrowserRuntimeAgent(store, {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    }, {
      runtimeId: "browser-echo",
      runtimeType: "echo",
      clientId: user.sub, // Critical: use authenticated user ID
    });

    // Simple echo handler for Phase 1
    agent.onExecution(async (context) => {
      await context.result({
        "text/plain": `Echo: ${context.cell.source}`,
      });
      return { success: true };
    });

    await agent.start();
    return agent;
  };

  return { startBrowserRuntime };
};
```

## Key Decisions

### Store Ownership

- ✅ RuntimeAgent takes Store as constructor parameter
- ❌ RuntimeAgent creates its own LiveStore instance

### Client ID Source

- ✅ Must be authenticated user ID (provided explicitly)
- ❌ Random generation or host inheritance

### Runtime Constraints

- ✅ One active runtime per notebook (existing constraint)
- Future: May support multiple runtime types simultaneously

### Package Naming

- `@runt/runtime-core` (not `lib-core`) - clearer purpose
- `@runt/runtime-node` (not `lib-node`) - matches platform
- `@runt/runtime-browser` (not `lib-browser`) - consistent naming

### Incremental Approach

- ✅ Start with echo agent for testing
- ✅ Punt complex decisions (persistence, shared workers) to later phases
- ✅ Focus on clean package structure first

## Success Criteria

### Phase 1 Complete When:

- [x] `@runt/runtime-core` package created and published
- [x] `@runt/runtime-deno` package works with existing CLI tools
- [x] `@runt/runtime-browser` package works with echo agent
- [x] Current pyodide runtime migrated to new structure
- [x] All tests passing
- [x] RuntimeAgent API migrated to store-first design
- [x] Backward compatibility bridge functions created
- [ ] Documentation updated (in progress)

### Long-term Success:

- Browser runtime shares LiveStore instance with React UI seamlessly
- Clean separation of platform concerns
- Easy to add new runtime types or platforms
- Maintainable, well-tested codebase
