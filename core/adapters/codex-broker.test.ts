import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const broker = join(import.meta.dirname, "codex-broker.ts");

const encoded = (value: Readonly<Record<string, string | number | boolean>>) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** An access token for a test, named `name`, which expires at `exp`. */
const tokenOf = (name: string, exp = 4_102_444_800) =>
  `${encoded({ alg: "none" })}.${encoded({ exp, name })}.${encoded({ unsigned: true })}`;

type Received = { method?: string; path?: string; authorization?: string; account?: string };

/** A server on loopback that records each request and answers with `answer`; its URL. */
async function recording(
  t: TestContext,
  received: Received[],
  answer: (path: string) => { status: number; body: string },
): Promise<string> {
  const server = createServer((incoming, response) => {
    received.push({
      method: incoming.method,
      path: incoming.url,
      authorization: incoming.headers.authorization,
      account: incoming.headers["chatgpt-account-id"]?.toString(),
    });
    incoming.resume();

    const { status, body } = answer(incoming.url!);

    response.writeHead(status, { "content-type": "application/json" });
    response.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  // SAFETY: a TCP server listening on a port has an address of that kind.
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * Starts the Codex broker on a login whose access token is `access`, forwarding to a backend that
 * answers with `backend`, refreshing at an auth server that gives `refreshed` tokens. Returns its
 * socket, the login's directory, and what the backend and auth server received.
 */
async function brokered(
  t: TestContext,
  access = tokenOf("first"),
  backend: (path: string) => { status: number; body: string } = () => ({
    status: 200,
    body: "answered",
  }),
) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  await writeFile(
    join(directory, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: access, refresh_token: "refresh-first", account_id: "account" },
    }),
  );

  const received: Received[] = [];
  const refreshes: Received[] = [];
  const upstream = await recording(t, received, backend);

  const auth = await recording(t, refreshes, () => ({
    status: 200,
    body: JSON.stringify({ access_token: tokenOf("second"), refresh_token: "refresh-second" }),
  }));

  const socket = join(directory, "socket");

  const running = spawn(
    process.execPath,
    [broker, "--login", directory, "--upstream", upstream, "--auth", auth],
    { env: { ...process.env, MEDRENGARD_SOCKET: socket }, stdio: "ignore" },
  );

  t.after(() => running.kill());
  await listening(running, socket);

  return { socket, directory, received, refreshes };
}

// Waits until something listens on `socket`, as the engine does.
async function listening(running: ChildProcess, socket: string): Promise<void> {
  for (let tries = 0; tries < 250; tries += 1) {
    if (running.exitCode !== null) {
      throw new Error(`The broker exited with ${running.exitCode}.`);
    }

    try {
      await send(socket, "GET", "/", {});

      return;
    } catch {
      await sleep(20);
    }
  }

  throw new Error("The broker did not listen.");
}

/** Sends a request to the broker at `socket`; its status and body. */
async function send(
  socket: string,
  method: string,
  path: string,
  headers: Record<string, string> = { authorization: "Bearer medrengard-broker" },
): Promise<{ status: number; body: string }> {
  const sent = request({ socketPath: socket, path, method, headers });

  sent.end();

  const [response] = await once(sent, "response");
  let text = "";

  for await (const chunk of response) {
    text += chunk.toString();
  }

  return { status: response.statusCode, body: text };
}

test("the Codex broker forwards a model request to the subscription backend with the login's credential", async (t) => {
  const { socket, received } = await brokered(t);

  assert.deepEqual(await send(socket, "GET", "/v1/models?client_version=0.167.0"), {
    status: 200,
    body: "answered",
  });
  assert.deepEqual(received.at(-1), {
    method: "GET",
    path: "/backend-api/codex/models?client_version=0.167.0",
    authorization: `Bearer ${tokenOf("first")}`,
    account: "account",
  });
});

