import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { contract, gitIdentity } from "../../defaults/access.ts";
import { builtIn } from "../../defaults/kinds.ts";
import { limits } from "../../defaults/limits.ts";
import { createEngine } from "../../src/engine.ts";
import { defineWorkflow } from "../../src/definition.ts";
import { isRecord } from "../../src/json.ts";
import { github, pullRequest } from "./steps.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// What the fake GitHub was asked: each request's method, path and authorization, the pull
// requests it opened, the merges it made and the issues it was filed, each as its body arrived.
type Seen = {
  requests: { method: string; path: string; authorization?: string }[];
  issues: string[];
  pulls: { title: string; body: string; head: string; base: string }[];
  merges: { sha: string; merge_method: string }[];
};

// What the fake GitHub says of pull request 7 once opened: whether it is open or closed and
// merged, its reviews, each of the head, and their inline comments.
type World = {
  state: "open" | "closed";
  merged: boolean;
  reviews: { user: { login: string }; state: string; body: string }[];
  comments: { user: { login: string }; path: string; line: number; body: string }[];
};

const bodyOf = async (stream: AsyncIterable<Buffer>) => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
};

/**
 * A fake GitHub on loopback for `owner/app`, whose Git is `git http-backend` over the bare
 * repositories under `remote`, and whose API opens pull request 7 and merges it only while its
 * head is the SHA it is given.
 */
async function fakeGitHub(t: TestContext, remote: string) {
  const seen: Seen = { requests: [], issues: [], pulls: [], merges: [] };
  const world: World = { state: "open", merged: false, reviews: [], comments: [] };

  const server = createServer(async (incoming, response) => {
    const url = new URL(incoming.url!, "http://github.test");
    const body = await bodyOf(incoming);

    seen.requests.push({
      method: incoming.method!,
      path: url.pathname,
      authorization: incoming.headers.authorization,
    });

    const json = (status: number, value: Record<string, string | number | boolean>) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };

    // The pull request as the watch reads it: its state, its reviews and their comments.
    const head = () =>
      git(join(remote, "owner", "app.git"), "rev-parse", `refs/heads/${seen.pulls[0]!.head}`);

    const read = {
      "/repos/owner/app/pulls/7": () => ({
        number: 7,
        state: world.state,
        merged: world.merged,
        head: { sha: head() },
      }),
      "/repos/owner/app/pulls/7/reviews": () =>
        world.reviews.map((review) => ({ ...review, commit_id: head() })),
      "/repos/owner/app/pulls/7/comments": () => world.comments,
    };

    // How far the head is behind and ahead of main, as GitHub compares them.
    const compared = /^\/repos\/owner\/app\/compare\/main\.\.\.([0-9a-f]{40})$/.exec(url.pathname);

    if (incoming.method === "GET" && compared !== null) {
      const bare = join(remote, "owner", "app.git");
      const count = (range: string) => Number(git(bare, "rev-list", "--count", range));

      json(200, {
        behind_by: count(`${compared[1]}..main`),
        ahead_by: count(`main..${compared[1]}`),
      });

      return;
    }

    if (incoming.method === "GET" && Object.hasOwn(read, url.pathname)) {
      response.writeHead(200, { "content-type": "application/json" });
      // SAFETY: hasOwn found the path among read's keys.
      response.end(JSON.stringify(read[url.pathname as keyof typeof read]()));

      return;
    }

    if (
      incoming.method === "GET" &&
      url.pathname === "/repos/owner/app/pulls" &&
      url.search === "?head=owner:medrengard/first&state=open"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          seen.pulls.length === 0
            ? []
            : [{ number: 7, html_url: "https://github.test/owner/app/pull/7" }],
        ),
      );

      return;
    }

    if (incoming.method === "POST" && url.pathname === "/repos/owner/app/issues") {
      seen.issues.push(body.toString());
      json(201, { number: 12, html_url: "https://github.test/owner/app/issues/12" });

      return;
    }

    // One pull request per branch, as GitHub allows.
    if (
      incoming.method === "POST" &&
      url.pathname === "/repos/owner/app/pulls" &&
      seen.pulls.length > 0
    ) {
      json(422, { message: "Validation Failed" });

      return;
    }

    if (incoming.method === "POST" && url.pathname === "/repos/owner/app/pulls") {
      seen.pulls.push(JSON.parse(body.toString()));
      json(201, { number: 7, html_url: "https://github.test/owner/app/pull/7" });

      return;
    }

    if (incoming.method === "PUT" && url.pathname === "/repos/owner/app/pulls/7/merge") {
      const asked = JSON.parse(body.toString());

      const head = git(
        join(remote, "owner", "app.git"),
        "rev-parse",
        `refs/heads/${seen.pulls[0]!.head}`,
      );

      if (asked.sha !== head) {
        json(409, { message: "Head branch was modified. Review and try the merge again." });

        return;
      }

      seen.merges.push(asked);
      json(200, { merged: true });

      return;
    }

    // Git's smart HTTP, through git http-backend as CGI.
    const backend = spawn("git", ["http-backend"], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: remote,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: incoming.method!,
        CONTENT_TYPE: incoming.headers["content-type"] ?? "",
        REMOTE_USER: "medrengard",
      },
    });

    // Git ends as soon as it has what it needs, sometimes before all of the body is written.
    backend.stdin.on("error", () => {});
    backend.stdin.end(body);

    const output = await bodyOf(backend.stdout);
    const split = output.indexOf("\r\n\r\n");
    const headers = output.subarray(0, split).toString().split("\r\n");
    const status = headers.find((line) => line.startsWith("Status:"));

    response.writeHead(
      status === undefined ? 200 : Number(status.split(" ")[1]),
      Object.fromEntries(
        headers
          .filter((line) => !line.startsWith("Status:"))
          .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)]),
      ),
    );
    response.end(output.subarray(split + 4));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  // SAFETY: a TCP server listening on a port has an address of that kind.
  const { port } = server.address() as AddressInfo;

  return { seen, world, url: `http://127.0.0.1:${port}` };
}

