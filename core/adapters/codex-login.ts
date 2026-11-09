/**
 * Codex's ChatGPT login, as the Codex adapter and its broker use it: the fake one Codex runs on in
 * the sandbox, and the real one the broker holds and refreshes. auth.json and its token refresh
 * are Codex's own, as 0.167.0 reads and makes them.
 */
import {
  existsSync,
  openSync,
  closeSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { placeholder } from "./broker.ts";

/** The ChatGPT account the fake login names; the broker answers routing discovery for it. */
export const fakeAccount = "medrengard-account";

/** The Codex version the adapter and broker are written for; any other is refused. */
export const pinnedVersion = "0.167.0";

// Whether a value read from JSON is text. The adapters directory is all a step's access grants of
// Medrengard, so nothing here is imported from the engine's source.
const isText = (value: string | undefined): value is string => value === String(value);

// A part of a token: its header, its claims or its signature, as JSON.
type Part = Readonly<Record<string, string | number | boolean | Readonly<Record<string, string>>>>;

const encoded = (part: Part) => Buffer.from(JSON.stringify(part)).toString("base64url");

/**
 * The auth.json of a ChatGPT login that holds no credential: its identity token unsigned, naming
 * the fake account, and the placeholder as its access and refresh tokens, which the broker
 * replaces. It never expires, so Codex never tries to refresh it.
 */
export function fakeLogin(): string {
  const claims = {
    email: "medrengard@localhost",
    exp: 4_102_444_800,
    "https://api.openai.com/auth": {
      chatgpt_plan_type: "pro",
      chatgpt_account_id: fakeAccount,
      chatgpt_user_id: "medrengard",
      user_id: "medrengard",
    },
  };

  return JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      // Unsigned: Codex reads its claims, and nothing checks a signature.
      id_token: `${encoded({ alg: "none", typ: "JWT" })}.${encoded(claims)}.${encoded({ unsigned: true })}`,
      access_token: placeholder,
      refresh_token: placeholder,
      account_id: fakeAccount,
    },
    last_refresh: new Date().toISOString(),
  });
}

/** The real login's credential: its access token, refresh token and account. */
export type Login = { access: string; refresh: string; account: string };

/** The login in `directory`'s auth.json, as Codex wrote it there, or why it cannot be used. */
export function readLogin(directory: string): Login | { problem: string } {
  let auth;

  try {
    auth = JSON.parse(readFileSync(join(directory, "auth.json"), "utf8"));
  } catch (error) {
    return {
      problem: `Cannot read the Codex login: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }

  const access = auth?.tokens?.access_token;
  const refresh = auth?.tokens?.refresh_token;
  const account = auth?.tokens?.account_id;

  if (!isText(access) || !isText(refresh) || !isText(account)) {
    return { problem: `The Codex login in ${directory} is not a ChatGPT login.` };
  }

  return { access, refresh, account };
}

// The login in `directory`, or an error saying why it cannot be used.
function loginIn(directory: string): Login {
  const read = readLogin(directory);

  if ("problem" in read) {
    throw new Error(read.problem);
  }

  return read;
}

/** When the access token `token` expires, in seconds since the epoch, or 0 when it does not say. */
export function expiry(token: string): number {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());

    return Number.isFinite(claims?.exp) ? Number(claims.exp) : 0;
  } catch {
    return 0;
  }
}

// Codex's public OAuth client, which refreshes its ChatGPT logins.
const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";

// How long a broker waits for another to finish refreshing, and when a lock is taken as abandoned,
// in milliseconds.
const lockWait = 30_000;
const lockAbandoned = 60_000;

/**
 * The login in `directory` made fresh: refreshed at `auth` unless another broker already has,
 * under a lock, so one login serves every broker on the machine one refresh at a time. Its file is
 * replaced whole, as Codex would.
 */
export async function refreshLogin(directory: string, held: Login, auth: URL): Promise<Login> {
  const lock = join(directory, "medrengard-refresh.lock");
  const deadline = Date.now() + lockWait;

  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));

      break;
    } catch {
      if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > lockAbandoned) {
        rmSync(lock, { force: true });
      } else if (Date.now() > deadline) {
        throw new Error(`Another broker held ${lock} for over ${lockWait / 1000} s.`);
      }

      await sleep(100);
    }
  }

  try {
    const current = loginIn(directory);

    // Another broker refreshed it while this one waited.
    if (current.access !== held.access) {
      return current;
    }

    const response = await fetch(new URL("/oauth/token", auth), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: current.refresh,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `The Codex login could not be refreshed (${response.status}): log in again with CODEX_HOME=${directory} codex login.`,
      );
    }

    const tokens = await response.json();
    const file = join(directory, "auth.json");

    // The new tokens over the old, and the rest of Codex's file as it was.
    const login = JSON.parse(readFileSync(file, "utf8"));

    for (const name of ["id_token", "access_token", "refresh_token"]) {
      if (isText(tokens?.[name])) {
        login.tokens[name] = tokens[name];
      }
    }

    login.last_refresh = new Date().toISOString();

    writeFileSync(`${file}.medrengard`, JSON.stringify(login, null, 2), { mode: 0o600 });
    renameSync(`${file}.medrengard`, file);

    return loginIn(directory);
  } finally {
    rmSync(lock, { force: true });
  }
}
