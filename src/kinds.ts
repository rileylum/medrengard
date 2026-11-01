import { join } from "node:path";

/**
 * An artifact kind, as data: whether it is a subject or a judgement; its fields, each text of at
 * most `limit` bytes, optionally required or one of `values`; whether its UTF-8 body is required,
 * and its size; the field, if any, that must equal the outcome claimed with it; a one-line
 * `description` that tells a step what it is and how to claim it; and the programs that verify a
 * claim of it and build a workspace from it.
 */
export type Kind = {
  role: "subject" | "judgement";
  description: string;
  fields: Readonly<Record<string, { limit: number; required?: true; values?: readonly string[] }>>;
  body: { required: boolean; limit: number };
  outcome?: string;
  verifier?: readonly [string, ...string[]];
  materialiser?: readonly [string, ...string[]];
};

// lazy: the built-in verifier and materialisers are found beside the engine. Name them by hash
// once a factory can define kinds.
const builtIn = (path: string) =>
  [process.execPath, join(import.meta.dirname, "..", path)] as const;

const mebibyte = 1024 * 1024;

/**
 * The kinds a step may claim. A decision is not one: only the owner makes a decision, and the
 * engine writes it.
 */
// lazy: built in, until a factory can define kinds and a commission records them by hash.
export const kinds = new Map<string, Kind>([
  [
    "document",
    {
      role: "subject",
      description: "A document, such as a plan, which becomes what the workflow is about.",
      fields: { title: { limit: 200, required: true } },
      body: { required: true, limit: mebibyte },
      materialiser: builtIn("materialisers/document.ts"),
    },
  ],
  [
    "commit",
    {
      role: "subject",
      description:
        "A commit you made in your working directory, named by the full SHA of HEAD, which becomes what the workflow is about. Its optional body is your report on it.",
      // A SHA-256 SHA is 64 hex digits. The verifier refuses anything that is not HEAD.
      fields: { sha: { limit: 64, required: true } },
      body: { required: false, limit: mebibyte },
      verifier: builtIn("verifiers/commit.ts"),
      materialiser: builtIn("materialisers/commit.ts"),
    },
  ],
  [
    "verdict",
    {
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
  ],
]);
