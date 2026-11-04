// A stub agent for the dry run: it copies the problem's reference solution for the checkpoint the
// request's title names into its workspace, commits it and claims the commit, at no cost. A line
// `dry: <behaviour>` in the request chooses another: exit1 fails, rmassets also removes `files`.
// It ends with a line shaped as Claude Code's stream-json result, so the driver reads its cost.
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [problems] = process.argv.slice(2);
const inDir = process.env.MEDRENGARD_IN!;

type Entry = { fields: { title: string }; body: string };
// SAFETY: the engine writes input.json with the request as the step's input `request`.
const input = JSON.parse(readFileSync(join(inDir, "input.json"), "utf8")) as {
  inputs: { request: [Entry] };
};
const [request] = input.inputs.request;
const [problem, , n] = request.fields.title.split(" ");
const behaviour = /^dry: (\S+)$/m.exec(readFileSync(join(inDir, request.body), "utf8"))?.[1];

console.log(`stub: ${problem} checkpoint ${n}, ${behaviour ?? "solve"}`);

if (behaviour === "exit1") {
  console.error("stub: failing on purpose");
  process.exit(1);
}

cpSync(join(problems!, problem!, "solutions", `checkpoint_${n}`), ".", { recursive: true });

if (behaviour === "rmassets") rmSync("files", { recursive: true, force: true });

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

git("add", "-A");
git("commit", "--quiet", "-m", `dry: ${problem} checkpoint ${n}`);

writeFileSync(
  join(process.env.MEDRENGARD_OUT!, "output.json"),
  JSON.stringify({ outcome: "done", artifacts: [{ kind: "commit", fields: { sha: git("rev-parse", "HEAD") } }] }),
);

console.log(
  JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 1, total_cost_usd: 0 }),
);
