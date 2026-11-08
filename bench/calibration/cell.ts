// One problem run of SlopCodeBench's own harness, for a calibrating study: runs calibration/run.sh
// on the problem in a scratch directory of its own, then writes its per-checkpoint results as
// driver/bench.ts writes ours, under the configuration `slopcodebench`. Spends the owner's
// subscription: only with their approval.
//
// Exit 0 once every checkpoint is graded; 3 when the run stopped short, or an earlier one was
// interrupted, which waits for the owner: their run is never started again by itself.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    problem: { type: "string" },
    run: { type: "string" },
    repeat: { type: "string" },
    effort: { type: "string" },
    results: { type: "string" },
    scratch: { type: "string" },
    harness: { type: "string", multiple: true },
  },
});

const { problem, run, repeat, effort, results } = values;

if ([problem, run, repeat, effort, results, values.scratch].includes(undefined)) {
  console.error(
    "Usage: cell.ts --problem <p> --run <id> --repeat <k> --effort <e> --results <dir> --scratch <dir> [--harness <argv>…]",
  );
  process.exit(2);
}

const configuration = "slopcodebench";
const harness = values.harness ?? [new URL("run.sh", import.meta.url).pathname];
const scratch = join(resolve(values.scratch!), run!, problem!);
const out = join(resolve(results!), run!);
const lines = join(out, `${problem}.jsonl`);

if (existsSync(lines)) {
  const last = readFileSync(lines, "utf8").trim().split("\n").at(-1)!;
  // SAFETY: this program wrote it.
  const { status, commission, reason } = JSON.parse(last) as { status: string; commission: string; reason?: string };

  if (status === "finished") process.exit(0);

  console.error(`${commission} ${status}: ${reason}`);
  process.exit(3);
}

if (existsSync(scratch)) {
  console.error(`${run} ${problem}: their run was interrupted; ${scratch} holds what it left, for the owner.`);
  process.exit(3);
}

mkdirSync(scratch, { recursive: true });

const harnessRun = spawnSync(harness[0]!, [...harness.slice(1), problem!, effort!], {
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, SCRATCH: scratch },
});

// Their save_dir holds one directory per model, and in it one per run.
const outputs = join(scratch, "outputs");
const found = existsSync(outputs)
  ? readdirSync(outputs).flatMap((model) => readdirSync(join(outputs, model)).map((name) => join(outputs, model, name)))
  : [];

if (found.length !== 1) {
  console.error(`${run} ${problem}: expected one run of theirs under ${outputs}, found ${found.length} (exit ${harnessRun.status}).`);
  process.exit(1);
}

const output = found[0]!;
// SAFETY: their result.json and checkpoint_results.jsonl, of which only these fields are read.
const { expected_checkpoints: checkpoints } = JSON.parse(readFileSync(join(output, "result.json"), "utf8")) as {
  expected_checkpoints: number;
};
const rows = existsSync(join(output, "checkpoint_results.jsonl"))
  ? readFileSync(join(output, "checkpoint_results.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, number> & { state: string })
  : [];

mkdirSync(out, { recursive: true });

const record = (line: object) =>
  appendFileSync(lines, `${JSON.stringify({ configuration, repeat: Number(repeat), checkpoints, ...line })}\n`);
const groups = { Core: "core", Functionality: "functionality", Error: "error", Regression: "regression" };

// A checkpoint their harness did not run, such as one where the agent erred, is no result about
// the configuration: it stops the run there for the owner, as a short run does.
const ran = rows.findIndex((row) => row.state !== "ran");
const graded = ran === -1 ? rows : rows.slice(0, ran);

for (const row of graded) {
  const counts = (suffix: string) =>
    Object.fromEntries(Object.entries(groups).map(([group, field]) => [group, row[`${field}_${suffix}`] ?? 0]));
  const passed = counts("passed");
  const total = counts("total");

  record({
    checkpoint: row.idx,
    commission: `${run}-${problem}-${row.idx}`,
    status: "finished",
    output,
    seconds: row.duration,
    cost: { usd: row.cost, turns: row.steps, seconds: row.duration, attempts: 1 },
    solved: total.Core! > 0 && passed.Core === total.Core,
    verbosity: row.verbosity,
    erosion: row.erosion,
    grade: { pass_counts: passed, total_counts: total },
  });
}

if (graded.length < checkpoints) {
  const n = graded.length + 1;
  const reason =
    ran === -1
      ? `their run stopped (exit ${harnessRun.status}): see ${join(output, "run_agent.log")}`
      : `their checkpoint ${n} is ${rows[ran]!.state}, not ran`;

  record({ checkpoint: n, commission: `${run}-${problem}-${n}`, status: "stopped", reason });
  console.error(`${run}-${problem}-${n} stopped: ${reason}.`);
  process.exit(3);
}
