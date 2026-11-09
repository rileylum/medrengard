/**
 * The Codex adapter's broker: forwards Codex's model requests to the ChatGPT subscription backend
 * with Medrengard's own Codex login, which only it reads, in place of the fake login Codex runs on.
 *
 * Usage: codex-broker.ts [--login <directory>] [--upstream <url>] [--auth <url>]
 *
 * --login is the Codex home holding the login, ~/.config/medrengard/codex unless given; make it
 * once with `CODEX_HOME=~/.config/medrengard/codex codex login`. --upstream is where requests go,
 * https://chatgpt.com unless given, and --auth where the login is refreshed,
 * https://auth.openai.com unless given.
 *
 * Model requests, to /v1/, go to the backend's /backend-api/codex/. Routing discovery is answered
 * here, for the fake login's account; anything else Codex asks of the backend is not found. The
 * first request for a response waits until the adapter, having checked what Codex loaded, starts
 * the session at /medrengard/start: nothing reaches the model from a Codex that loaded more.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { refuse, serve, type Route } from "./broker.ts";
import { expiry, fakeAccount, readLogin, refreshLogin, type Login } from "./codex-login.ts";

const usage = "Usage: codex-broker.ts [--login <directory>] [--upstream <url>] [--auth <url>]";

let options;

try {
  ({ values: options } = parseArgs({
    options: {
      login: { type: "string", default: join(homedir(), ".config", "medrengard", "codex") },
      upstream: { type: "string", default: "https://chatgpt.com" },
      auth: { type: "string", default: "https://auth.openai.com" },
    },
  }));
} catch (error) {
  refuse(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
}

const directory = resolve(options.login);
const auth = new URL(options.auth);
const read = readLogin(directory);

if ("problem" in read) {
  refuse(read.problem);
}

let login: Login = read;

// Whether the backend refused the access token, so it is refreshed before the next request.
let refused = false;

// Refreshed when it expires within five minutes, as Codex would, or once the backend refused it.
async function fresh(): Promise<Login> {
  const expires = expiry(login.access);

  if (refused || (expires > 0 && expires - Date.now() / 1000 < 300)) {
    login = await refreshLogin(directory, login, auth);
    refused = false;
  }

  return login;
}

// The session's start, which the adapter gives once it has checked what Codex loaded.
let start: () => void;

const started = new Promise<void>((resolve) => {
  start = resolve;
});

// How long the first request for a response waits for the session to start, in milliseconds.
const startWait = 60_000;

const routing = JSON.stringify({
  accounts: [
    {
      id: fakeAccount,
      workspace_backend_origin: "https://chatgpt.com",
      account_routing_override: "NO_CONSTRAINT",
    },
  ],
});

const notFound: Route = { status: 404, body: "{}" };

serve(new URL(options.upstream), async (method, path): Promise<Route> => {
  if (method === "POST" && path === "/medrengard/start") {
    start();

    return { status: 204, body: "" };
  }

  if (path.startsWith("/backend-api/wham/accounts/check")) {
    return { status: 200, body: routing };
  }

  if (!path.startsWith("/v1/")) {
    return notFound;
  }

  if (path.startsWith("/v1/responses")) {
    const waited = await Promise.race([
      started.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), startWait).unref()),
    ]);

    if (!waited) {
      return {
        status: 503,
        body: JSON.stringify({
          error: { message: "The Codex adapter never started the session." },
        }),
      };
    }
  }

  const { access, account } = await fresh();

  return {
    path: `/backend-api/codex/${path.slice("/v1/".length)}`,
    headers: { authorization: `Bearer ${access}`, "chatgpt-account-id": account },
    unauthorised: () => {
      refused = true;
    },
  };
});
