import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { builtIn } from "./kinds.ts";
import { createEngine } from "../src/engine.ts";
import { defineWorkflow, type Access } from "../src/replay.ts";
import { claudeCode, contract } from "./access.ts";

const tokenFile = join(homedir(), ".config", "medrengard", "claude-token");
const claude = join(homedir(), ".local", "bin", "claude");

/** Runs `script` as a command step under `access` and returns what it printed. */
async function seenUnder(t: TestContext, access: Access, script: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const engine = createEngine({
    log: join(directory, "log.sqlite"),
    kinds: builtIn,
    workflows: {
      look: defineWorkflow({
        start: "look",
        steps: {
          look: {
            kind: "command",
            claims: [],
            workspace: "empty",
            inputs: {},
            run: [
              "sh",
              "-c",
              `${script}\necho '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
              "sh",
              homedir(),
            ],
            on: { done: "end" },
            access,
            budget: 1,
            limits: { idle: 30, attempt: 60, transcript: 16 * 1024 * 1024, input: 65536 },
          },
        },
      }),
    },
  });

  engine.commission("look", "first", { title: "Look", body: "Look around." });
  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  return engine.transcript("first", 1).toString();
}

test("contract hides the owner's home and the network, and gives only PATH", async (t) => {
  const seen = await seenUnder(
    t,
    contract,
    `test -e "$1" && echo "home visible"
     tr '\\0' '\\n' < /proc/$$/environ | cut -d= -f1 | sort
     grep -c : /proc/net/dev`,
  );

  // The environment's names, PWD being bwrap's --chdir; then the interfaces: loopback alone.
  assert.equal(seen, "MEDRENGARD_IN\nMEDRENGARD_OUT\nPATH\nPWD\n1\n");
});

test(
  "claudeCode shows nothing of the owner's home but the token file, claude, Node with npm and the adapters",
  {
    skip:
      !existsSync(tokenFile) || !existsSync(claude) ? "no Claude token file or claude here" : false,
  },
  async (t) => {
    const seen = await seenUnder(
      t,
      claudeCode,
      `find "$1" \\( -type f -o -type l \\) 2>/dev/null
       npm --version > /dev/null && echo "npm runs"
       tr '\\0' '\\n' < /proc/$$/environ | cut -d= -f1 | grep -c TOKEN`,
    );

    const lines = seen.trimEnd().split("\n");
    const tokens = lines.pop();
    const npmRuns = lines.pop();

    // Node's executables, its links to them, and npm: none of the other packages installed beside.
    const install = dirname(dirname(process.execPath));
    const npm = join(install, "lib", "node_modules", "npm");

    const granted = [
      tokenFile,
      claude,
      join(import.meta.dirname, "..", "adapters"),
      ...(existsSync(npm) ? [dirname(process.execPath), npm] : [process.execPath]),
    ];

    const outside = lines.filter(
      (file) => !granted.some((path) => file === path || file.startsWith(`${path}/`)),
    );

    assert.deepEqual(outside.slice(0, 10), []);
    assert.ok(lines.includes(tokenFile));
    assert.equal(tokens, "0");
    assert.equal(npmRuns, "npm runs");
  },
);

test("claudeCode gives the adapter the token file to read, and no token in the environment", () => {
  // In the environment, the token would be in reach of everything the agent runs.
  assert.ok(claudeCode.environment !== "all");
  assert.ok(!claudeCode.environment.includes("CLAUDE_CODE_OAUTH_TOKEN"));
  assert.ok(claudeCode.paths.some(({ path, mode }) => path === tokenFile && mode === "read"));
});
