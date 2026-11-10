/**
 * The GitHub forge's broker: forwards a step's Git fetches and pushes, and its calls to open, read,
 * follow and merge a pull request, for one repository, with Medrengard's token, which only it reads, in
 * place of the placeholder. Anything else is refused, naming it, so a step can do no more than
 * land its change, whatever the token allows.
 *
 * Usage: broker.ts --repository <owner/name> [--token <file>] [--git <url>] [--api <url>]
 *
 * The step reaches Git under /git/<owner>/<name>.git and the API under /api. --token is the file
 * holding the token, ~/.config/medrengard/github-token unless given; --git and --api, where they
 * go, https://github.com and https://api.github.com unless given.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { refuse, serve } from "../../adapters/broker.ts";

const usage =
  "Usage: broker.ts --repository <owner/name> [--token <file>] [--git <url>] [--api <url>]";

let options;

try {
  ({ values: options } = parseArgs({
    options: {
      repository: { type: "string" },
      token: { type: "string", default: join(homedir(), ".config", "medrengard", "github-token") },
      git: { type: "string", default: "https://github.com" },
      api: { type: "string", default: "https://api.github.com" },
    },
  }));
} catch (error) {
  refuse(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
}

const { repository } = options;

if (repository === undefined || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
  refuse(`The broker needs the repository it serves, as owner/name.\n${usage}`);
}

const tokenFile = resolve(options.token);

let token;

try {
  token = readFileSync(tokenFile, "utf8").trim();
} catch (error) {
  refuse(`Cannot read the token file: ${error instanceof Error ? error.message : String(error)}.`);
}

if (token === "") {
  refuse(`The token file ${tokenFile} is empty.`);
}

const git = new URL(options.git);
const api = new URL(options.api);

// Git's smart HTTP: discovering refs to fetch or push, then fetching or pushing.
const gitRoutes = [
  ["GET", /^\/info\/refs\?service=git-(upload|receive)-pack$/],
  ["POST", /^\/git-(upload|receive)-pack$/],
] as const;

// Opening a pull request, finding the one open for a branch, reading one, its reviews and their
// comments, and merging one.
const apiRoutes = [
  ["POST", /^\/pulls$/],
  ["GET", /^\/pulls\?head=[\w.-]+:[\w./-]+&state=open$/],
  ["GET", /^\/pulls\/\d+$/],
  ["GET", /^\/pulls\/\d+\/(reviews|comments)$/],
  ["PUT", /^\/pulls\/\d+\/merge$/],
] as const;

const allowed = (
  routes: readonly (readonly [string, RegExp])[],
  method: string,
  rest: string,
): boolean => routes.some(([verb, path]) => verb === method && path.test(rest));

// The API path under api's own, which for GitHub Enterprise Server is /api/v3.
const apiBase = api.pathname.replace(/\/$/, "");

serve(api, async (method, path) => {
  const gitPrefix = `/git/${repository}.git`;
  const apiPrefix = `/api/repos/${repository}`;

  if (path.startsWith(gitPrefix) && allowed(gitRoutes, method, path.slice(gitPrefix.length))) {
    return {
      path: `/${repository}.git${path.slice(gitPrefix.length)}`,
      upstream: git,
      headers: {
        authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
      },
    };
  }

  if (path.startsWith(apiPrefix) && allowed(apiRoutes, method, path.slice(apiPrefix.length))) {
    return {
      path: `${apiBase}/repos/${repository}${path.slice(apiPrefix.length)}`,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "medrengard",
      },
    };
  }

  return {
    status: 403,
    body: JSON.stringify({
      message: `Refused by Medrengard's GitHub broker: ${method} ${path} is not one it forwards for ${repository}.`,
    }),
  };
});
