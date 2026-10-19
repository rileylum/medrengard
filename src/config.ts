// Ticket 10-b: a job's settings, from four layers (A-074, A-078). Every command in main.ts reads
// its job through loadConfig, so the limits on each layer are enforced here and nowhere else.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Job } from './developer.ts';
import { checkWorkflow, defaultWorkflow, type Workflow } from './lifecycle.ts';
import { runtimes, type RuntimeEntry } from './runtime/registry.ts';
import type { Sandbox } from './sandbox.ts';

export interface JobFile extends Omit<Job, 'ticket'> {
  ticket?: string;
  /** Read instead of `ticket`, relative to the job file. */
  ticketFile?: string;
  /** A runtime name per role; `standard` and `adversarial` name the default reviewers (ROLE_ALIASES). */
  runtime: Record<string, string>;
  /** Extension runtimes by name, each a TypeScript module relative to the job file. */
  runtimes?: Record<string, { module: string }>;
  /** A TypeScript module with a named export `workflow`, relative to the job file. Default defaultWorkflow. */
  workflow?: string;
  runsDir?: string;
  /** Per stage. Default 120000. */
  deadlineMs?: number;
  /** Where checks, the developer and the reviewers run. Default bwrap; `none` must be written out. `read` is relative to the job file. */
  sandbox?: Sandbox;
}

export interface Config {
  /** The job file, absolute. */
  path: string;
  spec: JobFile;
  repo: string;
  runsDir: string;
  workflow: Workflow;
  registry: Record<string, RuntimeEntry>;
  sandbox: Sandbox;
}

const DEFAULT_RUNS_DIR = '/var/tmp/software_factory/runs';

export async function loadConfig(jobFile: string): Promise<Config> {
  const path = resolve(jobFile);
  const spec = JSON.parse(readFileSync(path, 'utf8')) as JobFile;
  const sandbox: Sandbox = spec.sandbox
    ? { ...spec.sandbox, read: spec.sandbox.read?.map((p) => (typeof p === 'string' ? resolve(path, '..', p) : p)) }
    : { backend: 'bwrap' };
  return {
    path,
    spec,
    repo: resolve(path, '..', spec.repo),
    runsDir: resolve(spec.runsDir ?? DEFAULT_RUNS_DIR),
    workflow: await loadWorkflow(path, spec),
    registry: runtimes(spec.runtimes, resolve(path, '..')),
    sandbox,
  };
}

// Checked here, though the store checks it too: the adapters are built from it before the store opens.
async function loadWorkflow(jobPath: string, spec: JobFile): Promise<Workflow> {
  if (spec.workflow === undefined) return defaultWorkflow;
  const file = resolve(jobPath, '..', spec.workflow);
  const mod = (await import(pathToFileURL(file).href)) as { workflow?: Workflow };
  if (mod.workflow === undefined) throw new Error(`${file} has no named export workflow`);
  const refused = checkWorkflow(mod.workflow);
  if (refused.length > 0) throw new Error(`workflow refused: ${refused.join('; ')}`);
  return mod.workflow;
}
