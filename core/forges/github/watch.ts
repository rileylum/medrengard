/**
 * The GitHub forge's watch check: reads the latest pull request about the subject and claims what
 * has happened to it, in this order: merged; closed unmerged; changes requested on the subject
 * commit, with its reviews and their comments as a document. Finding none, it exits without a
 * claim, so the wait goes on. It reaches GitHub only through the broker. lazy: it reads no CI,
 * which the factory runs in its own steps; read check runs once a factory relies on GitHub's.
 *
 * Usage: watch.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const input = process.env.MEDRENGARD_IN!;
const output = process.env.MEDRENGARD_OUT!;
const broker = process.env.MEDRENGARD_BROKER_GITHUB!;

type Listed = { fields: Record<string, string> };

// SAFETY: the engine writes input.json, and the step declares the inputs pullRequest and subject.
const { inputs } = JSON.parse(readFileSync(join(input, "input.json"), "utf8")) as {
  inputs: { pullRequest: Listed[]; subject: [Listed] };
};

const pullRequest = inputs.pullRequest.at(-1);

if (pullRequest === undefined) {
  console.error("No pull request about the subject was opened, so there is none to watch.");
  process.exit(1);
}

const { repository, number } = pullRequest.fields;
const sha = inputs.subject[0].fields.sha;

/** GitHub's answer to GET `path` under the pull request's repository, as JSON. */
async function read<T>(path: string): Promise<T> {
  const response = await fetch(`${broker}/api/repos/${repository}${path}`, {
    headers: { authorization: "Bearer medrengard-broker" },
  });

  const said = await response.text();

  if (!response.ok) {
    console.error(`GitHub refused GET ${path} (${response.status}): ${said}`);
    process.exit(1);
  }

  // SAFETY: each caller names the shape GitHub documents for its path.
  return JSON.parse(said) as T;
}

/** Claims `outcome`, with a document titled `title` whose body is `body`, if given. */
function claim(outcome: string, document?: { title: string; body: string }): never {
  if (document !== undefined) {
    writeFileSync(join(output, "found.md"), document.body);
  }

  const artifacts =
    document === undefined
      ? []
      : [{ kind: "document", fields: { title: document.title }, body: "found.md" }];

  writeFileSync(join(output, "output.json"), JSON.stringify({ outcome, artifacts }));
  process.exit(0);
}

const pull = await read<{ state: string; merged: boolean }>(`/pulls/${number}`);

if (pull.merged) {
  claim("merged");
}

if (pull.state === "closed") {
  claim("closed");
}

type Review = { user: { login: string }; state: string; body: string; commit_id: string };

// Reviews of an earlier commit are history: the subject is what is under review now.
const reviews = (await read<Review[]>(`/pulls/${number}/reviews`)).filter(
  (review) => review.commit_id === sha,
);

// Each reviewer's latest review decides whether they ask for changes.
const latest = new Map(reviews.map((review) => [review.user.login, review.state]));

if ([...latest.values()].includes("CHANGES_REQUESTED")) {
  const said = new Map([
    ["APPROVED", "approved"],
    ["CHANGES_REQUESTED", "requested changes"],
    ["COMMENTED", "commented"],
  ]);

  const comments = await read<
    { user: { login: string }; path: string; line: number; body: string }[]
  >(`/pulls/${number}/comments`);

  const lines = [
    ...reviews
      .filter((review) => review.body !== "")
      .map(
        (review) =>
          `${review.user.login} ${said.get(review.state) ?? review.state}: ${review.body}`,
      ),
    ...comments.map(
      (comment) => `${comment.user.login} on ${comment.path}:${comment.line}: ${comment.body}`,
    ),
  ];

  claim("changes", { title: `Review of pull request ${number}`, body: `${lines.join("\n\n")}\n` });
}
