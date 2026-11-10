/**
 * The GitHub forge's land step: merges the latest pull request about the subject, only while its
 * head is still the subject's SHA, which GitHub checks. A subject behind the base branch, missing
 * commits it has, is not merged: the step claims behind, so the workflow can rebase, test and try
 * again. A refused merge, such as a moved head, a conflict or failing required checks, fails the
 * step, saying why, so the commission escalates. It reaches GitHub only through the broker.
 *
 * lazy: landings are kept in order by retrying, not by the engine holding the base for one
 * commission; two checks at once may both pass unless GitHub requires branches up to date. Hold
 * it in the engine once commissions keep spending their budgets losing the race.
 *
 * Usage: land.ts <base> <merge|squash|rebase>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// SAFETY: the land step's run passes the base branch and the merge method.
const [base, method] = process.argv.slice(2) as [string, string];
const input = process.env.MEDRENGARD_IN!;
const broker = process.env.MEDRENGARD_BROKER_GITHUB!;

type Listed = { fields: Record<string, string> };

// SAFETY: the engine writes input.json, and the step declares the inputs pullRequest and subject.
const { inputs } = JSON.parse(readFileSync(join(input, "input.json"), "utf8")) as {
  inputs: { pullRequest: Listed[]; subject: [Listed] };
};

const pullRequest = inputs.pullRequest.at(-1);

if (pullRequest === undefined) {
  console.error("No pull request about the subject was opened, so there is none to land.");
  process.exit(1);
}

const { repository, number, url } = pullRequest.fields;
const sha = inputs.subject[0].fields.sha;
const out = process.env.MEDRENGARD_OUT!;
const headers = { authorization: "Bearer medrengard-broker" };

const compared = await fetch(`${broker}/api/repos/${repository}/compare/${base}...${sha}`, {
  headers,
});

if (!compared.ok) {
  console.error(
    `GitHub refused to compare ${sha} with ${base} (${compared.status}): ${await compared.text()}`,
  );
  process.exit(1);
}

// SAFETY: GitHub documents behind_by on a comparison.
const { behind_by: behind } = (await compared.json()) as { behind_by: number };

if (behind > 0) {
  writeFileSync(join(out, "output.json"), JSON.stringify({ outcome: "behind" }));
  process.exit(0);
}

const response = await fetch(`${broker}/api/repos/${repository}/pulls/${number}/merge`, {
  method: "PUT",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({ sha, merge_method: method }),
});

if (!response.ok) {
  console.error(`GitHub refused to merge ${url} (${response.status}): ${await response.text()}`);
  process.exit(1);
}

writeFileSync(join(out, "output.json"), JSON.stringify({ outcome: "done" }));
