// Prototype (A-046): reads a job file the way src/main.ts does, so the board and the runner agree
// on the store a job writes to. main.ts keeps its own copy; this one is thrown away with proto/.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Job } from '../src/developer.ts';
import type { Sandbox } from '../src/sandbox.ts';

export interface JobFile extends Omit<Job, 'ticket'> {
  ticket?: string;
  ticketFile?: string;
  runsDir?: string;
  deadlineMs?: number;
  sandbox?: Sandbox;
  /** Passed to claude as --model; default the owner's. */
  model?: string;
}

export interface LoadedJob {
  path: string;
  spec: JobFile;
  job: Job;
  runsDir: string;
  db: string;
  sandbox: Sandbox;
}

export function loadJob(file: string): LoadedJob {
  const path = resolve(file);
  const spec = JSON.parse(readFileSync(path, 'utf8')) as JobFile;
  const rel = (p: string) => resolve(path, '..', p);
  const ticket = spec.ticket ?? (spec.ticketFile && existsSync(rel(spec.ticketFile)) ? readFileSync(rel(spec.ticketFile), 'utf8') : '');
  const job: Job = { workId: spec.workId, ticket, repo: rel(spec.repo), base: spec.base, parentCycleId: spec.parentCycleId, checks: spec.checks };
  const runsDir = resolve(spec.runsDir ?? '/var/tmp/software_factory/runs');
  const sandbox: Sandbox = spec.sandbox
    ? { ...spec.sandbox, read: spec.sandbox.read?.map((p) => (typeof p === 'string' ? rel(p) : p)) }
    : { backend: 'bwrap' };
  return { path, spec, job, runsDir, db: join(runsDir, 'events.sqlite'), sandbox };
}
