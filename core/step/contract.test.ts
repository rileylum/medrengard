import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { node } from "../defaults/access.ts";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { defineWorkflow } from "../src/definition.ts";
import { createEngine } from "../src/engine.ts";

// Principle 2: TypeScript is a convenience layer over the step contract. A factory's own step,
// in its repository, reaches the layer as it reaches the rest of the package.
test("a step written in TypeScript reads its input, notes and claims through the contract's module", async (t) => {
  const factory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(factory, { recursive: true, force: true }));

  await mkdir(join(factory, "node_modules", "@medrengard"), { recursive: true });
  await symlink(
    join(import.meta.dirname, ".."),
    join(factory, "node_modules", "@medrengard", "core"),
  );
  await mkdir(join(factory, "steps"));
  await writeFile(
    join(factory, "steps", "reply.ts"),
    `import { artifactsOf, bodyOf, claim, note, readInput, reportUsage } from "@medrengard/core/step/contract.ts";

     const given = readInput();
     const [request] = artifactsOf(given, "request");

     note(\`Replying to \${request?.fields.title},\\n as step \${given.step}\`);
     reportUsage({ usd: 0.5 });
     claim("done", [
       { kind: "document", fields: { title: "Reply" }, text: \`Reply to: \${bodyOf(request ?? {})}\` },
     ]);`,
  );

  await mkdir(join(factory, "state"));

  const engine = createEngine({
    log: join(factory, "state", "log.sqlite"),
    kinds: builtIn,
    defaults: { limits },
    workflows: {
      reply: defineWorkflow({
        start: "reply",
        steps: {
          reply: {
            kind: "command",
            run: [process.execPath, join(factory, "steps", "reply.ts")],
            workspace: "empty",
            inputs: { request: "request" },
            claims: ["document"],
            on: { done: "end" },
            budget: 1,
            access: {
              ...node,
              paths: [
                ...node.paths,
                { path: join(factory, "steps"), mode: "read" },
                { path: join(factory, "node_modules"), mode: "read" },
              ],
            },
          },
        },
      }),
    },
  });

  engine.commission("reply", "first", { title: "Greet", body: "Say hello." });

  const state = await engine.advance("first");
  const { entries } = engine.record("first");

  assert.equal(engine.errors("first", 1).toString(), "");
  assert.deepEqual(state, { status: "finished", by: "end" });
  assert.partialDeepStrictEqual(entries, [
    {
      entry: "attempt",
      outcome: "done",
      notes: [{ note: "Replying to Greet, as step reply", from: "step" }],
      usage: { usd: 0.5 },
      artifacts: [
        {
          artifact: { kind: "document", fields: { title: "Reply" }, body: "Reply to: Say hello." },
        },
      ],
    },
  ]);
});