/** Commits `file` holding `text` to main of the bare repository `bare`, returning the commit. */
async function commitToMain(t: TestContext, bare: string, file: string, text: string) {
  const clone = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(clone, { recursive: true, force: true }));
  git(clone, "clone", "--quiet", bare, ".");
  await writeFile(join(clone, file), text);
  git(clone, "add", file);
  git(clone, "-c", "user.name=O", "-c", "user.email=o@example.com", "commit", "-q", "-m", file);
  git(clone, "push", "--quiet", "origin", "HEAD:main");

  return git(clone, "rev-parse", "HEAD");
}

/**
 * Commissions `first`, titled Plan, on a workflow that commits plan.txt on main, opens a pull
 * request of it on the fake GitHub, waits for the owner's approval and lands it, rebasing it onto
 * main and opening it again while it is behind.
 */
async function landing(t: TestContext, after: "land" | "watch" | "fix" = "land") {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "record"));
  await mkdir(join(directory, "remote", "owner"), { recursive: true });
  await writeFile(join(directory, "token"), "test-token\n");

  const bare = join(directory, "remote", "owner", "app.git");

  // Named, since the owner's Git configuration, which names it elsewhere, is not always there.
  git(directory, "init", "--quiet", "--bare", "--initial-branch", "main", bare);
  git(bare, "config", "http.receivepack", "true");
  await commitToMain(t, bare, "README", "app\n");

  const { seen, world, url } = await fakeGitHub(t, join(directory, "remote"));

  const app = github({
    repository: "owner/app",
    base: "main",
    token: join(directory, "token"),
    git: url,
    api: url,
  });

  const engine = createEngine({
    kinds: { ...builtIn, "pull-request": pullRequest },
    defaults: { limits },
    log: join(directory, "record", "log.sqlite"),
    workflows: {
      build: defineWorkflow({
        start: "develop",
        steps: {
          develop: {
            kind: "command",
            run: [
              "sh",
              "-c",
              `git clone -q file://${bare} .; echo plan > plan.txt; git add plan.txt; git commit -q --no-verify -m Plan
               echo 'Ran the tests.' > "$MEDRENGARD_OUT/report.md"
               printf '{"outcome":"done","artifacts":[{"kind":"commit","fields":{"sha":"%s"},"body":"report.md"}]}' "$(git rev-parse HEAD)" > "$MEDRENGARD_OUT/output.json"`,
            ],
            workspace: "empty",
            inputs: {},
            claims: ["commit"],
            on: { done: "open" },
            budget: 1,
            access: {
              ...contract,
              paths: [...contract.paths, { path: bare, mode: "read" }],
              values: gitIdentity("Test", "test@example.com"),
            },
          },
          open: app.open({ on: { done: after === "land" ? "approve" : after } }),
          // A fix: another commit on the subject, opened again.
          fix: {
            kind: "command",
            run: [
              "sh",
              "-c",
              `echo fixed >> plan.txt; git commit -q --no-verify -am Fix
               printf '{"outcome":"done","artifacts":[{"kind":"commit","fields":{"sha":"%s"}}]}' "$(git rev-parse HEAD)" > "$MEDRENGARD_OUT/output.json"`,
            ],
            workspace: "subject",
            inputs: {},
            claims: ["commit"],
            on: { done: "again" },
            budget: 1,
            access: { ...contract, values: gitIdentity("Test", "test@example.com") },
          },
          again: app.open({ on: { done: "end" } }),
          approve: { kind: "approval", on: { approve: "land" } },
          land: app.land({ on: { done: "end", behind: "rebase" } }),
          rebase: app.rebase({ on: { done: "open", conflict: "end" } }),
          watch: app.watch({
            on: { merged: "end", changes: "end", closed: "end" },
            interval: 1,
          }),
        },
      }),
    },
  });

  engine.commission("build", { title: "Plan", body: "Plan it." }, { name: "first" });

  return { engine, seen, world, bare };
}

