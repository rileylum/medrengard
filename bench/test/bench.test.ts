// The driver, outside in: a toy problem of two checkpoints through the real workflow, with the dry
// stub as the agent and a fake runner in place of SlopCodeBench's, so no Docker, network or spend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createEngine } from "@medrengard/core/src/engine.ts";
import { toy } from "./toy.ts";


test(
  "a dry run takes each checkpoint from the last one's commit, restores its assets and grades it",
  { timeout: 120_000 },
  async (t) => {
    const prompts = ["Do one.\ndry: rmassets\n", "Keep going: do two.\n"];
    const { directory, factory, bench, read } = toy(t, prompts);

    const ran = bench("r1");

    assert.equal(ran.status, 0, ran.stderr);

    const [first, second] = read("r1");

    assert.equal(first?.status, "finished");
    assert.equal(second?.status, "finished");

    // Checkpoint 2 starts from checkpoint 1's commit.
    const trajectories = join(directory, "state", "trajectories.git");

    execFileSync("git", [
      "-C",
      trajectories,
      "merge-base",
      "--is-ancestor",
      first!.commit!,
      second!.commit!,
    ]);

    // Each was graded on its own commit: checkpoint 1 removed the assets, checkpoint 2's start
    // restored them, as SlopCodeBench's harness does.
    assert.equal(first?.grade?.contents["a.py"], "one\n");
    assert.ok(!first?.grade?.files.includes("files/data.txt"));
    assert.equal(second?.grade?.contents["a.py"], "two\n");
    assert.equal(second?.grade?.contents["files/data.txt"], "asset\n");
    assert.equal(second?.solved, true);

    // SlopCodeBench's two quality scores, as its scb-check reports them.
    assert.equal(second?.verbosity, 0.25);
    assert.equal(second?.erosion, 0.5);
    assert.match(ran.stdout, /r1-toy-2: solved, Core 1\/1, verbosity 0\.25, erosion 0\.5/);

    // The stub's result line, as Claude Code's stream-json ends.
    assert.deepEqual(second?.cost, { usd: 0, turns: 1, seconds: 0.001, attempts: 1 });
    assert.equal(second?.configuration, "stub");
    assert.match(second?.definition ?? "", /^[0-9a-f]{64}$/);
    assert.ok(typeof second?.seconds === "number");

    // The request is the rendered task, byte for byte.
    const { default: options } = await import(factory);
    const engine = createEngine(options);
    const { request } = engine.record(second!.commission);

    assert.equal(engine.artifact(request.hash).body, prompts[1]);

    // As SlopCodeBench's harness does, a checkpoint after the first starts with its virtual
    // environment made again from requirements.txt; the first has none to make.
    assert.match(engine.transcript(first!.commission, 2).toString(), /^stub: \.venv absent$/m);
    assert.match(engine.transcript(second!.commission, 2).toString(), /^stub: \.venv present$/m);
  },
);

test(
  "a checkpoint that escalates stops its problem, ungraded, for the owner",
  { timeout: 120_000 },
  async (t) => {
    const { bench, read } = toy(t, ["Do one.\ndry: exit1", "Do two."]);

    const ran = bench("r1");

    assert.equal(ran.status, 3);
    assert.match(ran.stderr, /escalated at implement/);

    const results = read("r1");

    assert.equal(results.length, 1);
    assert.equal(results[0]?.status, "escalated");
    assert.equal(results[0]?.grade, undefined);
  },
);

test(
  "an agent's /tmp and home are fresh scratch areas on disk, beside its workspace, not in memory",
  { timeout: 120_000 },
  async (t) => {
    // The stub fails unless both are on the workspace's device and empty of anything but its own.
    const { bench, read } = toy(t, ["Do one.\ndry: scratch\n"]);

    const ran = bench("r1");

    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(read("r1")[0]?.status, "finished");
  },
);

test(
  "a problem with no assets starts from an empty repository",
  { timeout: 120_000 },
  async (t) => {
    const { bench, read, trajectories } = toy(t, ["Do one.\n"], false);

    const ran = bench("r1");

    assert.equal(ran.status, 0, ran.stderr);

    const [first] = read("r1");

    assert.equal(first?.status, "finished");
    assert.deepEqual(first?.grade?.files, ["a.py", "requirements.txt"]);

    // The start the agent was given holds nothing.
    assert.equal(execFileSync("git", ["-C", trajectories, "ls-tree", "r1-toy-1"], { encoding: "utf8" }), "");
  },
);

