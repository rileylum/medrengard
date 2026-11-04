/**
 * A factory of fake steps for tests that drive the engine through a program, as the CLI and the
 * TUI do, and the CLI run as a client would run it.
 */
import type { TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dirname, "medrengard.ts");
const repository = join(import.meta.dirname, "..");

/**
 * Writes a factory in a new directory, with the workflow `build`, whose command step prints hello,
 * claims `done` and awaits the owner at `review`; the workflow `failing`, whose step exits 3; and
 * the workflow `slow`, whose step appends start, then end half a second later, to the directory's
 * `steps` file and leads to `review`; the workflow `twice`, whose two such steps lead to `review`; and the workflow
 * `noting`, whose step writes two notes and leads to `review`. Its log is in the directory's `state`.
 */
export async function factoryIn(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const factory = join(directory, "factory.ts");

  await writeFile(
    factory,
    `import { defineWorkflow } from ${JSON.stringify(join(repository, "src/replay.ts"))};
     import { contract } from ${JSON.stringify(join(repository, "defaults/access.ts"))};
     import { builtIn } from ${JSON.stringify(join(repository, "defaults/kinds.ts"))};
     import { limits } from ${JSON.stringify(join(repository, "defaults/limits.ts"))};

     const step = (script: string) => ({
       kind: "command", workspace: "empty", inputs: {}, claims: ["document"], access: contract,
       run: ["sh", "-c", script], budget: 1,
       limits: { idle: 5, attempt: 10, transcript: 65536, input: 65536 },
     }) as const;

     const slow = {
       ...step(""),
       run: [
         "sh", "-c",
         \`echo start >> "$1"; sleep 0.5; echo end >> "$1"
          echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"\`,
         "sh", ${JSON.stringify(join(directory, "steps"))},
       ],
       access: {
         ...contract,
         paths: [...contract.paths, { path: ${JSON.stringify(directory)}, mode: "write" }],
       },
     } as const;

     // A step that runs until the test lets it go, so a test can look at it while it runs.
     const held = {
       ...slow,
       run: [
         "sh", "-c",
         \`echo start >> "$1"; until [ -e "$1.go" ]; do sleep 0.02; done
          echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"\`,
         "sh", ${JSON.stringify(join(directory, "held"))},
       ],
     } as const;

     // An agent step the owner attends: it says whether it has a terminal and its size, keeps its
     // input.json, asks the owner a question and greets them by the answer.
     const attended = {
       ...slow,
       kind: "agent",
       attended: true,
       run: undefined,
       agent: {
         harness: {
           run: [
             "sh", "-c",
             \`[ -t 0 ] && echo "terminal: $(stty size)"; cp "$MEDRENGARD_IN/input.json" "$1"
              printf 'Your name? '; read name; echo "hello $name"
              echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"\`,
             "sh", ${JSON.stringify(join(directory, "input.json"))},
           ],
         },
         model: "a-model",
         prompt: "Greet the owner.",
       },
     } as const;

     export default {
       log: "state/log.sqlite",
       defaults: { limits },
       kinds: {
         ...builtIn,
         memo: {
           role: "judgement", description: "A memo.", fields: { note: { limit: 20 } },
           body: { required: false, limit: 100 },
           verifier: {
             run: ["sh", "-c", \`echo '{"accepted":true,"keep":[]}' > "$MEDRENGARD_OUT/output.json"\`],
             access: contract, limit: 5, memory: 4 * 1024 * 1024 * 1024, processes: 1024, kept: 1024,
           },
         },
       },
       workflows: {
         build: defineWorkflow({
           start: "build",
           steps: {
             build: {
               ...step(\`echo hello; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"\`),
               on: { done: "review" },
             },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         attended: defineWorkflow({
           start: "greet",
           steps: {
             greet: { ...attended, on: { done: "review" } },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         // Reads five lines the owner types with echo off, so only their typing is activity.
         typing: defineWorkflow({
           start: "greet",
           steps: {
             greet: {
               ...attended,
               agent: {
                 ...attended.agent,
                 harness: {
                   run: [
                     "sh", "-c",
                     \`stty -echo; echo ready; for i in 1 2 3 4 5; do read line; done
                      echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"\`,
                   ],
                 },
               },
               limits: { ...attended.limits, idle: 1 },
               on: { done: "review" },
             },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         // Waits longer than a second with no output, which only unbounded limits allow at once.
         unbounded: defineWorkflow({
           start: "greet",
           steps: {
             greet: {
               ...attended,
               agent: {
                 ...attended.agent,
                 harness: {
                   run: [
                     "sh", "-c",
                     \`sleep 1.2; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"\`,
                   ],
                 },
               },
               limits: { ...attended.limits, idle: "unbounded", attempt: "unbounded" },
               on: { done: "review" },
             },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         // Writes its output, then one that would escalate, then one with a document, and lingers.
         revising: defineWorkflow({
           start: "greet",
           steps: {
             greet: {
               ...attended,
               agent: {
                 ...attended.agent,
                 harness: {
                   run: [
                     "sh", "-c",
                     \`echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"; sleep 0.6
                      echo '{"outcome":"nope"}' > "$MEDRENGARD_OUT/output.json"; sleep 0.6
                      echo 'Revised.' > "$MEDRENGARD_OUT/body.md"
                      echo '{"outcome":"done","artifacts":[{"kind":"document","fields":{"title":"Plan"},"body":"body.md"}]}' > "$MEDRENGARD_OUT/output.json"
                      sleep 0.6\`,
                   ],
                 },
               },
               on: { done: "review" },
             },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         // Runs until it is stopped, saying so when it gets SIGTERM.
         lingering: defineWorkflow({
           start: "greet",
           steps: {
             greet: {
               ...attended,
               agent: {
                 ...attended.agent,
                 harness: {
                   run: [
                     "sh", "-c",
                     \`trap 'echo terminated >> "$1"; exit 1' TERM; echo started
                      while :; do sleep 0.1; done
                      \`,
                     "sh", ${JSON.stringify(join(directory, "signals"))},
                   ],
                 },
               },
               on: { done: "review" },
             },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         slow: defineWorkflow({
           start: "build",
           steps: {
             build: { ...slow, on: { done: "review" } },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         held: defineWorkflow({
           start: "build",
           steps: {
             build: { ...held, on: { done: "review" } },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         twice: defineWorkflow({
           start: "build",
           steps: {
             build: { ...slow, on: { done: "again" } },
             again: { ...slow, on: { done: "review" } },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         noting: defineWorkflow({
           start: "build",
           steps: {
             build: {
               ...step(\`echo 'Reading the request.' >&3; echo 'Writing the reply.' >&3
                 echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"\`),
               on: { done: "review" },
             },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         judged: defineWorkflow({
           start: "build",
           steps: {
             build: {
               ...step(\`echo '{"outcome":"pass","artifacts":[{"kind":"memo","fields":{"note":"Checked."}},{"kind":"verdict","fields":{"verdict":"pass"}}]}' > "$MEDRENGARD_OUT/output.json"\`),
               claims: ["memo", "verdict"],
               on: { pass: "review", fail: "review" },
             },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         // Writes control sequences everywhere an agent's text reaches the owner: cursor up and
         // erase line, a clipboard write (OSC 52), a carriage return, an 8-bit CSI and a
         // right-to-left override.
         hostile: defineWorkflow({
           start: "build",
           steps: {
             build: {
               ...step(\`printf '\\\\033[1A\\\\033[2KNote\\\\r\\\\302\\\\2332K\\\\342\\\\200\\\\256\\\\n' >&3
                 printf '\\\\033]52;c;eA==\\\\007Out\\\\n'
                 printf '\\\\033[1AErr\\\\n' >&2
                 printf '\\\\033[1A\\\\033[2KBody\\\\302\\\\233\\\\342\\\\200\\\\256' > "$MEDRENGARD_OUT/body.md"
                 echo '{"outcome":"done","artifacts":[{"kind":"document","fields":{"title":"Title\\\\u001b[1A\\\\u009b\\\\u202e"},"body":"body.md"}]}' > "$MEDRENGARD_OUT/output.json"\`),
               on: { done: "review" },
             },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         // Leads back to itself, so its second start finds its budget spent.
         looping: defineWorkflow({
           start: "build",
           steps: {
             build: {
               ...step(\`echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"\`),
               on: { done: "build" },
             },
           },
         }),
         failing: defineWorkflow({
           start: "build",
           steps: { build: { ...step("echo broke >&2; exit 3"), on: { done: "end" } } },
         }),
       },
     };`,
  );

  return { directory, factory };
}

/**
 * Runs the CLI with `args` from the temp directory, not the factory's, with `factory` as
 * MEDRENGARD_FACTORY unless it is undefined.
 */
export function run(args: readonly string[], factory: string | undefined) {
  const env = { ...process.env, MEDRENGARD_FACTORY: factory };

  if (factory === undefined) {
    delete env.MEDRENGARD_FACTORY;
  }

  const { status, stdout, stderr } = spawnSync(process.execPath, [cli, ...args], {
    cwd: tmpdir(),
    env,
    encoding: "utf8",
  });

  return { status, stdout, stderr };
}