type Engine = Awaited<ReturnType<typeof landing>>["engine"];

const approve = (engine: Engine) => {
  const state = engine.state("first");

  assert.ok(state.status === "awaiting");
  engine.decide("first", { subject: state.subject, since: state.since, outcome: "approve" });
};

test("a commission opens a pull request of its commit through the broker and, approved, lands it", async (t) => {
  const { engine, seen, bare } = await landing(t);

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });

  const developed = engine.record("first").entries.find((entry) => entry.entry === "attempt");

  assert.ok(developed?.entry === "attempt" && "artifacts" in developed);

  const sha = developed.artifacts[0]!.artifact.fields.sha;

  assert.equal(git(bare, "rev-parse", "refs/heads/medrengard/first"), sha);
  assert.deepEqual(seen.pulls, [
    { title: "Plan", body: "Plan it.\n\nRan the tests.\n", head: "medrengard/first", base: "main" },
  ]);

  // The judgement names the pull request and is about the commit, which stays the subject.
  const opened = engine
    .record("first")
    .entries.findLast((entry) => entry.entry === "attempt" && "artifacts" in entry);

  assert.ok(opened?.entry === "attempt" && "artifacts" in opened);
  assert.partialDeepStrictEqual(opened.artifacts[0], {
    artifact: {
      kind: "pull-request",
      fields: { repository: "owner/app", number: "7", url: "https://github.test/owner/app/pull/7" },
    },
  });

  approve(engine);
  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
  assert.deepEqual(seen.merges, [{ sha, merge_method: "merge" }]);

  // GitHub saw the token, Basic for Git and bearer for the API, never the placeholder.
  const git_ = seen.requests.filter(({ path }) => path.startsWith("/owner/app.git/"));
  const api = seen.requests.filter(({ path }) => path.startsWith("/repos/"));
  const basic = `Basic ${Buffer.from("x-access-token:test-token").toString("base64")}`;

  assert.ok(git_.length > 0 && git_.every(({ authorization }) => authorization === basic));
  assert.deepEqual(
    api.map(({ authorization }) => authorization),
    ["Bearer test-token", "Bearer test-token", "Bearer test-token"],
  );
});

