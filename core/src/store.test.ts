import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "./store.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

test("an artifact's hash covers its kind, fields and body hash, the same way for every kind", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const store = createStore(directory);
  const plan = { kind: "document", fields: { title: "Plan" }, body: "Do it." };
  const hash = store.put(plan);

  assert.equal(
    hash,
    sha256(JSON.stringify({ kind: "document", fields: { title: "Plan" }, body: sha256("Do it.") })),
  );
  assert.equal(
    store.put({ kind: "verdict", fields: { verdict: "pass" } }),
    sha256(JSON.stringify({ kind: "verdict", fields: { verdict: "pass" }, body: null })),
  );

  // The same artifact is the same hash; another kind, field or body is another.
  assert.equal(store.put({ ...plan }), hash);
  assert.notEqual(store.put({ ...plan, kind: "memo" }), hash);
  assert.notEqual(store.put({ ...plan, fields: { title: "Plan B" } }), hash);
  assert.notEqual(store.put({ ...plan, body: "Do it again." }), hash);
  assert.deepEqual(store.get(hash), plan);
});
