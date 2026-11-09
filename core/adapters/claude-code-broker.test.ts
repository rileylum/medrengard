import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const broker = join(import.meta.dirname, "claude-code-broker.ts");

type Received = { authorization?: string; host?: string; path?: string; body: string };

/**
 * Starts the broker with the token `sk-ant-oat01-test-token` in its token file, forwarding to a
 * model API on loopback that answers 200 with `answered` and records each request it receives.
 * Returns the broker's socket and what the API received.
 */
async function brokered(t: TestContext, answered = "answered") {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "token"), "sk-ant-oat01-test-token\n");

  const received: Received[] = [];

  const api = createServer((incoming, response) => {
    let body = "";

    incoming.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    incoming.on("end", () => {
      received.push({ ...incoming.headers, path: incoming.url, body });
      response.end(answered);
    });
  });

  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());

  // SAFETY: a TCP server listening on a port has an address of that kind.
  const { port } = api.address() as AddressInfo;
  const socket = join(directory, "socket");

  const running = spawn(
    process.execPath,
    [broker, "--token", join(directory, "token"), "--upstream", `http://127.0.0.1:${port}`],
    { env: { ...process.env, MEDRENGARD_SOCKET: socket }, stdio: "ignore" },
  );

  t.after(() => running.kill());
  await listening(running, socket);

  return { socket, received };
}

// Waits until something listens on `socket`, as the engine does.
async function listening(running: ChildProcess, socket: string): Promise<void> {
  for (let tries = 0; tries < 250; tries += 1) {
    if (running.exitCode !== null) {
      throw new Error(`The broker exited with ${running.exitCode}.`);
    }

    try {
      await post(socket, "/", {}, "");

      return;
    } catch {
      await sleep(20);
    }
  }

  throw new Error("The broker did not listen.");
}

/** Posts `body` to `path` on the broker at `socket`, with `headers`; its status and body. */
async function post(
  socket: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string }> {
  const sent = request({ socketPath: socket, path, method: "POST", headers });

  sent.end(body);

  const [response] = await once(sent, "response");
  let text = "";

  for await (const chunk of response) {
    text += chunk.toString();
  }

  return { status: response.statusCode, body: text };
}

test("the Claude Code broker forwards a request carrying the placeholder with the token in its place", async (t) => {
  const { socket, received } = await brokered(t);

  const answer = await post(
    socket,
    "/v1/messages?beta=true",
    { authorization: "Bearer medrengard-broker", "anthropic-beta": "oauth-2025-04-20" },
    '{"model":"sonnet"}',
  );

  assert.deepEqual(answer, { status: 200, body: "answered" });
  assert.partialDeepStrictEqual(received.at(-1), {
    authorization: "Bearer sk-ant-oat01-test-token",
    path: "/v1/messages?beta=true",
    "anthropic-beta": "oauth-2025-04-20",
    body: '{"model":"sonnet"}',
  });
});

for (const [what, headers] of [
  ["no credential", {}],
  ["a credential of its own", { authorization: "Bearer sk-ant-oat01-someone-elses" }],
] as const) {
  test(`the Claude Code broker refuses a request with ${what}, forwarding nothing`, async (t) => {
    const { socket, received } = await brokered(t);
    const before = received.length;

    const answer = await post(socket, "/v1/messages", headers, "{}");

    assert.equal(answer.status, 401);
    assert.equal(received.length, before);
  });
}

test("the Claude Code broker cannot start without its token, and says why", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const running = spawn(process.execPath, [broker, "--token", join(directory, "missing")], {
    env: { ...process.env, MEDRENGARD_SOCKET: join(directory, "socket") },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let said = "";

  running.stderr.on("data", (chunk: Buffer) => {
    said += chunk.toString();
  });

  const [code] = await once(running, "close");

  assert.equal(code, 2);
  assert.match(said, /^Cannot read the token file: ENOENT/);
});
