/**
 * The GitHub forge's broker: forwards a step's Git fetches, its pushes to branches under
 * medrengard/, and its calls to open, read, follow, compare and merge a pull request, for one
 * repository, with Medrengard's token, which only it reads, in place of the placeholder. Anything
 * else is refused, naming it, so a step can do no more than land its change, whatever the token
 * allows.
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
// comments, comparing a commit with a branch, whose name has no "..", and merging one; and
// reading the repository's open issues, a page of a hundred at a time, so a step can know what is
// already tracked. Nothing here writes an issue or reads a closed one.
const apiRoutes = [
  ["POST", /^\/pulls$/],
  ["GET", /^\/issues\?state=open&per_page=100&page=\d{1,3}$/],
  ["GET", /^\/compare\/[\w-]+(?:[./][\w-]+)*\.\.\.[0-9a-f]{40,64}$/],
  ["GET", /^\/pulls\?head=[\w.-]+:[\w./-]+&state=open$/],
  ["GET", /^\/pulls\/\d+$/],
  ["GET", /^\/pulls\/\d+\/(reviews|comments)$/],
  ["PUT", /^\/pulls\/\d+\/merge$/],
] as const;

// Judges a push by the refs it updates, which start its body as lines, each its length in four
// hex digits and then `<old> <new> <ref>`, the first with capabilities after a NUL, ended by a
// flush, 0000. Only branches under medrengard/, a commission's own, may be pushed: never the base
// a pull request lands on, which only a merge the owner approved changes.
function pushed(start: Buffer): { refused: string } | "forward" | "more" {
  for (let at = 0; ;) {
    if (start.length < at + 4) {
      return "more";
    }

    const length = Number.parseInt(start.subarray(at, at + 4).toString("latin1"), 16);

    // The flush: every command was a branch of its own.
    if (length === 0) {
      return "forward";
    }

    if (!(length >= 4)) {
      return { refused: refusedPush("its body, which is no list of refs") };
    }

    if (start.length < at + length) {
      return "more";
    }

    const [line = ""] = start
      .subarray(at + 4, at + length)
      .toString("utf8")
      .split("\0");

    const [, , ref = ""] = line.trimEnd().split(" ");

    // A shallow line states no ref to update.
    if (!line.startsWith("shallow ") && !/^refs\/heads\/medrengard\/[\w./-]+$/.test(ref)) {
      return { refused: refusedPush(`${ref}, which is not a branch under medrengard/`) };
    }

    at += length;
  }
}

const refusedPush = (what: string) => `Refused by Medrengard's GitHub broker: a push to ${what}.`;

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
    const forwarded = {
      path: `/${repository}.git${path.slice(gitPrefix.length)}`,
      upstream: git,
      headers: {
        authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
      },
    };

    return path === `${gitPrefix}/git-receive-pack` ? { ...forwarded, screen: pushed } : forwarded;
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
