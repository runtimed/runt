/**
 * Browser Echo Agent Example
 *
 * This demonstrates how to create a browser-based runtime agent that can
 * share a LiveStore instance with a React application. The agent will
 * echo back any code that gets executed.
 *
 * This is intended to run in a browser environment where:
 * 1. A LiveStore instance already exists (from React app)
 * 2. User authentication is handled by the React app
 * 3. The agent integrates seamlessly with existing notebook UI
 */

import { createStorePromise } from "npm:@livestore/livestore";
import { createWebAdapter } from "npm:@livestore/adapter-web";
import { events, materializers } from "@runt/schema";
import {
  type BrowserRuntimeAgentOptions,
  createBrowserRuntimeAgent,
} from "../mod.ts";
import type { RuntimeCapabilities } from "@runt/runtime-core";

/**
 * Example: Create and start a browser echo agent
 *
 * In a real React app, this would typically be called from a custom hook
 * or component that has access to the existing store and user context.
 */
async function createEchoAgent() {
  // In a real React app, you'd get this from useStore() hook
  // const { store } = useStore();
  // For this example, we'll create a store (but normally you'd reuse existing one)
  const store = await createStorePromise({
    adapter: createWebAdapter({
      storage: { type: "memory" }, // Browser-friendly storage
    }),
    storeId: "browser-echo-example",
    events,
    materializers,
    syncPayload: {
      // In real app, get from authenticated user context
      authToken: "example-token",
      clientId: "example-user-id",
    },
  });

  const capabilities: RuntimeCapabilities = {
    canExecuteCode: true,
    canExecuteSql: false,
    canExecuteAi: false,
  };

  const options: BrowserRuntimeAgentOptions = {
    runtimeId: "browser-echo-example",
    runtimeType: "echo",
    clientId: "example-user-id", // CRITICAL: This must match the authenticated user
    onCleanup: [
      () => console.log("🧹 Custom cleanup: Saving state before shutdown"),
    ],
  };

  // Create the browser runtime agent
  const agent = createBrowserRuntimeAgent(store, capabilities, options);

  // Set up echo execution handler
  agent.onExecution(async (context) => {
    console.log(`📝 Executing code: ${context.cell.source}`);

    // Echo the input back with some formatting
    await context.result({
      "text/plain": `Echo: ${context.cell.source}`,
      "text/markdown":
        `**Echo Output:**\n\n\`\`\`\n${context.cell.source}\n\`\`\``,
      "application/json": {
        echo: context.cell.source,
        timestamp: new Date().toISOString(),
        cellId: context.cell.id,
      },
    });

    console.log(`✅ Echo completed for cell ${context.cell.id}`);
    return { success: true };
  });

  // Start the agent
  await agent.start();

  console.log(`
🚀 Browser Echo Agent Started!
   Runtime ID: ${options.runtimeId}
   Runtime Type: ${options.runtimeType}
   Client ID: ${options.clientId}

💡 The agent is now listening for execution requests from the notebook UI.
🔄 Any code executed in notebook cells will be echoed back.
🧹 Agent will cleanup automatically on page unload.
  `);

  return agent;
}

/**
 * Example: React Hook Integration
 *
 * This shows how you might integrate the browser runtime agent
 * into a React application with proper hooks and context.
 */
export function useBrowserEchoAgent() {
  // This would be the pattern in a real React app:

  /*
  const { store } = useStore(); // Get existing LiveStore
  const { user } = useAuthenticatedUser(); // Get authenticated user
  const [agent, setAgent] = useState<RuntimeAgent | null>(null);

  const startEchoAgent = useCallback(async () => {
    if (agent) return agent; // Already started

    const newAgent = createBrowserRuntimeAgent(store, {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    }, {
      runtimeId: 'browser-echo',
      runtimeType: 'echo',
      clientId: user.sub, // Use authenticated user ID
    });

    // Set up echo handler
    newAgent.onExecution(async (context) => {
      await context.result({
        'text/plain': `Echo: ${context.cell.source}`
      });
      return { success: true };
    });

    await newAgent.start();
    setAgent(newAgent);

    return newAgent;
  }, [store, user, agent]);

  const stopEchoAgent = useCallback(() => {
    if (agent) {
      cleanupBrowserRuntimeAgent(agent);
      setAgent(null);
    }
  }, [agent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (agent) {
        cleanupBrowserRuntimeAgent(agent);
      }
    };
  }, [agent]);

  return {
    agent,
    startEchoAgent,
    stopEchoAgent,
    isRunning: !!agent
  };
  */

  return {
    message:
      "This is a conceptual example - see comments for React integration",
  };
}

/**
 * Demo function for testing in browser console
 */
export async function runBrowserEchoDemo() {
  console.log("🎯 Starting Browser Echo Agent Demo...");

  try {
    const agent = await createEchoAgent();

    // The agent is now running and will handle execution requests
    // In a real app, these would come from the notebook UI
    console.log(`
✨ Demo Complete!

To test the agent:
1. The agent is now listening for execution requests
2. In a real app, executing code in notebook cells would trigger the echo
3. The agent will automatically cleanup when you close/navigate away from this page

Agent details:
- Runtime ID: ${agent.options.runtimeId}
- Runtime Type: ${agent.options.runtimeType}
- Session ID: ${agent.options.sessionId}
    `);

    return agent;
  } catch (error) {
    console.error("❌ Demo failed:", error);
    throw error;
  }
}

// Auto-run demo if this file is loaded directly in browser
if (
  typeof globalThis !== "undefined" && globalThis.location &&
  !globalThis.location.search.includes("no-auto")
) {
  runBrowserEchoDemo().catch(console.error);
}