/** The latest attempt at `step` of `first`, with what it claimed. */
function latest(engine: Engine, step: string) {
  const attempt = engine
    .record("first")
    .entries.findLast((entry) => entry.entry === "attempt" && entry.step === step);

  assert.ok(attempt?.entry === "attempt" && "artifacts" in attempt);

  return attempt;
}

test("work behind main is not landed but rebased onto it, opened again and, approved, landed", async (t) => {
  const { engine, seen, bare } = await landing(t);

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });

  // Another change lands on main after the owner looked.
  const main = await commitToMain(t, bare, "other.txt", "other\n");

  approve(engine);
  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });
  assert.equal(latest(engine, "land").outcome, "behind");
  assert.deepEqual(seen.merges, []);

  const rebase = latest(engine, "rebase");
  const rebased = rebase.artifacts[0]!.artifact.fields.sha!;

  assert.equal(rebase.outcome, "done");
  assert.equal(git(bare, "rev-parse", `${rebased}^`), main);
  assert.equal(git(bare, "show", `${rebased}:plan.txt`), "plan");
  assert.equal(git(bare, "rev-parse", "refs/heads/medrengard/first"), rebased);
  assert.equal(seen.pulls.length, 1);

  approve(engine);
  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
  assert.deepEqual(seen.merges, [{ sha: rebased, merge_method: "merge" }]);
});

test("work that conflicts with main is not rebased, and the rebase claims the conflicting files", async (t) => {
  const { engine, seen, bare } = await landing(t);

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });
  await commitToMain(t, bare, "plan.txt", "another plan\n");

  approve(engine);
  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });

  const rebase = latest(engine, "rebase");

  assert.equal(rebase.outcome, "conflict");
  assert.deepEqual(
    rebase.artifacts.map(({ artifact }) => [artifact.kind, artifact.fields.title, artifact.body]),
    [["document", "Conflicts rebasing onto main", "plan.txt\n"]],
  );
  assert.deepEqual(seen.merges, []);
});

test("a pull request whose head moved after it was opened is not landed, and the commission escalates", async (t) => {
  const { engine, seen, bare } = await landing(t);

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });

  // Someone pushes to the branch after the owner looked.
  const clone = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(clone, { recursive: true, force: true }));
  git(clone, "clone", "--quiet", "--branch", "medrengard/first", bare, ".");
  await writeFile(join(clone, "other.txt"), "other\n");
  git(clone, "add", "other.txt");
  git(clone, "-c", "user.name=O", "-c", "user.email=o@example.com", "commit", "-q", "-m", "Other");
  git(clone, "push", "--quiet", "origin", "HEAD:medrengard/first");

  approve(engine);

  const ended = await engine.advance("first");

  // The land step, the third attempt, says why GitHub refused.
  assert.partialDeepStrictEqual(ended, {
    status: "escalated",
    cause: "exit",
    reason: "Step land exited with code 1.",
  });
  assert.match(engine.errors("first", 3).toString(), /\(409\): .*Head branch was modified/);
  assert.deepEqual(seen.merges, []);
});

test("opening again after a fix pushes the fix to the pull request already open and claims it", async (t) => {
  const { engine, seen, bare } = await landing(t, "fix");

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });

  const attempts = engine
    .record("first")
    .entries.flatMap((entry) => (entry.entry === "attempt" && "artifacts" in entry ? [entry] : []));

  const fixed = attempts.find(({ step }) => step === "fix")!.artifacts[0]!.artifact.fields.sha;
  const opened = attempts.filter(({ step }) => step === "open" || step === "again");

  assert.equal(git(bare, "rev-parse", "refs/heads/medrengard/first"), fixed);
  assert.equal(seen.pulls.length, 1);
  assert.deepEqual(
    opened.map(({ artifacts }) => artifacts[0]!.artifact.fields.number),
    ["7", "7"],
  );
});

