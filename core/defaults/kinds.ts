// The built-in artifact kinds, as values: pass them as they are, change one, or add your own
// beside them. The engine knows none of them; a commission records the kinds it started with.
import { join } from "node:path";
import type { Kinds } from "../src/kinds.ts";
import type { Access } from "../src/definition.ts";
import { contract } from "./access.ts";

const repository = join(import.meta.dirname, "..");

// The step contract and the system, with the Node executable, which may be under the owner's home,
// and the programs below to run. Never Node's whole installation, which could be the home itself.
const programs: Access & { network: boolean } = {
  ...contract,
  paths: [
    ...contract.paths,
    { path: process.execPath, mode: "read" },
    { path: join(repository, "verifiers"), mode: "read" },
    { path: join(repository, "materialisers"), mode: "read" },
  ],
};

// A verifier judges the workspace and must not change it; a materialiser builds it.
const program = (path: string, workspace: Access["workspace"]) => ({
  run: [process.execPath, join(repository, path)] as const,
  access: { ...programs, workspace },
  limits: { attempt: 60, memory: 4 * 1024 * 1024 * 1024, processes: 1024 },
});

// A program as a verifier, which may keep files of `kept` bytes in all.
const verifying = (judging: ReturnType<typeof program>, kept: number) => ({
  ...judging,
  limits: { ...judging.limits, kept },
});

const mebibyte = 1024 * 1024;

/** Document, commit and verdict. */
export const builtIn = {
  document: {
    role: "subject",
    description: "A document, such as a plan, which becomes what the workflow is about.",
    fields: { title: { limit: 200, required: true } },
    body: { required: true, limit: mebibyte },
    materialiser: program("materialisers/document.ts", "write"),
  },
  commit: {
    role: "subject",
    description:
      "A commit you made in your working directory, named by the full SHA of HEAD, which becomes what the workflow is about. Its optional body is your report on it.",
    // A SHA-256 SHA is 64 hex digits. The verifier refuses anything that is not HEAD.
    fields: { sha: { limit: 64, required: true } },
    body: { required: false, limit: mebibyte },
    // The bundle holds the commit's whole history.
    verifier: verifying(program("verifiers/commit.ts", "read"), 1024 * mebibyte),
    materialiser: { ...program("materialisers/commit.ts", "write"), branches: true },
  },
  verdict: {
    role: "judgement",
    description:
      "Your verdict on what the workflow is about. Its optional summary is one line, and its optional body your findings.",
    fields: {
      verdict: { limit: 4, required: true, values: ["pass", "fail"] },
      summary: { limit: 200 },
    },
    body: { required: false, limit: mebibyte },
    outcome: "verdict",
  },
} satisfies Kinds;
