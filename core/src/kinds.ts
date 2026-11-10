import type { Access } from "./definition.ts";

/**
 * A program a kind runs, such as its verifier: `run` in its own sandbox under `access`, the
 * workspace in the mode `access` gives, stopped after `limit` seconds or once its processes use
 * more than `memory` bytes, and unable to run more than `processes` processes and threads at once.
 */
export type Program = {
  run: readonly [string, ...string[]];
  access: Access;
  limit: number;
  memory: number;
  processes: number;
};

/**
 * An artifact kind, as data: whether it is a subject or a judgement; its fields, each text of at
 * most `limit` bytes, optionally required or one of `values`; whether its UTF-8 body is required,
 * and its size; the field, if any, that must equal the outcome claimed with it; a one-line
 * `description` that tells a step what it is and how to claim it; and the programs that verify a
 * claim of it, keeping files of at most `kept` bytes in all, and build a workspace from it, which
 * with `branches` can also add other artifacts of the kind to the workspace as branches.
 */
export type Kind = {
  role: "subject" | "judgement";
  description: string;
  fields: Readonly<Record<string, { limit: number; required?: true; values?: readonly string[] }>>;
  body: { required: boolean; limit: number };
  outcome?: string;
  verifier?: Program & { kept: number };
  materialiser?: Program & { branches?: true };
};

/**
 * The kinds a factory defines, by name. `document` must be one, since the owner's request is a
 * document; `decision` cannot, since only the owner makes a decision and the engine writes it.
 */
export type Kinds = Readonly<Record<string, Kind>>;
