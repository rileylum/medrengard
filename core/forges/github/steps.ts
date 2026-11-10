// Landing a commission's change on GitHub: the pull-request kind, and steps that open a pull
// request of the subject commit and, after the owner approves, merge it. Plain values, as the
// other defaults are: spread one and change a field.
import { join } from "node:path";
import { node } from "../../defaults/access.ts";
import type { Kind } from "../../src/kinds.ts";
import type { Access, Workflow } from "../../src/definition.ts";

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

// A command step that does not watch; the watch step adds its own watch and empty workspace.
type Command = Extract<Workflow["steps"][string], { kind: "command"; watch?: undefined }>;

// What a step built here leaves to the factory: its outcomes' edges, whose literal step names a
// workflow checks, and any field but its inputs and program, which the step needs as they are.
// Its routes, whose step names a workflow checks too, a factory adds by spreading the step.
type Overrides<O> = { on: O } & Partial<
  Omit<Command, "kind" | "run" | "inputs" | "on" | "escalate" | "watch" | "workspace">
>;

const here = import.meta.dirname;

/**
 * The open, watch, land and rebase steps for `repository`, a pull request's base being `base`. Each reaches
 * GitHub only through the broker, which forwards nothing but landing this repository's change.
 */
export function github({ repository, base, token, git, api }: Options) {
  const flags = Object.entries({ token, git, api }).flatMap(([flag, value]) =>
    value === undefined ? [] : [`--${flag}`, value],
  );

  const access: Access = {
    ...node,
    // These programs.
    paths: [...node.paths, { path: here, mode: "read" }],
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
    /**
     * Watches the latest pull request about the subject, checking every `interval` seconds, 60
     * unless given, for at most `wait`, a week unless given, until it is merged, closed, or asked
     * to change, with the review as a document.
     */
    watch: <const O extends Record<"merged" | "closed" | "changes", string>>({
      interval = 60,
      wait = 7 * 24 * 60 * 60,
      ...overrides
    }: Overrides<O> & { interval?: number; wait?: number }) => ({
      ...step([join(here, "watch.ts")]),
      watch: { interval, wait },
      workspace: "empty" as const,
      inputs: {
        pullRequest: { kind: "pull-request", about: "subject" },
        subject: "subject",
      } as const,
      claims: ["document"],
      ...overrides,
    }),
    /**
     * Merges the latest pull request about the subject while its head is the subject's SHA,
     * claiming done, or claims behind, merging nothing, if the subject lacks commits of the base.
     */
    land: <const O extends Record<"done" | "behind", string>>({
      method = "merge",
      ...overrides
    }: Overrides<O> & { method?: "merge" | "squash" | "rebase" }) => ({
      ...step([join(here, "land.ts"), base, method]),
      workspace: "empty" as const,
      inputs: {
        pullRequest: { kind: "pull-request", about: "subject" },
        subject: "subject",
      } as const,
      claims: [],
      ...overrides,
    }),
    /**
     * Rebases the subject onto the base branch, claiming done with the rebased commit, or
     * conflict with a document listing the conflicting files, leaving the subject as it was.
     */
    rebase: <const O extends Record<"done" | "conflict", string>>(overrides: Overrides<O>) => ({
      ...step([join(here, "rebase.ts"), repository, base]),
      access: {
        ...access,
        // Rebasing commits again; each keeps its author.
        values: {
          ...access.values,
          GIT_COMMITTER_NAME: "Medrengard",
          GIT_COMMITTER_EMAIL: "medrengard@localhost",
        },
      },
      workspace: "subject" as const,
      inputs: {} as const,
      claims: ["commit", "document"],
      ...overrides,
    }),
  };
}