/** Advances `first` until it is no longer attempting or ready, as `run` does, and returns it. */
async function settle(engine: Engine, limit = 30_000) {
  const deadline = Date.now() + limit;

  while (Date.now() < deadline) {
    const state = await engine.advance("first");

    if (state.status !== "attempting" && state.status !== "ready") {
      return state;
    }

    await sleep(50);
  }

  throw new Error(`first did not settle within ${limit} ms.`);
}

// The last attempt's outcome and what it claimed, each artifact's title and body.
function watched(engine: Engine) {
  const last = engine.record("first").entries.at(-1);

  assert.ok(last?.entry === "attempt" && "artifacts" in last);

  return {
    outcome: last.outcome,
    claimed: last.artifacts.map(({ artifact }) => [artifact.fields.title, artifact.body]),
  };
}

for (const [what, change, expected] of [
  ["merged on GitHub", (world: World) => (world.merged = true), { outcome: "merged", claimed: [] }],
  [
    "closed unmerged",
    (world: World) => (world.state = "closed"),
    { outcome: "closed", claimed: [] },
  ],
  [
    "asked for changes",
    (world: World) => {
      world.reviews.push(
        { user: { login: "ana" }, state: "COMMENTED", body: "Looks close." },
        { user: { login: "ben" }, state: "CHANGES_REQUESTED", body: "Rename it." },
      );
      world.comments.push({
        user: { login: "ben" },
        path: "plan.txt",
        line: 1,
        body: "Typo here.",
      });
    },
    {
      outcome: "changes",
      claimed: [
        [
          "Review of pull request 7",
          "ana commented: Looks close.\n\nben requested changes: Rename it.\n\nben on plan.txt:1: Typo here.\n",
        ],
      ],
    },
  ],
] as const) {
  test(`a watch on a pull request that is ${what} ends, claiming what it found`, async (t) => {
    const { engine, world } = await landing(t, "watch");

    // Found only after a check that found nothing.
    setTimeout(() => change(world), 1500);

    assert.partialDeepStrictEqual(await settle(engine), { status: "finished", by: "end" });
    assert.deepEqual(watched(engine), expected);
  });
}

test("a watch on an open pull request no one has reviewed finds nothing", async (t) => {
  const { engine } = await landing(t, "watch");

  // Opened, then a first check that found nothing, and a second.
  for (let looks = 0; looks < 3; looks += 1) {
    assert.partialDeepStrictEqual(await engine.advance("first"), { status: "attempting" });
    await sleep(600);
  }
});

/**
 * Starts the broker for `owner/app` on a socket of its own, forwarding to `url`, with any `more`
 * of its options.
 */
async function brokerFor(t: TestContext, url: string, ...more: string[]) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "token"), "test-token\n");

  const socket = join(directory, "socket");
  const flags = ["--token", join(directory, "token"), "--git", url, "--api", url, ...more];

  const running = spawn(
    process.execPath,
    [join(import.meta.dirname, "broker.ts"), "--repository", "owner/app", ...flags],
    { env: { ...process.env, MEDRENGARD_SOCKET: socket }, stdio: "ignore" },
  );

  t.after(() => running.kill());

  const send = (method: string, path: string, body?: Buffer) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const sent = request(
        {
          socketPath: socket,
          method,
          path,
          headers: { authorization: "Bearer medrengard-broker" },
        },
        async (response) =>
          resolve({ status: response.statusCode!, body: (await bodyOf(response)).toString() }),
      );

      sent.on("error", reject);
      sent.end(body);
    });

  for (let tries = 0; tries < 250; tries += 1) {
    try {
      await send("GET", "/");

      return send;
    } catch {
      await sleep(20);
    }
  }

  throw new Error("The broker did not listen.");
}

