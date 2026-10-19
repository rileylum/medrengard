// Ticket 10-b: a job's settings, from four layers (A-074, A-078). Every command in main.ts reads
// its job through loadConfig, so the limits on each layer are enforced here and nowhere else.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Job } from './developer.ts';
import { git } from './git.ts';
import { checkWorkflow, defaultWorkflow, type Workflow } from './lifecycle.ts';
import { runtimes, type RuntimeEntry } from './runtime/registry.ts';
import type { Sandbox } from './sandbox.ts';

export interface JobFile extends Omit<Job, 'ticket'> {
  ticket?: string;
  /** Read instead of `ticket`, relative to the job file. */
  ticketFile?: string;
  /** A runtime name per role; `standard` and `adversarial` name the default reviewers (ROLE_ALIASES). */
  runtime: Record<string, string>;
  /** Extension runtimes by name, each a TypeScript module relative to the file that names it. */
  runtimes?: Record<string, { module: string }>;
  /** A TypeScript module with a named export `workflow`, relative to the file that names it. Default defaultWorkflow. */
  workflow?: string;
  runsDir?: string;
  /** Per stage. Default 120000. */
  deadlineMs?: number;
  /** Where checks, the developer and the reviewers run. Default bwrap; `none` must be written out. `read` is relative to the file that sets it. */
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

// The factory-defaults layer. `none` must be written out by the owner (08-a).
const DEFAULTS = { runsDir: '/var/tmp/software_factory/runs', sandbox: { backend: 'bwrap' } };

/** Merged one level down; every other key is replaced whole, arrays included (A-078 Q3). */
const NESTED = ['runtime', 'runtimes', 'sandbox'];

function merge(layers: Record<string, unknown>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const layer of layers)
    for (const [key, value] of Object.entries(layer))
      out[key] = NESTED.includes(key) ? { ...(out[key] as object | undefined), ...(value as object) } : value;
  return out;
}

function personalFile(env: NodeJS.ProcessEnv): string {
  return join(env.XDG_CONFIG_HOME || join(env.HOME ?? '', '.config'), 'software_factory', 'config.json');
}

const under = (dir: string, p: unknown) => (typeof p === 'string' ? resolve(dir, p) : p);

/**
 * The layer's relative paths made absolute against `dir`, before the merge: once merged, a value
 * no longer knows which file set it. Non-strings pass through for the registry and the sandbox to
 * refuse with their own messages.
 */
function rooted(layer: Record<string, unknown>, dir: string, runsDir: boolean): Record<string, unknown> {
  const out = { ...layer };
  // The job file's runsDir resolves against the working directory, as before 10-b, so existing job files keep their meaning.
  if (runsDir && out.runsDir !== undefined) out.runsDir = under(dir, out.runsDir);
  if (out.workflow !== undefined) out.workflow = under(dir, out.workflow);
  const runtimes = out.runtimes as Record<string, { module?: unknown }> | undefined;
  if (runtimes && typeof runtimes === 'object')
    out.runtimes = Object.fromEntries(Object.entries(runtimes).map(([name, e]) => [name, e && typeof e === 'object' ? { ...e, module: under(dir, e.module) } : e]));
  const sandbox = out.sandbox as Sandbox | undefined;
  if (sandbox && typeof sandbox === 'object' && Array.isArray(sandbox.read)) out.sandbox = { ...sandbox, read: sandbox.read.map((p) => under(dir, p)) };
  return out;
}

/** A missing personal file is an empty layer; a missing job file is an error. */
function readLayer(file: string, keys: string[], personal: boolean): Record<string, unknown> {
  if (personal && !existsSync(file)) return {};
  return rooted(allow(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>, keys, file), resolve(file, '..'), personal);
}

const REPO_LAYER = '.factory/config.json';

/**
 * What a repository may set (A-074, A-078 Q1): an allow list, not a deny list, because any key
 * added later is then closed to repositories until someone opens it. `sandbox.read` alone could
 * show the sandbox `~/.ssh`.
 */
const REPO_KEYS = ['checks', 'workflow', 'runtime'];
const PERSONAL_KEYS = [...REPO_KEYS, 'runtimes', 'sandbox', 'deadlineMs', 'runsDir'];
// Which work and where: one job's, never a default a later job would inherit.
const JOB_KEYS = ['workId', 'ticket', 'ticketFile', 'repo', 'base', 'parentCycleId', ...PERSONAL_KEYS];
// Named apart from the rest so each repository refusal says where the key may go instead.
const OWNER_ONLY: Record<string, string> = {
  grants: 'grants come only from the personal or job layer',
  sandbox: 'sandbox is set only by the personal or job layer',
};

function allow(layer: Record<string, unknown>, keys: string[], where: string, hints: Record<string, string> = {}): Record<string, unknown> {
  for (const key of Object.keys(layer)) {
    if (keys.includes(key)) continue;
    throw new Error(`${where}: ${Object.hasOwn(hints, key) ? hints[key] : `${key} may not be set here; allowed: ${keys.join(', ')}`}`);
  }
  return layer;
}

/** `.factory/config.json` as committed at `sha`: never the working tree, which the developer's runs share. */
function readRepoLayer(repo: string, sha: string): Record<string, unknown> {
  if (git(repo, 'ls-tree', '--name-only', sha, '--', REPO_LAYER) === '') return {};
  return allow(JSON.parse(git(repo, 'show', `${sha}:${REPO_LAYER}`)) as Record<string, unknown>, REPO_KEYS, `${REPO_LAYER} at ${sha}`, OWNER_ONLY);
}

/**
 * Personal, then repository, then the job file. `env` gives XDG_CONFIG_HOME and HOME. The base
 * is resolved to a SHA once, here, and `spec.base` carries it, so develop starts from the commit
 * the repository layer was read at even if the ref moves.
 */
export async function loadConfig(jobFile: string, env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const path = resolve(jobFile);
  const job = readLayer(path, JOB_KEYS, false) as unknown as JobFile;
  const repo = resolve(path, '..', job.repo);
  const base = git(repo, 'rev-parse', '--verify', '--end-of-options', `${job.base ?? 'HEAD'}^{commit}`);
  const spec = { ...merge([DEFAULTS, readLayer(personalFile(env), PERSONAL_KEYS, true), readRepoLayer(repo, base), job]), base } as unknown as JobFile;
  return {
    path,
    spec,
    repo,
    runsDir: resolve(spec.runsDir!),
    workflow: await loadWorkflow(spec.workflow),
    // Every module path is absolute by now, so relativeTo is never used.
    registry: runtimes(spec.runtimes, '/'),
    sandbox: spec.sandbox!,
  };
}

// Checked here, though the store checks it too: the adapters are built from it before the store opens.
async function loadWorkflow(file: string | undefined): Promise<Workflow> {
  if (file === undefined) return defaultWorkflow;
  const mod = (await import(pathToFileURL(file).href)) as { workflow?: Workflow };
  if (mod.workflow === undefined) throw new Error(`${file} has no named export workflow`);
  const refused = checkWorkflow(mod.workflow);
  if (refused.length > 0) throw new Error(`workflow refused: ${refused.join('; ')}`);
  return mod.workflow;
}
