import assert from "node:assert/strict";
import test from "node:test";
import { paginate } from "../lib/paginate";

test("id_gt pagination stops on a short page and drops duplicate ids", async () => {
  const calls: number[] = [];
  const pages = [
    { items: [{ id: 1 }, { id: 2, generation: 1 }], hasNext: true, nextId: 2 },
    { items: [{ id: 2, generation: 2 }, { id: 3 }], hasNext: false, nextId: 3 },
  ];
  const all = await paginate(async (idGt) => {
    calls.push(idGt);
    return pages[calls.length - 1];
  });
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(
    all.map((item) => item.id),
    [1, 2, 3],
  );
  assert.equal(all.find((item) => item.id === 2)?.generation, 2);
});

test("a full page without has_next keeps going until the cursor stalls", async () => {
  let page = 0;
  const all = await paginate(
    async (idGt) => {
      page += 1;
      if (page === 1) return { items: [{ id: idGt + 10 }, { id: idGt + 11 }], nextId: idGt + 11 };
      return { items: [{ id: idGt + 1 }], nextId: idGt + 1 };
    },
    { pageSize: 2, maxPages: 5 },
  );
  assert.equal(all.length, 3);
});

test("a later page failure keeps the items and cursor from the pages that succeeded", async () => {
  const { paginateDetailed } = await import("../lib/paginate");
  const { emptyHistory, recordBackfillPage } = await import("../lib/history");
  let calls = 0;
  const result = await paginateDetailed(async () => {
    calls += 1;
    if (calls === 1) return { items: [{ id: 10 }, { id: 20 }], hasNext: true, nextId: 20 };
    const error = new Error("slow");
    error.name = "TimeoutError";
    throw error;
  });
  assert.equal(calls, 2);
  assert.equal(result.complete, false);
  assert.equal(result.nextId, 20);
  assert.deepEqual(result.items.map((item) => item.id), [10, 20]);
  assert.equal(result.error instanceof Error && result.error.name, "TimeoutError");

  let store = emptyHistory("2026-11-09T07:00:00Z");
  assert.equal(store.backfillNextId, 1);
  store = recordBackfillPage(store, { nextId: result.nextId, complete: false, days: {}, openFrom: "2026-11-08" });
  assert.equal(store.backfillNextId, 20);
  store = recordBackfillPage(store, { nextId: 1, complete: false, days: {}, openFrom: "2026-11-08" });
  assert.equal(store.backfillNextId, 20);
});

test("a deadline stops before the first page and keeps the cursor", async () => {
  const { paginateDetailed } = await import("../lib/paginate");
  let calls = 0;
  const result = await paginateDetailed(async () => {
    calls += 1;
    return { items: [{ id: 5 }], hasNext: true, nextId: 5 };
  }, { deadlineMs: Date.now() - 1 });
  assert.equal(calls, 0);
  assert.equal(result.complete, false);
  assert.equal(result.nextId, 1);
});
