/// <reference lib="deno.ns" />

import {
  createStorePromise,
  makeSchema,
  State,
  type Store as LiveStore,
} from "@livestore/livestore";

import { makeAdapter } from "npm:@livestore/adapter-node";

import { assertEquals } from "jsr:@std/assert";

import { events, materializers, tables } from "@runt/schema";

async function setupStore() {
  const state = State.SQLite.makeState({ tables, materializers });
  const schema = makeSchema({ events, state });
  type Store = LiveStore<typeof schema>;

  const adapter = makeAdapter({
    storage: { type: "in-memory" },
    // sync: { backend: makeCfSync({ url: '...' }) },
  });

  const store = await createStorePromise({ adapter, schema, storeId: "test" });

  return store;
}

Deno.test("simple test", async () => {
  const store = await setupStore();

  const cells = store.query(tables.cells);

  assertEquals(cells.length, 0);

  store.shutdown();
});
