// Landing a commission's change on GitHub: the pull-request kind, and steps that open a pull
// request of the subject commit and, after the owner approves, merge it. Plain values, as the
// other defaults are: spread one and change a field.
import { join } from "node:path";
import { contract } from "../../defaults/access.ts";
import type { Kind } from "../../src/kinds.ts";
import type { Access, Workflow } from "../../src/replay.ts";

/**
 * The pull-request kind: a judgement about the subject commit, that it is open as pull request
 * `number` in `repository`. lazy: no verifier, since a kind's programs cannot reach a broker and
 * the land step merges only while the head is the subject's SHA. Give it one once an agent may
 * claim a pull request.
 */
export const pullRequest = {
  role: "judgement",
  description:
    "A pull request of what the workflow is about: its repository as owner/name, its number and its page.",
  fields: {
    repository: { limit: 200, required: true },
    number: { limit: 20, required: true },
    url: { limit: 2000, required: true },
  },
  body: { required: false, limit: 1 },
} satisfies Kind;

/**
 * Where the broker finds Medrengard's token and GitHub: the defaults are
 * ~/.config/medrengard/github-token, https://github.com and https://api.github.com.
 */
export type Options = {
  repository: string;
  base: string;
  token?: string;
  git?: string;
  api?: string;
};

type Command = Extract<Workflow["steps"][string], { kind: "command" }>;

// What a step built here leaves to the factory: its outcomes' edges, whose literal step names a
// workflow checks, and any field but its inputs and program, which the step needs as they are.
type Overrides<O> = { on: O } & Partial<Omit<Command, "kind" | "run" | "inputs" | "on">>;

const here = import.meta.dirname;

/**
 * The open and land steps for `repository`, a pull request's base being `base`. Each reaches
 * GitHub only through the broker, which forwards nothing but landing this repository's change.
 */
export function github({ repository, base, token, git, api }: Options) {
  const flags = Object.entries({ token, git, api }).flatMap(([flag, value]) =>
    value === undefined ? [] : [`--${flag}`, value],
  );

  const access: Access = {
    ...contract,
    paths: [
      ...contract.paths,
      // Node, which may be under the owner's home, and these programs.
      { path: process.execPath, mode: "read" },
      { path: here, mode: "read" },
    ],
    network: {
      hosts: [],
      brokers: {
        github: [process.execPath, join(here, "broker.ts"), "--repository", repository, ...flags],
      },
    },
    // Git wants a home for its configuration; the step's /tmp is fresh.
    values: { HOME: "/tmp" },
  };

  const step = (run: readonly string[]) => ({
    kind: "command" as const,
    run: [process.execPath, ...run] as const,
    budget: 1,
    access,
  });

  return {
    /** Pushes the subject commit and opens a pull request of it, claiming the pull request. */
    open: <const O extends Record<string, string>>(overrides: Overrides<O>) => ({
      ...step([join(here, "open.ts"), repository, base]),
      workspace: "subject" as const,
      inputs: { request: "request", subject: "subject" } as const,
      claims: ["pull-request"],
      ...overrides,
    }),
    /** Merges the latest pull request about the subject while its head is the subject's SHA. */
    land: <const O extends Record<string, string>>({
      method = "merge",
      ...overrides
    }: Overrides<O> & { method?: "merge" | "squash" | "rebase" }) => ({
      ...step([join(here, "land.ts"), method]),
      workspace: "empty" as const,
      inputs: {
        pullRequest: { kind: "pull-request", about: "subject" },
        subject: "subject",
      } as const,
      claims: [],
      ...overrides,
    }),
  };
}
