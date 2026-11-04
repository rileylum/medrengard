// The study driver, outside in: a study file in its own repository, run over the toy problem with
// the dry stub's configurations and a fake runner, so no Docker, network or spend.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEngine } from "#medrengard/src/engine.ts";
import { repository, toy, type Result } from "./toy.ts";

type Fields = {
  configurations: string[];
  problems: string[];
  repeats: number;
  concurrency: number;
  final?: boolean;
};

// The toy problem with a study `name` over it, committed in a repository of its own.
function study(t: TestContext, prompts: string[], fields: Fields, name = "trial") {
  const problem = toy(t, prompts);
  const studies = join(problem.directory, "studies");
  const file = join(studies, `${name}.ts`);

  mkdirSync(studies);

  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@localhost", "-C", studies, ...args], {
      encoding: "utf8",
    });

  const write = (changed: Fields) => {
    writeFileSync(
      file,
      `import { defineStudy } from ${JSON.stringify(join(repository, "study.ts"))};
       export default defineStudy(${JSON.stringify({ factory: "../factory.ts", ...changed })});
      `,
    );
  };

  write(fields);
  git("init", "--quiet");
  git("add", "-A");
  git("commit", "--quiet", "-m", "study");

  const driver = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        join(repository, "driver/study.ts"),
        ...args,
        file,
        "--runner",
        process.execPath,
        "--runner",
        problem.runner,
        "--results",
        problem.results,
      ],
      { encoding: "utf8", cwd: problem.directory },
    );

  const lines = (run: string): Result[] =>
    readFileSync(join(problem.results, name, "runs", run, "toy.jsonl"), "utf8")
      .trim()
      .split("\n")
      // SAFETY: the driver writes one result per line.
      .map((line) => JSON.parse(line) as Result);

  const commissions = async () => {
    const { default: options } = await import(problem.factory);

    return createEngine(options)
      .commissions()
      .map((listed) => listed.commission);
  };

  return { ...problem, file, git, write, driver, lines, commissions, manifest: join(problem.results, name, "manifest.json") };
}

test(
  "a study runs every configuration, problem and repeat, repeats first, and records what it ran on",
  { timeout: 120_000 },
  async (t) => {
    const { driver, lines, commissions, manifest } = study(t, ["Do one.\n", "Do two.\n"], {
      configurations: ["stub", "polished"],
      problems: ["toy"],
      repeats: 2,
      concurrency: 2,
    });

    const ran = driver("run");

    assert.equal(ran.status, 0, ran.stderr);

    for (const configuration of ["stub", "polished"]) {
      for (const repeat of [1, 2]) {
        const results = lines(`trial-${configuration}-r${repeat}`);

        assert.deepEqual(
          results.map((result) => [result.configuration, result.repeat, result.checkpoint, result.status]),
          [
            [configuration, repeat, 1, "finished"],
            [configuration, repeat, 2, "finished"],
          ],
        );
      }
    }

    // Both first repeats started before either second one.
    const started = (await commissions()).filter((commission) => commission.endsWith("-toy-1"));

    assert.deepEqual(started.slice(0, 2).sort(), ["trial-polished-r1-toy-1", "trial-stub-r1-toy-1"]);

    // SAFETY: the driver writes the manifest as JSON.
    const recorded = JSON.parse(readFileSync(manifest, "utf8")) as {
      study: { hash: string; repeats: number; concurrency: number };
      repositories: { path: string; commit: string }[];
      pins: { runner: string; python: string };
      versions: { node: string };
      configurations: Record<string, string>;
    };

    assert.match(recorded.study.hash, /^[0-9a-f]{64}$/);
    assert.equal(recorded.study.concurrency, 2);
    assert.equal(recorded.repositories.length, 2);
    assert.deepEqual(recorded.pins, { runner: "fake", problems: "fake", python: "3.12.0", matches: true });
    assert.equal(recorded.versions.node, process.version);
    assert.notEqual(recorded.configurations.stub, recorded.configurations.polished);
  },
);

test(
  "a study run again goes on where it stopped, and refuses a study changed since it started",
  { timeout: 120_000 },
  async (t) => {
    const fields = { configurations: ["stub"], problems: ["toy"], repeats: 1, concurrency: 1 };
    const { driver, commissions, write, git } = study(t, ["Do one.\n"], fields);

    assert.equal(driver("run").status, 0);

    const before = await commissions();
    const again = driver("run");

    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(await commissions(), before);

    write({ ...fields, repeats: 2 });
    git("commit", "--quiet", "-am", "more repeats");

    const changed = driver("run");

    assert.equal(changed.status, 2);
    assert.match(changed.stderr, /changed since it started: study/);
    assert.deepEqual(await commissions(), before);
  },
);

test(
  "an escalation stops a study starting problem runs, and its status lists it for the owner",
  { timeout: 120_000 },
  async (t) => {
    const { driver, commissions } = study(t, ["Do one.\ndry: exit1\n"], {
      configurations: ["stub"],
      problems: ["toy"],
      repeats: 2,
      concurrency: 1,
    });

    const ran = driver("run");

    assert.equal(ran.status, 3, ran.stderr);
    assert.deepEqual(await commissions(), ["trial-stub-r1-toy-1"]);

    const status = driver("status");

    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /trial-stub-r1-toy-1 escalated at implement: /);
    assert.match(status.stdout, /trial-stub-r2 toy: not started/);
  },
);

test(
  "a study refuses held-out problems unless final, a configuration the factory lacks, and a changed tree",
  { timeout: 120_000 },
  async (t) => {
    const fields = { configurations: ["stub"], problems: ["toy"], repeats: 1, concurrency: 1 };
    const { driver, write, git, results } = study(t, ["Do one.\n"], fields);

    write({ ...fields, problems: ["xjq"] });
    git("commit", "--quiet", "-am", "held out");
    assert.match(driver("run").stderr, /xjq is held out/);

    write({ ...fields, configurations: ["missing"] });
    git("commit", "--quiet", "-am", "missing");
    assert.match(driver("run").stderr, /no configuration named missing/);

    // Uncommitted: what ran could not be named.
    write(fields);

    const dirty = driver("run");

    assert.equal(dirty.status, 2);
    assert.match(dirty.stderr, /has uncommitted changes/);
    assert.ok(!existsSync(join(results, "trial")));
  },
);
