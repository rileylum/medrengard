// Ticket 10-b: a job's settings, from four layers (A-074, A-078). Every command in main.ts reads
// its job through loadConfig, so the limits on each layer are enforced here and nowhere else.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Job } from './developer.ts';
import { git } from './git.ts';
import { checkWorkflow, defaultWorkflow, fileArgs, type Workflow } from './lifecycle.ts';
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
  /** The workflow file's folder, where a command's `{ file }` argument is found. Undefined for the default workflow. */
  workflowDir?: string;
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

/**
 * Undefined with no absolute XDG_CONFIG_HOME or HOME: a relative or empty one would read under
 * the working directory, which a repository can supply. The XDG spec ignores a relative value too.
 */
function personalFile(env: NodeJS.ProcessEnv): string | undefined {
  const abs = (p: string | undefined) => (p && isAbsolute(p) ? p : undefined);
  const home = abs(env.HOME);
  const dir = abs(env.XDG_CONFIG_HOME) ?? (home && join(home, '.config'));
  return dir ? join(dir, 'software_factory', 'config.json') : undefined;
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
  if (Array.isArray(sandbox?.read)) out.sandbox = { ...sandbox, read: sandbox!.read!.map((p) => under(dir, p)) };
  return out;
}

/** A missing personal file is an empty layer; a missing job file is an error. */
function readLayer(file: string | undefined, keys: string[], personal: boolean): Record<string, unknown> {
  if (file === undefined || (personal && !existsSync(file))) return {};
  return rooted(allow(parse(readFileSync(file, 'utf8'), file), keys, file), resolve(file, '..'), personal);
}

const REPO_LAYER = '.factory/config.json';

/**
 * What a repository may set (A-074, A-078 Q1): an allow list, not a deny list, because any key
 * added later is then closed to repositories until someone opens it. `sandbox.read` alone could
 * show the sandbox `~/.ssh`.
 */
const REPO_KEYS = ['checks', 'workflow', 'runtime'];
const PERSONAL_KEYS = [...REPO_KEYS, 'runtimes', 'sandbox', 'deadlineMs', 'runsDir'];
// Which work and where: one job's, never a default a later job would inherit. `model` is read by
// proto/job.ts and ignored here; refusing it would stop proto/board.ts accept and cancel on its own job files.
const JOB_KEYS = ['workId', 'ticket', 'ticketFile', 'repo', 'base', 'parentCycleId', 'model', ...PERSONAL_KEYS];
// Named apart from the rest so each repository refusal says where the key may go instead.
const OWNER_ONLY: Record<string, string> = {
  grants: 'grants come only from the personal or job layer',
  sandbox: 'sandbox is set only by the personal or job layer',
};

const isObject = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A layer's text as an object, or an error naming `where`: an array or null would read as empty. */
function parse(text: string, where: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`${where}: must be a JSON object (${(err as Error).message})`);
  }
  if (!isObject(value)) throw new Error(`${where}: must be a JSON object`);
  return value as Record<string, unknown>;
}

function allow(layer: Record<string, unknown>, keys: string[], where: string, hints: Record<string, string> = {}): Record<string, unknown> {
  for (const [key, value] of Object.entries(layer)) {
    // merge would spread a string or an array into the earlier object and drop the typo silently.
    if (keys.includes(key) && NESTED.includes(key) && !isObject(value)) throw new Error(`${where}: ${key} must be a JSON object`);
    if (keys.includes(key)) continue;
    throw new Error(`${where}: ${Object.hasOwn(hints, key) ? hints[key] : `${key} may not be set here; allowed: ${keys.join(', ')}`}`);
  }
  return layer;
}

/** `.factory/config.json` as committed at `sha`: never the working tree, which the developer's runs share. */
function readRepoLayer(repo: string, sha: string): Record<string, unknown> {
  if (git(repo, 'ls-tree', '--name-only', sha, '--', REPO_LAYER) === '') return {};
  const where = `${REPO_LAYER} at ${sha}`;
  const layer = allow(parse(git(repo, 'show', `${sha}:${REPO_LAYER}`), where), REPO_KEYS, where, OWNER_ONLY);
  // It is copied to runsDir under this path, so a `..` would write outside it.
  const w = layer.workflow;
  if (w !== undefined && (typeof w !== 'string' || w === '' || isAbsolute(w) || w.split(/[\\/]/).includes('..')))
    throw new Error(`${where}: workflow ${JSON.stringify(w)} must be a path inside the repository`);
  return layer;
}

