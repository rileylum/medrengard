import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../src/engine.ts";
import { defineWorkflow } from "../src/replay.ts";

const adapter = join(import.meta.dirname, "claude-code.ts");

/**
 * Starts an engine whose one agent step, `plan`, runs the Claude Code adapter with a fake `claude`
 * on its PATH, and commissions `first`. The fake runs `script`; its arguments are in the returned
 * directory's `arguments` file, each ended by a NUL.
 */
async function engineWithClaude(t: TestContext, script: string) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const claude = join(directory, "claude");

  await writeFile(
    claude,
    `#!/bin/sh
printf '%s\\0' "$@" > "${join(directory, "arguments")}"
${script}
`,
  );
  await chmod(claude, 0o755);

  const engine = createEngine({
    log: join(directory, "log.sqlite"),
    workflows: {
      build: defineWorkflow({
        start: "plan",
        steps: {
          plan: {
            kind: "agent",
            agent: {
              harness: {
                run: ["env", `PATH=${directory}:${process.env.PATH}`, process.execPath, adapter],
              },
              model: "a-model",
              prompt: "Plan the change.",
            },
            inputs: [],
            on: { done: "end" },
            budget: 1,
            limits: { idle: 5, attempt: 10 },
          },
        },
      }),
    },
  });

  engine.commission("build", "first", { title: "Greet", body: "Say hello." });

  return { engine, directory };
}

test("the Claude Code adapter runs claude headless with the agent, whose claim completes the attempt", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `echo '{"type":"result","is_error":false}'
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });

  const [print, ...rest] = (await readFile(join(directory, "arguments"), "utf8"))
    .split("\0")
    .slice(0, -1);

  const prompt = rest.at(-1)!;

  assert.equal(print, "-p");
  assert.deepEqual(rest.slice(0, -1), [
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "a-model",
  ]);
  assert.ok(prompt.startsWith("Plan the change.\n"));
  assert.ok(prompt.includes('["done"]'));
});

test("a Claude Code run that fails escalates its commission", async (t) => {
  const { engine } = await engineWithClaude(t, `echo '{"type":"result","is_error":true}'; exit 3`);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "plan" },
    reason: "Step plan exited with code 3.",
  });
});