for (const [method, path] of [
  ["GET", "/api/user"],
  ["DELETE", "/api/repos/owner/app"],
  ["PATCH", "/api/repos/owner/app/pulls/7"],
  ["POST", "/api/repos/owner/other/pulls"],
  ["GET", "/api/repos/owner/app/pulls/7/../../../../user"],
  [
    "GET",
    "/api/repos/owner/app/compare/main..x/../../../../user...0000000000000000000000000000000000000000",
  ],
  ["GET", "/api/repos/owner/app/issues/7"],
  ["POST", "/api/repos/owner/app/issues"],
  ["GET", "/api/repos/owner/app/issues?state=all&per_page=100&page=1"],
  ["GET", "/api/repos/owner/app/issues?state=open&per_page=100&page=1&labels=x"],
  ["GET", "/git/owner/other.git/info/refs?service=git-upload-pack"],
  ["GET", "/owner/app.git/info/refs?service=git-receive-pack"],
] as const) {
  test(`the GitHub broker refuses ${method} ${path}, forwarding it nowhere`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

    t.after(() => rm(directory, { recursive: true, force: true }));

    const { seen, url } = await fakeGitHub(t, directory);
    const send = await brokerFor(t, url);

    assert.deepEqual(await send(method, path), {
      status: 403,
      body: JSON.stringify({
        message: `Refused by Medrengard's GitHub broker: ${method} ${path} is not one it forwards for owner/app.`,
      }),
    });
    assert.deepEqual(seen.requests, []);
  });
}

// A push as Git's smart HTTP sends it: each command a line, old and new commit and the ref, the
// first with its capabilities, then a flush and the pack.
const pushing = (...refs: string[]) => {
  const line = (text: string) => `${(text.length + 4).toString(16).padStart(4, "0")}${text}`;
  const old = "0".repeat(40);
  const next = "1".repeat(40);

  return Buffer.from(
    `${refs.map((ref, index) => line(`${old} ${next} ${ref}${index === 0 ? "\0report-status" : ""}\n`)).join("")}0000PACK`,
  );
};

// Principle 12: the broker holds a token that can write the repository, so it forwards a push
// only to the commission's own branches, never to the base a pull request lands on.
test("the GitHub broker forwards a reading of the repository's open issues, a page at a time, with the token", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const { seen, url } = await fakeGitHub(t, directory);
  const send = await brokerFor(t, url);
  const answered = await send("GET", "/api/repos/owner/app/issues?state=open&per_page=100&page=2");

  assert.notEqual(answered.status, 403);
  assert.partialDeepStrictEqual(seen.requests, [
    { method: "GET", path: "/repos/owner/app/issues" },
  ]);
  assert.notEqual(seen.requests[0]!.authorization, "Bearer medrengard-broker");
});

test("the GitHub broker forwards a push only to branches under medrengard/", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const { seen, url } = await fakeGitHub(t, directory);
  const send = await brokerFor(t, url);
  const path = "/git/owner/app.git/git-receive-pack";

  for (const refs of [
    ["refs/heads/main"],
    ["refs/heads/medrengard/first", "refs/heads/main"],
    ["refs/tags/v1"],
    ["refs/heads/medrengard"],
  ]) {
    assert.deepEqual(await send("POST", path, pushing(...refs)), {
      status: 403,
      body: JSON.stringify({
        message: `Refused by Medrengard's GitHub broker: a push to ${refs.at(-1)}, which is not a branch under medrengard/.`,
      }),
    });
  }

  assert.deepEqual(seen.requests, []);

  // Its own branches go through, as does the empty request Git sends first to try its credential.
  await send("POST", path, pushing("refs/heads/medrengard/first", "refs/heads/medrengard/a.b"));
  await send("POST", path, Buffer.from("0000"));
  assert.deepEqual(
    seen.requests.map(({ method, path: forwarded }) => `${method} ${forwarded}`),
    ["POST /owner/app.git/git-receive-pack", "POST /owner/app.git/git-receive-pack"],
  );

  // A body that never ends its commands is not held for ever.
  assert.partialDeepStrictEqual(await send("POST", path, Buffer.alloc(128 * 1024, "f")), {
    status: 403,
  });
});

