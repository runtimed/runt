/**
 * Browser Echo Agent Example
 *
 * This demonstrates how to create a browser-based runtime agent that uses
 * an existing LiveStore instance from a React application. This is the
 * intended usage pattern - the agent shares the store with the React UI.
 *
 * This example shows integration patterns for React apps that already have:
 * 1. LiveStore set up with LiveStoreProvider
 * 2. User authentication context
 * 3. Existing notebook UI components
 */

import type {
  BrowserRuntimeAgentOptions as _BrowserRuntimeAgentOptions,
  createBrowserRuntimeAgent as _createBrowserRuntimeAgent,
} from "../mod.ts";
import type { RuntimeCapabilities as _RuntimeCapabilities } from "@runt/runtime-core";

/**
 * React Hook Example: Browser Echo Runtime Agent
 *
 * This shows how to integrate the browser runtime agent into a React app
 * that already has LiveStore and authentication set up.
 */
export function useBrowserEchoAgent() {
  // This would be the pattern in a real React app:
  /*
  import { useStore } from '@livestore/react';
  import { useAuthenticatedUser } from '../auth/AuthContext';
  import { useState, useCallback, useEffect } from 'react';

  const { store } = useStore(); // Get existing LiveStore instance
  const { user } = useAuthenticatedUser(); // Get authenticated user
  const [agent, setAgent] = useState<RuntimeAgent | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const startEchoAgent = useCallback(async () => {
    if (agent || !store || !user) return;

    try {
      // Create browser runtime agent using existing store
      const newAgent = createBrowserRuntimeAgent(store, {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      }, {
        runtimeId: 'browser-echo',
        runtimeType: 'echo',
        clientId: user.sub, // CRITICAL: Use authenticated user ID
        onCleanup: [
          () => console.log('🧹 Echo agent cleaning up...'),
        ],
      });

      // Set up echo execution handler
      newAgent.onExecution(async (context) => {
        console.log(`📝 Echo: ${context.cell.source}`);

        // Echo with rich output formats
        await context.result({
          'text/plain': `Echo: ${context.cell.source}`,
          'text/markdown': `**Echo Output:**\n\n\`\`\`\n${context.cell.source}\n\`\`\``,
          'application/json': {
            echo: context.cell.source,
            timestamp: new Date().toISOString(),
            cellId: context.cell.id,
            runtimeType: 'browser-echo',
          },
        });

        return { success: true };
      });

      // Start the agent
      await newAgent.start();
      setAgent(newAgent);
      setIsRunning(true);

      console.log(`
🚀 Browser Echo Agent Started!
   Runtime ID: browser-echo
   Runtime Type: echo
   Client ID: ${user.sub}

💡 Ready to echo code execution requests from notebook cells!
      `);

    } catch (error) {
      console.error('❌ Failed to start browser echo agent:', error);
      throw error;
    }
  }, [store, user, agent]);

  const stopEchoAgent = useCallback(async () => {
    if (!agent) return;

    try {
      await agent.shutdown();
      setAgent(null);
      setIsRunning(false);
      console.log('🛑 Browser echo agent stopped');
    } catch (error) {
      console.error('❌ Failed to stop browser echo agent:', error);
    }
  }, [agent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (agent) {
        agent.shutdown().catch(console.error);
      }
    };
  }, [agent]);

  return {
    agent,
    isRunning,
    startEchoAgent,
    stopEchoAgent,
  };
  */

  // For demo purposes, return a mock implementation
  return {
    message:
      "This example shows React integration patterns for browser runtime agents",
    startEchoAgent: () =>
      Promise.resolve(console.log("Demo: Would start echo agent")),
    stopEchoAgent: () =>
      Promise.resolve(console.log("Demo: Would stop echo agent")),
    isRunning: false,
  };
}

/**
 * Example React Component: Runtime Control Panel
 *
 * Shows how you might add runtime controls to your notebook UI
 */
export function RuntimeControlPanel() {
  /*
  const { isRunning, startEchoAgent, stopEchoAgent } = useBrowserEchoAgent();

  return (
    <div className="runtime-control-panel">
      <h3>Runtime Agent</h3>

      {!isRunning ? (
        <button
          onClick={startEchoAgent}
          className="btn btn-primary"
        >
          🚀 Start Echo Runtime
        </button>
      ) : (
        <button
          onClick={stopEchoAgent}
          className="btn btn-secondary"
        >
          🛑 Stop Echo Runtime
        </button>
      )}

      <div className="runtime-status">
        Status: {isRunning ? '✅ Running' : '⏸️ Stopped'}
      </div>
    </div>
  );
  */

  return {
    message:
      "This would be a React component for controlling the runtime agent",
  };
}

/**
 * Integration Notes for React Apps:
 *
 * 1. **Prerequisites**: Your React app should already have:
 *    - LiveStoreProvider set up with schema, adapter, storeId
 *    - User authentication context providing user.sub
 *    - Notebook UI components for displaying execution results
 *
 * 2. **Store Sharing**: The runtime agent uses the same store as your React UI,
 *    ensuring all notebook state is synchronized between the agent and UI.
 *
 * 3. **User Identity**: The clientId MUST match the authenticated user ID
 *    that was used when setting up the LiveStore adapter.
 *
 * 4. **Lifecycle Management**: The agent automatically cleans up on page
 *    navigation, but you can also manually control it with start/stop.
 *
 * 5. **Error Handling**: Always wrap agent operations in try/catch and
 *    provide user feedback for failures.
 */

/**
 * Example: Integrating into existing NotebookApp component
 */
export function integrateWithNotebookApp() {
  /*
  // In your existing NotebookApp.tsx:

  import { useBrowserEchoAgent } from './runtime/browser-echo-agent';

  export function NotebookApp() {
    const { startEchoAgent, stopEchoAgent, isRunning } = useBrowserEchoAgent();

    // Auto-start the runtime when the notebook loads
    useEffect(() => {
      startEchoAgent().catch(console.error);
    }, [startEchoAgent]);

    return (
      <div className="notebook-app">
        <NotebookHeader>
          <RuntimeStatus isRunning={isRunning} />
          <RuntimeControls
            onStart={startEchoAgent}
            onStop={stopEchoAgent}
            isRunning={isRunning}
          />
        </NotebookHeader>

        <NotebookCells />

        <NotebookFooter />
      </div>
    );
  }
  */

  return {
    message:
      "This shows how to integrate the runtime agent into your existing notebook UI",
  };
}

/**
 * Demo function for documentation purposes
 * (Not meant to be called in actual React apps)
 */
export function documentationDemo() {
  console.log(`
📚 Browser Echo Agent - React Integration Example

This file demonstrates how to use the browser runtime agent in a React app
that already has LiveStore and authentication set up.

Key Integration Points:
✅ Use existing store from useStore() hook
✅ Get user ID from authentication context
✅ Create agent with shared store (no new store creation)
✅ Handle lifecycle in React component effects
✅ Provide UI controls for starting/stopping

For Production Use:
1. Copy the patterns shown in useBrowserEchoAgent()
2. Adapt to your existing auth and store setup
3. Add error handling and user feedback
4. Integrate into your notebook UI components

This example replaces the need for Pyodide initially - you can test
the browser runtime architecture with simple echo functionality first.
  `);

  return {
    success: true,
    message: "Browser echo agent integration example ready for React apps",
  };
}

// Export the demo for testing
export default documentationDemo;