test(
  "an agent that claims its start back as its work escalates",
  { timeout: 120_000 },
  async (t) => {
    const { bench, read } = toy(t, ["Do one.\n", "Do two.\ndry: noop\n"]);

    const ran = bench("r1");

    assert.equal(ran.status, 3);
    assert.match(ran.stderr, /r1-toy-2 escalated at implement: .* is already the subject\./);
    assert.deepEqual(
      read("r1").map((result) => result.status),
      ["finished", "escalated"],
    );
  },
);

test(
  "a configuration of several agent steps is graded on its last commit, its cost summed over them",
  { timeout: 120_000 },
  async (t) => {
    const { bench, read } = toy(t, ["Do one.\n"]);

    const ran = bench("r1", "polished");

    assert.equal(ran.status, 0, ran.stderr);

    const [first] = read("r1");

    assert.equal(first?.configuration, "polished");
    assert.equal(first?.grade?.contents["a.py"], "one\n");
    assert.equal(first?.grade?.contents["POLISHED"], "toy checkpoint 1\n");
    assert.deepEqual(first?.cost, { usd: 0, turns: 2, seconds: 0.002, attempts: 2 });
  },
);

test(
  "a re-run waits on an escalation until the owner decides it, and an abandon ends the problem",
  { timeout: 120_000 },
  async (t) => {
    const { bench, read, engine } = toy(t, ["Do one.\n", "Do two.\ndry: exit1\n"]);

    assert.equal(bench("r1").status, 3);

    // Undecided: nothing is attempted again, and the finished checkpoint is not run again.
    const waiting = bench("r1");

    assert.equal(waiting.status, 3);
    assert.match(waiting.stderr, /r1-toy-2 escalated at implement/);

    const log = await engine();

    assert.equal(log.record("r1-toy-2").entries.filter((entry) => entry.entry === "attempt").length, 2);

    // A retry attempts the step again; the stub fails again.
    const decide = (outcome: string) => {
      const state = log.state("r1-toy-2");

      assert.equal(state.status, "escalated");
      log.decide("r1-toy-2", { subject: state.subject, since: state.since, outcome });
    };

    decide("retry");
    assert.equal(bench("r1").status, 3);
    assert.equal(log.record("r1-toy-2").entries.filter((entry) => entry.entry === "attempt").length, 3);

    // Abandoned: the problem ends there, as the configuration's failure. The first escalation and
    // the retry's each left a line; the re-run that only waited left none.
    decide("abandon");

    const ended = bench("r1");

    assert.equal(ended.status, 0, ended.stderr);
    assert.deepEqual(
      read("r1").map((result) => [result.checkpoint, result.status]),
      [
        [1, "finished"],
        [2, "escalated"],
        [2, "escalated"],
        [2, "abandoned"],
      ],
    );
  },
);

test(
  "the stub still commits at a checkpoint whose reference solution is the last one's",
  { timeout: 120_000 },
  async (t) => {
    const { bench, read } = toy(t, ["Do one.\n", "Do it again.\n"], true, true);

    const ran = bench("r1");

    assert.equal(ran.status, 0, ran.stderr);

    const [, second] = read("r1");

    assert.equal(second?.grade?.contents["a.py"], "one\n");
    assert.equal(second?.grade?.contents[".dry"], "toy checkpoint 2\n");
  },
);

test(
  "every commit a configuration makes before the one it claims is graded too, oldest first",
  { timeout: 120_000 },
  async (t) => {
    const { bench, read, trajectories } = toy(t, ["Do one.\n", "Keep going: do two.\n"]);

    // polished commits the stub's work, then a commit adding POLISHED, and claims the second.
    for (const [run, configuration] of [["p1", "polished"], ["s1", "stub"]] as const) {
      const ran = bench(run, configuration);

      assert.equal(ran.status, 0, ran.stderr);
    }

    for (const line of read("p1")) {
      const parent = execFileSync("git", ["-C", trajectories, "rev-parse", `${line.commit!}^`], { encoding: "utf8" }).trim();

      assert.deepEqual(
        line.commits?.map((one) => one.commit),
        [parent],
      );
      // Graded as it stood: the stub's work, before this checkpoint's polish wrote POLISHED (a
      // checkpoint after the first starts with the last one's).
      const polish = `toy checkpoint ${line.checkpoint}\n`;

      assert.notEqual(line.commits![0]!.grade.contents["POLISHED"], polish);
      assert.equal(line.grade!.contents["POLISHED"], polish);
    }

    // One commit per checkpoint, the one claimed: nothing earlier to grade.
    for (const line of read("s1")) assert.deepEqual(line.commits, []);
  },
);
