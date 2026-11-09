import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
import { defineWorkflow } from "../../src/replay.ts";
import { github, pullRequest } from "./steps.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// What the fake GitHub was asked: each request's method, path and authorization, the pull
// requests it opened and the merges it made.
type Seen = {
  requests: { method: string; path: string; authorization?: string }[];
  pulls: { title: string; body: string; head: string; base: string }[];
  merges: { sha: string; merge_method: string }[];
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
  const seen: Seen = { requests: [], pulls: [], merges: [] };

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

  return { seen, url: `http://127.0.0.1:${port}` };
}

/**
 * Commissions `first`, titled Plan, on a workflow that commits plan.txt, opens a pull request of it
 * on the fake GitHub, waits for the owner's approval and lands it.
 */
async function landing(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "record"));
  await mkdir(join(directory, "remote", "owner"), { recursive: true });
  await writeFile(join(directory, "token"), "test-token\n");

  const bare = join(directory, "remote", "owner", "app.git");

  git(directory, "init", "--quiet", "--bare", bare);
  git(bare, "config", "http.receivepack", "true");

  const { seen, url } = await fakeGitHub(t, join(directory, "remote"));

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
              `git init -q; echo plan > plan.txt; git add plan.txt; git commit -q --no-verify -m Plan
               echo 'Ran the tests.' > "$MEDRENGARD_OUT/report.md"
               printf '{"outcome":"done","artifacts":[{"kind":"commit","fields":{"sha":"%s"},"body":"report.md"}]}' "$(git rev-parse HEAD)" > "$MEDRENGARD_OUT/output.json"`,
            ],
            workspace: "empty",
            inputs: {},
            claims: ["commit"],
            on: { done: "open" },
            budget: 1,
            access: { ...contract, values: gitIdentity("Test", "test@example.com") },
          },
          open: app.open({ on: { done: "approve" } }),
          approve: { kind: "approval", on: { approve: "land" } },
          land: app.land({ on: { done: "end" } }),
        },
      }),
    },
  });

  engine.commission("build", "first", { title: "Plan", body: "Plan it." });

  return { engine, seen, bare };
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
    ["Bearer test-token", "Bearer test-token"],
  );
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
    reason: "Step land exited with code 1.",
  });
  assert.match(engine.errors("first", 3).toString(), /\(409\): .*Head branch was modified/);
  assert.deepEqual(seen.merges, []);
});

/** Starts the broker for `owner/app` on a socket of its own, forwarding to `url`. */
async function brokerFor(t: TestContext, url: string) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "token"), "test-token\n");

  const socket = join(directory, "socket");
  const flags = ["--token", join(directory, "token"), "--git", url, "--api", url];

  const running = spawn(
    process.execPath,
    [join(import.meta.dirname, "broker.ts"), "--repository", "owner/app", ...flags],
    { env: { ...process.env, MEDRENGARD_SOCKET: socket }, stdio: "ignore" },
  );

  t.after(() => running.kill());

  const send = (method: string, path: string) =>
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
      sent.end();
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