const issues = "/api/repos/owner/app/issues";

const filing = (issue: Record<string, string | number | string[]>) =>
  Buffer.from(JSON.stringify(issue));

const refusedIssue = (what: string) => ({
  status: 403,
  body: JSON.stringify({ message: `Refused by Medrengard's GitHub broker: an issue ${what}.` }),
});

/** A fake GitHub and the broker for it, started with `more` of its options. */
async function filingThrough(t: TestContext, ...more: string[]) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const { seen, url } = await fakeGitHub(t, directory);

  return { seen, send: await brokerFor(t, url, ...more) };
}

test("the GitHub broker, not started to file issues, refuses one and forwards it nowhere", async (t) => {
  const { seen, send } = await filingThrough(t);

  assert.deepEqual(await send("POST", issues, filing({ title: "Slow start", body: "It is." })), {
    status: 403,
    body: JSON.stringify({
      message: `Refused by Medrengard's GitHub broker: POST ${issues} is not one it forwards for owner/app.`,
    }),
  });
  assert.deepEqual(seen.requests, []);
});

// In a factory that takes a labelled issue up as new work, a step that may label one can commission
// by itself, so the broker forwards only the labels it was started with.
test("the GitHub broker started to file issues forwards one, with a label it was started with or none, with the token", async (t) => {
  const { seen, send } = await filingThrough(t, "--issues", "factory,needs triage");

  const answer = JSON.stringify({
    number: 12,
    html_url: "https://github.test/owner/app/issues/12",
  });

  const plain = { title: "Slow start", body: "It takes a minute." };
  const labelled = { title: "Flaky test", body: "", labels: ["needs triage", "factory"] };

  // As the broker read it, however the step spaced it.
  assert.deepEqual(await send("POST", issues, Buffer.from(JSON.stringify(plain, null, 2))), {
    status: 201,
    body: answer,
  });
  assert.deepEqual(await send("POST", issues, filing(labelled)), { status: 201, body: answer });
  assert.deepEqual(seen.issues, [JSON.stringify(plain), JSON.stringify(labelled)]);
  assert.deepEqual(seen.requests, [
    { method: "POST", path: "/repos/owner/app/issues", authorization: "Bearer test-token" },
    { method: "POST", path: "/repos/owner/app/issues", authorization: "Bearer test-token" },
  ]);
});

