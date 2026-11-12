/**
 * The GitHub forge's broker: forwards a step's Git fetches, its pushes to branches under
 * medrengard/, and its calls to open, read, follow, compare and merge a pull request and to read
 * the open issues, for one repository, with Medrengard's token, which only it reads, in place of
 * the placeholder. Started with --issues, it also forwards the filing of an issue: a title, a
 * body and no label but those the option lists. Anything else is refused, naming it, so a step
 * can do no more than land its change and, where its broker is started for it, file an issue,
 * whatever the token allows.
 *
 * Usage: broker.ts --repository <owner/name> [--token <file>] [--git <url>] [--api <url>]
 *   [--issues <label>,<label>...]
 *
 * The step reaches Git under /git/<owner>/<name>.git and the API under /api. --token is the file
 * holding the token, ~/.config/medrengard/github-token unless given; --git and --api, where they
 * go, https://github.com and https://api.github.com unless given. --issues lists the labels an
 * issue the step files may carry, separated by commas, or none, as "": without it no issue is
 * filed. A factory that takes a labelled issue up as new work starts a step's broker with that
 * label only where the step may commission.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { refuse, serve } from "../../adapters/broker.ts";
import { isRecord, isText } from "../../src/json.ts";

const usage =
  "Usage: broker.ts --repository <owner/name> [--token <file>] [--git <url>] [--api <url>] [--issues <label>,<label>...]";

let options;

try {
  ({ values: options } = parseArgs({
    options: {
      repository: { type: "string" },
      token: { type: "string", default: join(homedir(), ".config", "medrengard", "github-token") },
      git: { type: "string", default: "https://github.com" },
      api: { type: "string", default: "https://api.github.com" },
      issues: { type: "string" },
    },
  }));
} catch (error) {
  refuse(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
}

const { repository } = options;

if (repository === undefined || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
  refuse(`The broker needs the repository it serves, as owner/name.\n${usage}`);
}

// Whether the step may file an issue, and the labels one may carry.
const files = options.issues !== undefined;

const labels =
  options.issues === undefined || options.issues === "" ? [] : options.issues.split(",");

if (!labels.every((label) => /^[\w .-]{1,50}$/.test(label))) {
  refuse(
    `The broker files issues with the labels --issues lists, separated by commas, each at most 50 letters, digits, spaces, "_", "." and "-".\n${usage}`,
  );
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
// already tracked. Nothing here reads a closed issue or writes one: filing one is forwarded apart,
// below, where the broker is started for it, and nothing edits, closes, comments on or labels an
// issue there is.
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

// The most an issue may be, as JSON. An issue is judged whole, since a label may come anywhere
// in it, so the broker holds all of it in memory before it forwards any: lazy: 256 KiB, four
// times GitHub's own limit on an issue's body in characters, until a step files a longer one.
const issueLimit = 256 * 1024;

// Judges an issue a step files, once all of it has arrived: a title, a body and at most the
// labels the broker was started with, and no other key, since an assignee, a milestone or a type
// is the owner's to give. In a factory that takes a labelled issue up as new work, a label starts
// work, so one not listed is refused. What is forwarded is the issue as read here, written
// again, never the step's own bytes, which GitHub might read another way: a key given twice.
function filed(start: Buffer, ended: boolean): { refused: string } | { body: Buffer } | "more" {
  if (start.length > issueLimit) {
    return { refused: refusedIssue("of more than 256 KiB") };
  }

  if (!ended) {
    return "more";
  }

  let issue;

  try {
    issue = JSON.parse(start.toString("utf8"));
  } catch {
    return { refused: refusedIssue("that is not JSON") };
  }

  if (!isRecord(issue)) {
    return { refused: refusedIssue("that is not a JSON object") };
  }

  const fields = new Map(Object.entries(issue));
  const other = [...fields.keys()].find((key) => !["title", "body", "labels"].includes(key));
  const title = fields.get("title");
  const body = fields.get("body");
  const given = fields.has("labels") ? fields.get("labels") : [];

  if (other !== undefined) {
    return {
      refused: refusedIssue(
        `with ${JSON.stringify(other.slice(0, 50))}, a key it does not forward`,
      ),
    };
  }

  if (!isText(title) || title === "") {
    return { refused: refusedIssue("whose title is not a string that says something") };
  }

  if (!isText(body)) {
    return { refused: refusedIssue("whose body is not a string") };
  }

  if (!Array.isArray(given) || !given.every(isText)) {
    return { refused: refusedIssue("whose labels are not a list of strings") };
  }

  const unlisted = given.find((label) => !labels.includes(label));

  if (unlisted !== undefined) {
    return {
      refused: refusedIssue(
        `with the label ${JSON.stringify(unlisted.slice(0, 50))}, which the broker was not started to allow`,
      ),
    };
  }

  return { body: Buffer.from(JSON.stringify(issue)) };
}

const refusedIssue = (what: string) => `Refused by Medrengard's GitHub broker: an issue ${what}.`;

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

  const filing = files && method === "POST" && path === `${apiPrefix}/issues`;

  if (
    filing ||
    (path.startsWith(apiPrefix) && allowed(apiRoutes, method, path.slice(apiPrefix.length)))
  ) {
    const forwarded = {
      path: `${apiBase}/repos/${repository}${path.slice(apiPrefix.length)}`,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "medrengard",
      },
    };

    return filing
      ? {
          ...forwarded,
          headers: { ...forwarded.headers, "content-type": "application/json" },
          screen: filed,
          most: issueLimit,
        }
      : forwarded;
  }

  return {
    status: 403,
    body: JSON.stringify({
      message: `Refused by Medrengard's GitHub broker: ${method} ${path} is not one it forwards for ${repository}.`,
    }),
  };
});
