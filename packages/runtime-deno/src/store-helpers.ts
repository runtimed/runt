// Store creation helpers for runtime agents
//
// This module provides utilities to create LiveStore instances from RuntimeConfig,
// bridging the gap between the old RuntimeConfig API and the new Store-first API.

import type { Store } from "npm:@livestore/livestore";
import {
  createStorePromise,
  makeSchema,
  State,
} from "npm:@livestore/livestore";
import { makeAdapter } from "npm:@livestore/adapter-node";
import { events, materializers, tables } from "@runt/schema";
import type { RuntimeConfig } from "./config.ts";

// Create schema for proper typing
const schema = makeSchema({
  events,
  state: State.SQLite.makeState({ tables, materializers }),
});

/**
 * Create a LiveStore instance from RuntimeConfig
 *
 * This helper bridges the gap between the old RuntimeConfig API and the new
 * Store-first RuntimeAgent constructor. It creates a properly configured
 * LiveStore instance that can be passed to RuntimeAgent.
 *
 * @param config - RuntimeConfig instance with connection details
 * @param clientId - Client ID for authentication (usually user ID)
 * @returns Promise resolving to configured Store instance
 */
export async function createStoreFromConfig(
  config: RuntimeConfig,
  clientId?: string,
): Promise<Store<typeof schema>> {
  const store = await createStorePromise({
    adapter: makeAdapter({
      storage: { type: "in-memory" }, // Use in-memory for runtime agents
      // TODO: Configure sync backend properly for production use
      // sync: { backend: makeCfSync({ url: config.syncUrl }) },
    }),
    schema,
    storeId: `notebook-${config.notebookId}`,
    syncPayload: {
      authToken: config.authToken,
      clientId: clientId || config.runtimeId, // Fall back to runtimeId if no clientId
    },
  });

  return store;
}

/**
 * Type alias for the schema used by runtime agents
 */
export type RuntimeSchema = typeof schema;
