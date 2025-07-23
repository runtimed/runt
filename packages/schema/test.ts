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

  const store = await createStorePromise({
    adapter,
    schema,
    storeId: "test",
    onBootStatus: (status) => {
      console.table({
        status,
      });
    },
    otelOptions: {
      //   serviceName: "test",
      //   serviceVersion: "0.0.1",
    },
    disableDevtools: true,
  });

  return store;
}

Deno.test("simple test", async () => {
  const store = await setupStore();
  const cells = store.query(tables.cells);

  assertEquals(cells.length, 0);

  store.commit(events.cellCreated({
    id: "1",
    createdBy: "deno",
    cellType: "code",
    position: 0,
  }));

  assertEquals(store.query(tables.cells).length, 1);

  store.commit(events.cellSourceChanged({
    id: "1",
    source: "print('Hello, world!')",
    modifiedBy: "deno",
  }));

  assertEquals(store.query(tables.cells).length, 1);
  assertEquals(
    store.query(tables.cells.select().where({ id: "1" }))[0].source,
    "print('Hello, world!')",
  );

  store.shutdown();
});

Deno.test("simple test", async () => {
  const store = await setupStore();
  const cells = store.query(tables.cells);

  assertEquals(cells.length, 0);

  store.commit(events.cellCreated({
    id: "1",
    createdBy: "deno",
    cellType: "ai",
    position: 0,
  }));

  assertEquals(store.query(tables.cells).length, 1);

  store.commit(events.cellSourceChanged({
    id: "1",
    source: "Create some cells",
    modifiedBy: "deno",
  }));

  assertEquals(store.query(tables.cells).length, 1);
  assertEquals(
    store.query(tables.cells.select().where({ id: "1" }))[0].source,
    "Create some cells",
  );

  store.shutdown();
});
