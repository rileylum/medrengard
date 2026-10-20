// Ticket 10-c: what a command stage's command is told about its run (A-074, A-081). The controller
// writes it to request.json in the stage's evidence directory and names that file in SF_REQUEST.
// A file argument runs as one file with nothing beside it, so it copies readRequest rather than
// importing this module; a command in the repository can import it by path.
import { readFileSync } from 'node:fs';

export interface CommandRequest {
  cycleId: string;
  workId: string;
  /** The command stage's name in the workflow. */
  stage: string;
  head: string;
  base: string;
  ticket: string;
  /** `git diff --text <base> <head>`, uncut: the checkout has no .git. */
  diffFile: string;
  /** Empty at the start; with the checkout, the only path the command can write. */
  outputDir: string;
}

const FIELDS = ['cycleId', 'workId', 'stage', 'head', 'base', 'ticket', 'diffFile', 'outputDir'] as const;

/** The request for this run. Throws, naming the field, on a file that is not a whole request. */
export function readRequest(file = process.env.SF_REQUEST): CommandRequest {
  if (!file) throw new Error('SF_REQUEST is not set: run this as a command stage');
  const r = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  for (const k of FIELDS) if (typeof r?.[k] !== 'string' || r[k] === '') throw new Error(`${file}: ${k} is not a non-empty string`);
  return r as unknown as CommandRequest;
}