test("the GitHub broker started to file issues refuses one it cannot judge to be a title, a body and its labels, forwarding it nowhere", async (t) => {
  const { seen, send } = await filingThrough(t, "--issues", "factory");
  const issue = { title: "Slow start", body: "It takes a minute." };

  for (const [sent, what] of [
    [
      filing({ ...issue, labels: ["factory", "urgent"] }),
      'with the label "urgent", which the broker was not started to allow',
    ],
    [filing({ ...issue, assignees: ["owner"] }), 'with "assignees", a key it does not forward'],
    [filing({ ...issue, milestone: 1 }), 'with "milestone", a key it does not forward'],
    [
      // The second labels is the one a parser keeps, or the first: neither is forwarded.
      Buffer.from('{"title":"a","body":"b","labels":["factory"],"labels":["urgent"]}'),
      'with the label "urgent", which the broker was not started to allow',
    ],
    [Buffer.from("title=Slow"), "that is not JSON"],
    [Buffer.from('{"title":"Slow start","body":"It'), "that is not JSON"],
    [Buffer.alloc(0), "that is not JSON"],
    [Buffer.from('["factory"]'), "that is not a JSON object"],
    [filing({ ...issue, title: "" }), "whose title is not a string that says something"],
    [filing({ body: "It takes a minute." }), "whose title is not a string that says something"],
    [filing({ ...issue, title: 7 }), "whose title is not a string that says something"],
    [filing({ title: "Slow start" }), "whose body is not a string"],
    [filing({ ...issue, labels: "factory" }), "whose labels are not a list of strings"],
    [
      Buffer.from('{"title":"a","body":"b","labels":null}'),
      "whose labels are not a list of strings",
    ],
    [filing({ ...issue, body: "x".repeat(256 * 1024) }), "of more than 256 KiB"],
  ] as const) {
    assert.deepEqual(await send("POST", issues, sent), refusedIssue(what));
  }

  // Nothing else of an issue is forwarded: reading a closed one, editing, closing, commenting on
  // or labelling one there is.
  for (const [method, path] of [
    ["GET", `${issues}/12`],
    ["GET", `${issues}?state=closed&per_page=100&page=1`],
    ["PATCH", `${issues}/12`],
    ["POST", `${issues}/12/comments`],
    ["POST", `${issues}/12/labels`],
    ["PUT", `${issues}/12/labels`],
    ["POST", `${issues}?x=1`],
  ] as const) {
    assert.partialDeepStrictEqual(
      await send(method, path, method === "GET" ? undefined : filing(issue)),
      {
        status: 403,
        body: JSON.stringify({
          message: `Refused by Medrengard's GitHub broker: ${method} ${path} is not one it forwards for owner/app.`,
        }),
      },
    );
  }

  assert.deepEqual(seen.requests, []);
});

test("the GitHub broker started to file issues with no label forwards an unlabelled one and refuses any label", async (t) => {
  const { seen, send } = await filingThrough(t, "--issues", "");
  const issue = { title: "Slow start", body: "It takes a minute." };

  assert.deepEqual(
    await send("POST", issues, filing({ ...issue, labels: ["factory"] })),
    refusedIssue('with the label "factory", which the broker was not started to allow'),
  );
  assert.deepEqual(seen.requests, []);

  assert.equal((await send("POST", issues, filing({ ...issue, labels: [] }))).status, 201);
  assert.equal((await send("POST", issues, filing(issue))).status, 201);
  assert.deepEqual(seen.issues, [JSON.stringify({ ...issue, labels: [] }), JSON.stringify(issue)]);
});

for (const labels of ["factory;urgent", "factory,", ",", "x".repeat(51), "a/b"]) {
  test(`the GitHub broker does not start to file issues with the labels ${JSON.stringify(labels)}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, "token"), "test-token\n");

    const started = spawnSync(
      process.execPath,
      [
        join(import.meta.dirname, "broker.ts"),
        "--repository",
        "owner/app",
        "--token",
        join(directory, "token"),
        "--issues",
        labels,
      ],
      { env: { ...process.env, MEDRENGARD_SOCKET: join(directory, "socket") }, encoding: "utf8" },
    );

    assert.equal(started.status, 2);
    assert.match(started.stderr, /^The broker files issues with the labels --issues lists/);
    assert.match(started.stderr, /\nUsage: broker\.ts --repository <owner\/name> .*--issues/);
  });
}

test("the forge's steps start their broker to file issues with the labels the factory gives, or not to file any", () => {
  const run = (issues?: readonly string[]) => {
    const { network } = github({ repository: "owner/app", base: "main", issues }).open({
      on: { done: "end" },
    }).access;

    assert.ok(isRecord(network) && network.brokers !== undefined);

    return network.brokers.github!;
  };

  assert.deepEqual(run(["factory", "needs triage"]).slice(-2), [
    "--issues",
    "factory,needs triage",
  ]);
  assert.deepEqual(run([]).slice(-2), ["--issues", ""]);
  assert.ok(!run().includes("--issues"));
});