/**
 * The repository's workflow as committed at `sha`, copied to a file and imported from there. It
 * runs unsandboxed in the controller (accepted risk, A-078 Q2). One file only, so it must not
 * import a sibling: the copy has none beside it.
 */
function extractWorkflow(repo: string, sha: string, path: string, runsDir: string): string {
  const file = join(runsDir, 'repo-config', sha, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, git(repo, 'show', `${sha}:${path}`));
  return file;
}

/** Each `{ file }` a command names, copied from `sha` beside the extracted workflow. checkWorkflow has refused a path that climbs out. */
function extractFiles(repo: string, sha: string, workflowPath: string, w: Workflow, runsDir: string): void {
  const files = Object.values(w.stages).flatMap((d) => (d.kind === 'command' ? (d.run ?? []) : []))
    .flatMap(fileArgs);
  for (const file of new Set(files)) {
    // posix join: a Git path, not a host one; './x' and 'x' name the same blob.
    const path = posix.join(posix.dirname(workflowPath), file);
    const entry = git(repo, 'ls-tree', sha, '--', path);
    if (entry === '') throw new Error(`workflow ${workflowPath} names file ${file}, which is not in the repository at ${sha}`);
    const out = join(runsDir, 'repo-config', sha, path);
    mkdirSync(dirname(out), { recursive: true });
    // Not the git helper: it trims and decodes, and these bytes are hashed and run as they are.
    writeFileSync(out, execFileSync('git', ['cat-file', 'blob', `${sha}:${path}`], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }));
    // Git's mode, so a committed script can be the command itself; verify's copy keeps it.
    chmodSync(out, entry.startsWith('100755 ') ? 0o755 : 0o644);
  }
}

/**
 * Personal, then repository, then the job file. `env` gives XDG_CONFIG_HOME and HOME. The base
 * is resolved to a SHA once, here, and `spec.base` carries it, so develop starts from the commit
 * the repository layer was read at even if the ref moves.
 */
export async function loadConfig(jobFile: string, env: NodeJS.ProcessEnv = process.env, opts: { base?: string } = {}): Promise<Config> {
  const path = resolve(jobFile);
  const job = readLayer(path, JOB_KEYS, false) as unknown as JobFile;
  const repo = resolve(path, '..', job.repo);
  const base = git(repo, 'rev-parse', '--verify', '--end-of-options', `${opts.base ?? job.base ?? 'HEAD'}^{commit}`);
  const repoLayer = readRepoLayer(repo, base);
  const spec = { ...merge([DEFAULTS, readLayer(personalFile(env), PERSONAL_KEYS, true), repoLayer, job]), base } as unknown as JobFile;
  const runsDir = resolve(spec.runsDir!);
  // The repository's path is relative to the repository; the job file's, already absolute, beats it.
  const fromRepo = repoLayer.workflow !== undefined && job.workflow === undefined;
  if (fromRepo) spec.workflow = extractWorkflow(repo, base, repoLayer.workflow as string, runsDir);
  const workflow = await loadWorkflow(spec.workflow);
  // Only the workflow file was copied; what its commands name beside it comes from the same commit.
  if (fromRepo) extractFiles(repo, base, repoLayer.workflow as string, workflow, runsDir);
  return {
    path,
    spec,
    repo,
    runsDir,
    workflow,
    workflowDir: spec.workflow === undefined ? undefined : dirname(spec.workflow),
    // Every module path is absolute by now, so relativeTo is never used.
    registry: runtimes(spec.runtimes, '/'),
    sandbox: spec.sandbox!,
  };
}

/** Where the job's store is. The repository layer may set neither, so this reads no Git and cannot fail on it. */
export function storeOf(jobFile: string, env: NodeJS.ProcessEnv = process.env): { runsDir: string; workId: string } {
  const job = readLayer(resolve(jobFile), JOB_KEYS, false);
  const spec = merge([DEFAULTS, readLayer(personalFile(env), PERSONAL_KEYS, true), job]);
  return { runsDir: resolve(spec.runsDir as string), workId: job.workId as string };
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
