// A stub agent for the dry run: it copies the problem's reference solution for the checkpoint the
// request's title names into its workspace, commits it and claims the commit, at no cost. A line
// `dry: <behaviour>` in the request chooses another: exit1 fails, scratch fails unless /tmp and the
// home are on the workspace's disk, not memory, rmassets also removes `files`, noop
// claims the start unchanged. Given the mode `polish` instead of `solve`, it only adds POLISHED to
// what it was given, as a second step of a configuration would.
// It ends with a line shaped as Claude Code's stream-json result, so the driver reads its cost.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [problems, mode = "solve"] = process.argv.slice(2);
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
console.log(`stub: .venv ${existsSync(".venv/bin/python") ? "present" : "absent"}`);

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const claim = () =>
  writeFileSync(
    join(process.env.MEDRENGARD_OUT!, "output.json"),
    JSON.stringify({ outcome: "done", artifacts: [{ kind: "commit", fields: { sha: git("rev-parse", "HEAD") } }] }),
  );

const result = () =>
  console.log(
    JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 1, total_cost_usd: 0 }),
  );

if (mode === "polish") {
  writeFileSync("POLISHED", `${problem} checkpoint ${n}\n`);
  git("add", "-A");
  git("commit", "--quiet", "-m", `dry: polish ${problem} checkpoint ${n}`);
  claim();
  result();
  process.exit(0);
}

// Claims the start it was given, unchanged, as its work.
if (behaviour === "noop") {
  claim();
  process.exit(0);
}

if (behaviour === "scratch") {
  const disk = statSync(".").dev;
  const memory = ["/tmp", process.env.HOME!].filter((path) => statSync(path).dev !== disk);

  if (memory.length > 0) {
    console.error(`stub: ${memory.join(" and ")} not on the workspace's disk`);
    process.exit(1);
  }
}

if (behaviour === "exit1") {
  console.error("stub: failing on purpose");
  process.exit(1);
}

cpSync(join(problems!, problem!, "solutions", `checkpoint_${n}`), ".", { recursive: true });

if (behaviour === "rmassets") rmSync("files", { recursive: true, force: true });

// Some checkpoints' reference solutions are the last one's; the commit verifier refuses a commit
// that changes nothing, so .dry names the checkpoint reached.
if (git("status", "--porcelain") === "") writeFileSync(".dry", `${problem} checkpoint ${n}\n`);

git("add", "-A");
git("commit", "--quiet", "-m", `dry: ${problem} checkpoint ${n}`);

claim();
result();