test("the Codex broker answers routing discovery for the fake login's account, and finds nothing else", async (t) => {
  const { socket, received } = await brokered(t);

  const routing = await send(socket, "GET", "/backend-api/wham/accounts/check");

  assert.equal(routing.status, 200);
  assert.partialDeepStrictEqual(JSON.parse(routing.body), {
    accounts: [{ id: "medrengard-account", account_routing_override: "NO_CONSTRAINT" }],
  });
  assert.equal(
    (await send(socket, "POST", "/backend-api/codex/analytics-events/events")).status,
    404,
  );
  assert.deepEqual(received, []);
});

test("the Codex broker holds a request for a response until the adapter starts the session", async (t) => {
  const { socket, received } = await brokered(t);

  const responding = send(socket, "POST", "/v1/responses");

  await sleep(300);
  assert.equal(received.length, 0);

  assert.equal((await send(socket, "POST", "/medrengard/start")).status, 204);
  assert.deepEqual(await responding, { status: 200, body: "answered" });
  assert.equal(received.at(-1)?.path, "/backend-api/codex/responses");
});

test("the Codex broker refuses a request without the placeholder, forwarding nothing", async (t) => {
  const { socket, received } = await brokered(t);

  const refused = await send(socket, "GET", "/v1/models", {
    authorization: `Bearer ${tokenOf("someone-elses")}`,
  });

  assert.equal(refused.status, 401);
  assert.deepEqual(received, []);
});

test("the Codex broker refreshes a login the backend refused, never passing the 401 on", async (t) => {
  let refusing = true;

  const { socket, directory, received, refreshes } = await brokered(t, tokenOf("first"), () => {
    const status = refusing ? 401 : 200;

    refusing = false;

    return { status, body: "{}" };
  });

  // Codex refreshes its own login on a 401; it holds none, so it sees 403.
  assert.equal((await send(socket, "GET", "/v1/models")).status, 403);
  assert.equal((await send(socket, "GET", "/v1/models")).status, 200);

  assert.partialDeepStrictEqual(refreshes, [{ method: "POST", path: "/oauth/token" }]);
  assert.equal(received.at(-1)?.authorization, `Bearer ${tokenOf("second")}`);

  const written = JSON.parse(await readFile(join(directory, "auth.json"), "utf8"));

  assert.equal(written.tokens.access_token, tokenOf("second"));
  assert.equal(written.tokens.refresh_token, "refresh-second");
  assert.equal(written.tokens.account_id, "account");
});

test("the Codex broker refreshes a login about to expire before forwarding with it", async (t) => {
  const soon = Math.floor(Date.now() / 1000) + 60;
  const { socket, received, refreshes } = await brokered(t, tokenOf("first", soon));

  assert.equal((await send(socket, "GET", "/v1/models")).status, 200);
  assert.equal(refreshes.length, 1);
  assert.equal(received.at(-1)?.authorization, `Bearer ${tokenOf("second")}`);
});

test("the Codex broker takes up a login another broker refreshed, rather than refresh it again", async (t) => {
  const soon = Math.floor(Date.now() / 1000) + 60;
  const { socket, directory, received, refreshes } = await brokered(t, tokenOf("first", soon));

  // As another broker on the machine would leave it.
  await writeFile(
    join(directory, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: tokenOf("other"),
        refresh_token: "refresh-other",
        account_id: "account",
      },
    }),
  );

  assert.equal((await send(socket, "GET", "/v1/models")).status, 200);
  assert.deepEqual(refreshes, []);
  assert.equal(received.at(-1)?.authorization, `Bearer ${tokenOf("other")}`);
});

test("the Codex broker cannot start without a ChatGPT login, and says why", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const running = spawn(process.execPath, [broker, "--login", directory], {
    env: { ...process.env, MEDRENGARD_SOCKET: join(directory, "socket") },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let said = "";

  running.stderr.on("data", (chunk: Buffer) => {
    said += chunk.toString();
  });

  const [code] = await once(running, "close");

  assert.equal(code, 2);
  assert.match(said, /^Cannot read the Codex login: ENOENT/);
});
