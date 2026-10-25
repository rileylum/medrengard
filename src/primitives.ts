import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkSandbox, execute, type ExecuteOptions, type Policy, type Sandbox, type RunResult } from './sandbox.ts';

type Destination = string | { workflow: string };
type Transition = Destination | Destination[];
/** A checked graph; transition lists select an edge by the stage's attempt number. */
export interface Workflow { name: string; start: string; stages: Record<string, Stage> }
/** The owner declares implementation, output contract, access, finite budget and named edges. */
export interface Stage {
  /** An agent stage hands a request to a runtime; a command stage runs the named extension, trusted owner code. */
  kind: 'agent' | 'command' | 'human';
  agent?: string;
  extension?: string;
  produces?: 'commit' | 'document' | 'verdict';
  access?: Access;
  budget?: number;
  on: Record<string, Transition>;
}
/**
 * What a stage's processes can reach, joined with its agent's sandbox. Unset fields default from the output contract:
 * a commit stage gets the clone, a stage after a commit a disposable copy of it, otherwise an empty folder; all writable
 * except a clone read by a stage that does not commit, so it cannot change what the developer starts from.
 */
export interface Access {
  /** `repository`: the work's clone; `subject`: a fresh copy of the current commit; `empty`: a new folder per run. */
  workspace?: 'empty' | 'repository' | 'subject';
  /** Every process has a private /tmp. `scratch` adds a folder kept after the run (`MEDRENGARD_SCRATCH`); `full` also the workspace. */
  write?: 'none' | 'scratch' | 'full';
  /** A `subject` copy carries the commit's Git history, so it can be diffed against the base; on unless declined. */
  history?: boolean;
  read?: string[];
  network?: boolean;
  env?: string[];
}
/** Runtime selection is independent of instructions and sandbox configuration. */
export interface Agent { runtime: string; role: string; skills: string[]; mcpServers: Record<string, unknown>; sandbox: Sandbox }
/** The runtime receives instructions as data, separately from executable commands. */
// lazy: feedback is text only; carry hashed attachments when an owner needs to send images.
export interface AgentRequest { runId: string; agent: Agent; produces: 'commit' | 'document' | 'verdict'; input: string; workspace: string; subject?: string; feedback?: string }
/** Adapters execute through the supplied confined context and return untrusted claims. */
export interface Runtime {
  start(request: AgentRequest, context: StageContext): Promise<void>;
  cancel(runId: string): Promise<void>;
  result(runId: string): Promise<unknown>;
  events(runId: string): AsyncIterable<unknown>;
}
/** An immutable, hashed output; evidence always names the exact subject it concerns. */
export interface Artifact { kind: 'commit' | 'document' | 'verdict'; hash: string; stage: string; sha?: string; repository?: string; content?: string; subject?: string; verdict?: 'PASS' | 'FAIL'; findings?: string[] }
/** Stage implementations receive data and confined execution, never a state writer. */
export interface StageContext {
  work: string;
  subject?: string;
  /** The commit the work's clone started from, once it has one. */
  base?: string;
  /** The run's kept scratch folder, when its access writes `scratch` or `full`. */
  scratch?: string;
  artifacts: Artifact[];
  execute(argv: string[], options?: ExecuteOptions & { signal?: AbortSignal }): Promise<RunResult>;
}
/** State is rebuilt from the event log; evidence contains only the current subject. */
export interface State {
  id: string; workflow: string; stage: string; input: string; workspace: string;
  subject?: string; feedback?: string; pending?: string; spent: Record<string, number>; artifacts: Artifact[]; evidence: Artifact[]; reason?: string;
}
/** Positions are assigned by SQLite in commit order. */
export interface Event { position: number; id: string; type: string; time: string; [key: string]: unknown }
/** Trusted owner definitions and implementations are supplied directly, never loaded from a candidate. */
export interface Options {
  path: string; directory: string; repository?: string; workflows: Workflow[];
  agents: Record<string, Agent>; runtimes: Record<string, Runtime>;
  extensions?: Record<string, (context: StageContext) => Promise<unknown>>;
  deadlineMs?: number;
}
// Plumbing reads raw tree/blob objects, avoiding candidate filters, hooks, index flags and dirty files.
// lazy: non-UTF-8 paths and links are refused; preserve their bytes when a workflow needs such trees.
const SNAPSHOT = `
const {execFileSync}=require('node:child_process');
const {mkdirSync,writeFileSync,symlinkSync}=require('node:fs');
const {join,dirname}=require('node:path');
const {isUtf8}=require('node:buffer');
const text=bytes=>{if(!isUtf8(bytes)) throw Error('snapshot requires UTF-8 paths and symlink targets'); return bytes.toString('utf8')};
const [source,sha,target]=process.argv.slice(1);
const git=(...args)=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-C',source,...args],{maxBuffer:64*1024*1024,timeout:5000});
for(const row of text(git('ls-tree','-rz','--full-tree',sha)).split('\\0').filter(Boolean)) {
 const tab=row.indexOf('\\t'); const [mode,type,oid]=row.slice(0,tab).split(' '); const name=row.slice(tab+1);
 if(type!=='blob' || !name || name.split('/').some(p=>!p || p==='.' || p==='..' || p==='.git') || name.startsWith('/')) throw Error('unsupported tree entry');
 const path=join(target,name); mkdirSync(dirname(path),{recursive:true}); const bytes=git('cat-file','blob',oid);
 if(mode==='120000') symlinkSync(text(bytes),path); else writeFileSync(path,bytes,{mode:mode==='100755'?0o755:0o644});
}
`;
const observer = new AsyncLocalStorage<boolean>();
const terminal = new Set(['DONE', 'ESCALATED']);
const STAGE_KEYS = new Set(['kind', 'agent', 'extension', 'produces', 'access', 'budget', 'on']);
const strings = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(x => typeof x === 'string'));
function checkAccess(a: unknown): boolean {
  if (a === undefined) return true;
  if (!a || typeof a !== 'object') return false;
  const { workspace, write, read, network, env, history, ...rest } = a as Access;
  return !Object.keys(rest).length && [undefined, 'empty', 'repository', 'subject'].includes(workspace) && [undefined, 'none', 'scratch', 'full'].includes(write)
    && strings(read) && strings(env) && [network, history].every(v => [undefined, true, false].includes(v));
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function frozen<T>(v: T): T {
  if (v && typeof v === 'object') { for (const child of Object.values(v)) frozen(child); Object.freeze(v); }
  return v;
}
// lazy: artifacts are capped at 1 MiB; add external blob storage when a workflow needs larger documents.
function data(value: unknown): any {
  const text = JSON.stringify(value);
  if (!text || Buffer.byteLength(text) > 1024 * 1024) throw new Error('invalid or oversized claim');
  return JSON.parse(text);
}
/** Refuse malformed graphs and unbounded automated stages before any work starts. */
export function checkWorkflow(w: Workflow): string[] {
  const errors: string[] = [];
  if (!w || typeof w.name !== 'string' || !w.name || !w.stages || typeof w.stages !== 'object') return ['workflow needs a name and stages'];
  if (!Object.hasOwn(w.stages, w.start) || terminal.has(w.start)) errors.push('workflow start is not a stage');
  for (const [name, s] of Object.entries(w.stages)) {
    if (terminal.has(name) || !s || !['agent', 'command', 'human'].includes(s.kind)) { errors.push(`workflow stage ${name} has invalid kind or name`); continue; }
    if (s.kind !== 'human' && (!Number.isSafeInteger(s.budget) || s.budget! <= 0)) errors.push(`workflow stage ${name} needs a finite budget`);
    if (s.kind === 'agent' && (typeof s.agent !== 'string' || !['commit', 'document', 'verdict'].includes(s.produces!))) errors.push(`workflow agent ${name} needs agent and output`);
    if (s.kind === 'command' && (typeof s.extension !== 'string' || !s.extension)) errors.push(`workflow command ${name} needs an extension`);
    const unknown = Object.keys(s).filter(k => !STAGE_KEYS.has(k));
    if (unknown.length) errors.push(`workflow stage ${name} has unknown fields ${unknown.join(', ')}`);
    if (!checkAccess(s.access)) errors.push(`workflow stage ${name} has invalid access`);
    else if (s.produces === 'commit' && ((s.access?.workspace ?? 'repository') !== 'repository' || (s.access?.write ?? 'full') !== 'full')) errors.push(`workflow stage ${name} produces a commit and needs a writable clone`);
    if (!s.on || typeof s.on !== 'object' || !Object.keys(s.on).length) { errors.push(`workflow stage ${name} needs transitions`); continue; }
    for (const edge of Object.values(s.on)) {
      const choices = Array.isArray(edge) ? edge : [edge];
      if (!choices.length) errors.push(`workflow stage ${name} has an empty transition`);
      for (const to of choices) {
        if (typeof to === 'string') { if (!terminal.has(to) && !Object.hasOwn(w.stages, to)) errors.push(`workflow stage ${name} names missing stage ${to}`); }
        else if (!to || typeof to.workflow !== 'string') errors.push(`workflow stage ${name} has an invalid transition`);
      }
    }
  }
  return errors;
}

/** The sole writer of workflow state, artifact records and budget expenditure. */
export class Controller {
  #db: DatabaseSync;
  #options: Options;
  #workflows: Map<string, Workflow>;
  #observers: ((event: Event) => void)[] = [];
  #closed = false;
  constructor(options: Options) {
    this.#workflows = new Map(options.workflows.map(w => [w.name, frozen(copy(w))]));
    const errors = options.workflows.flatMap(checkWorkflow);
    if (this.#workflows.size !== options.workflows.length) errors.push('workflow names must be unique');
    for (const w of options.workflows) for (const s of Object.values(w.stages ?? {})) {
      for (const edge of Object.values(s.on ?? {})) for (const to of Array.isArray(edge) ? edge : [edge]) {
        if (typeof to === 'object' && to && !this.#workflows.has(to.workflow)) errors.push(`workflow ${to.workflow} is missing`);
      }
      if (s.kind === 'agent') {
        const a = options.agents[s.agent!];
        if (!a || !options.runtimes[a.runtime]) errors.push(`workflow agent ${s.agent} is missing`);
      }
      if (s.extension && !options.extensions?.[s.extension]) errors.push(`workflow extension ${s.extension} is missing`);
    }
    const visiting = new Set<string>(), visited = new Set<string>();
    const visit = (name: string) => {
      if (visiting.has(name)) { errors.push('workflow handoffs must not reset budgets in a cycle'); return; }
      if (visited.has(name)) return;
      visiting.add(name);
      for (const s of Object.values(this.#workflows.get(name)?.stages ?? {})) for (const edge of Object.values(s.on ?? {})) for (const to of Array.isArray(edge) ? edge : [edge]) {
        // Only an owner decision may authorize a fresh budget on a handoff cycle.
        if (s.kind !== 'human' && typeof to === 'object' && to) visit(to.workflow);
      }
      visiting.delete(name); visited.add(name);
    };
    for (const name of this.#workflows.keys()) visit(name);
    if (errors.length) throw new Error(errors.join('; '));
    checkSandbox(...Object.values(options.agents).map(a => a.sandbox), ...options.workflows.flatMap(w => Object.values(w.stages)).map(s => ({ backend: 'bwrap', ...s.access })));
    this.#options = { ...options, workflows: frozen(copy(options.workflows)), directory: resolve(options.directory), repository: options.repository ? resolve(options.repository) : undefined, agents: frozen(copy(options.agents)) };
    mkdirSync(this.#options.directory, { recursive: true });
    this.#db = new DatabaseSync(options.path);
    if (this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").get()) { this.#db.close(); throw new Error('legacy event database requires an explicit migration'); }
    this.#db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS primitive_events(position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, body TEXT NOT NULL);`);
    for (const e of this.events()) if (e.type === 'opened' && hash(JSON.stringify(options.workflows)) !== e.definitionHash) throw new Error('workflow definitions changed since the recorded run');
  }
  /** Subscribe to future immutable events; observers receive no mutation authority. */
  observe(fn: (event: Event) => void): void { if (observer.getStore()) throw new Error('observer cannot change subscriptions'); this.#observers.push(fn); }
  /** Read the committed append-only event sequence. */
  events(): Event[] {
    return this.#db.prepare('SELECT position, body FROM primitive_events ORDER BY position').all().map(r => ({ ...JSON.parse(r.body as string), position: Number(r.position) }));
  }
  /** Replay a work's state without trusting any materialized snapshot. */
  state(id: string): State { return this.#read(id).state; }
  #read(id: string): { state: State; version: number } {
    const events = this.events().filter(e => e.id === id);
    let state: State | undefined;
    for (const e of events) {
      if (e.type === 'opened') state = { id, workflow: e.workflow as string, stage: this.#workflows.get(e.workflow as string)!.start, input: e.input as string, workspace: e.workspace as string, spent: Object.create(null), artifacts: [], evidence: [] };
      if (!state) throw new Error('event precedes work opening');
      if (e.type === 'started') { state.pending = e.runId as string; state.spent[state.stage] = (state.spent[state.stage] ?? 0) + 1; }
      if (e.type === 'completed' || e.type === 'decision') {
        state.pending = undefined;
        if (e.type === 'decision') state.feedback = e.feedback as string | undefined;
        if (e.artifact) {
          const a = e.artifact as Artifact;
          state.artifacts.push(a);
          if (a.kind === 'commit') state.subject = a.sha;
          if (a.kind === 'document' && !a.subject) state.subject = a.hash;
        }
        state.stage = e.next as string;
        if (e.workflow) { state.workflow = e.workflow as string; state.spent = Object.create(null); }
      }
      if (e.type === 'escalated') { state.stage = 'ESCALATED'; state.pending = undefined; state.reason = e.reason as string; }
    }
    if (!state) throw new Error(`unknown work ${id}`);
    state.evidence = state.artifacts.filter(a => a.subject === state!.subject);
    return { state, version: events.length };
  }
  #write(id: string, event: Record<string, unknown>, expected: number): void {
    if (observer.getStore()) throw new Error('observer cannot change state');
    this.#db.exec('BEGIN IMMEDIATE');
    let position: number;
    let body: string;
    try {
      const current = Number(this.#db.prepare('SELECT COUNT(*) AS n FROM primitive_events WHERE id=?').get(id)!.n);
      if (current !== expected) throw new Error('work changed concurrently');
      body = JSON.stringify({ ...event, id, time: new Date().toISOString() });
      position = Number(this.#db.prepare('INSERT INTO primitive_events(id,body) VALUES (?,?)').run(id, body).lastInsertRowid);
      this.#db.exec('COMMIT');
    } catch (e) { this.#db.exec('ROLLBACK'); throw e; }
    const observed = frozen({ ...JSON.parse(body), position } as Event);
    for (const fn of this.#observers) {
      // Returned thenables execute code too; keep assimilation inside the observation guard.
      try { observer.run(true, () => { void Promise.resolve(fn(observed)).catch(() => {}); }); } catch {}
    }
  }
  #version(id: string): number { return this.events().filter(e => e.id === id).length; }
  /** Start a work under an owner-defined workflow. */
  open(id: string, workflow: string, input: string): void {
    if (observer.getStore()) throw new Error('observer cannot change state');
    if (typeof id !== 'string' || !id || !id.isWellFormed() || typeof input !== 'string') throw new Error('invalid work');
    if (!this.#workflows.has(workflow)) throw new Error('unknown workflow');
    if (this.#version(id)) throw new Error('work already exists');
    const workspace = join(this.#options.directory, randomUUID());
    this.#write(id, { type: 'opened', workflow, input, workspace, definitionHash: hash(JSON.stringify(this.#options.workflows)) }, 0);
  }
  #edge(state: State, outcome: string): { next: string; workflow?: string } {
    const stage = this.#workflows.get(state.workflow)!.stages[state.stage];
    if (!Object.hasOwn(stage.on, outcome)) throw new Error(`unclassified outcome ${outcome}`);
    let edge = stage.on[outcome];
    if (Array.isArray(edge)) edge = edge[(state.spent[state.stage] ?? 1) - 1];
    if (!edge) throw new Error('transition budget exhausted');
    if (typeof edge === 'string') return { next: edge };
    return { workflow: edge.workflow, next: this.#workflows.get(edge.workflow)!.start };
  }
  /** Record an owner decision, with optional feedback for the next run, only for the exact artifact currently being reviewed. */
  decide(id: string, outcome: string, subject: string, feedback?: string): void {
    if (observer.getStore()) throw new Error('observer cannot change state');
    if (feedback !== undefined && typeof feedback !== 'string') throw new Error('invalid feedback');
    const { state, version } = this.#read(id);
    if (this.#workflows.get(state.workflow)!.stages[state.stage]?.kind !== 'human') throw new Error('work is not awaiting its owner');
    if (!state.subject || subject !== state.subject) throw new Error('stale owner decision');
    this.#write(id, { type: 'decision', outcome, subject, feedback, ...this.#edge(state, outcome) }, version);
  }
  /** An interrupted run is ambiguous: retain its spent budget and escalate without retrying. */
  recover(id: string): void {
    const { state, version } = this.#read(id);
    if (state.pending) this.#write(id, { type: 'escalated', reason: 'interrupted run needs the owner', runId: state.pending }, version);
  }
  async #execute(workspace: string, argv: string[], writable: boolean, sandbox: Sandbox, signal: AbortSignal, read: string[] = [], input = ''): Promise<RunResult> {
    const policy = { cwd: workspace, write: writable ? [workspace] : [], read: [...read, ...(writable ? [] : [workspace])] };
    return execute(sandbox, policy, argv, signal, { input });
  }
  async #git(state: State, args: string[], signal: AbortSignal): Promise<string> {
    const result = await this.#execute(state.workspace, ['git', '--no-replace-objects', '-c', 'core.hooksPath=/dev/null', ...args], false, { backend: 'bwrap' }, signal);
    if (result.status !== 'exited' || result.exitCode !== 0) throw new Error(`candidate git failed: ${result.stderr}`);
    return result.stdout.trim();
  }
  async #retain(state: State, sha: string, signal: AbortSignal): Promise<string> {
    // Separate sandboxes: candidate configuration sees no writable storage, and the importer sees no candidate files.
    // lazy: the process output cap bounds a retained pack; stream binary packs when a workflow exceeds that cap.
    const exported = await this.#execute(state.workspace, ['sh', '-c', 'printf \'%s\\n\' "$1" | git --no-replace-objects -c core.hooksPath=/dev/null pack-objects --stdout --revs | base64', 'export', sha], false, { backend: 'bwrap' }, signal);
    if (exported.status !== 'exited' || exported.exitCode !== 0) throw new Error(`cannot export commit: ${exported.stderr}`);
    const repository = join(this.#options.directory, randomUUID()); mkdirSync(repository);
    const pack = join(repository, 'incoming.pack');
    writeFileSync(pack, Buffer.from(exported.stdout, 'base64'));
    try {
      const imported = await this.#execute(repository, ['sh', '-c', 'git init --bare -q . && git index-pack --strict --stdin < incoming.pack && test "$(git cat-file -t "$1")" = commit && git update-ref "refs/artifacts/$1" "$1" && git fsck --full --no-reflogs', 'retain', sha], true, { backend: 'bwrap' }, signal);
      if (imported.status !== 'exited' || imported.exitCode !== 0) throw new Error(`cannot retain commit: ${imported.stderr}`);
      return repository;
    } finally { rmSync(pack); }
  }
  async #artifact(value: unknown, stage: Stage, state: State, signal: AbortSignal): Promise<Artifact> {
    const a = data(value);
    if (!a || !['commit', 'document', 'verdict'].includes(a.kind) || (stage.produces && a.kind !== stage.produces)) throw new Error('invalid artifact kind');
    if (a.kind === 'document' && (typeof a.content !== 'string' || !a.content.length)) throw new Error('missing document content');
    if (a.kind === 'commit') {
      if (typeof a.sha !== 'string' || !/^[a-f0-9]{40}$/.test(a.sha)) throw new Error('invalid commit SHA');
      if (await this.#git(state, ['rev-parse', 'HEAD'], signal) !== a.sha) throw new Error('commit claim differs from workspace HEAD');
      if (a.sha === state.subject) throw new Error('commit did not change');
      a.repository = await this.#retain(state, a.sha, signal);
    }
    if (a.kind === 'verdict' && (!['PASS', 'FAIL'].includes(a.verdict) || !state.subject || a.subject !== state.subject || !Array.isArray(a.findings) || !a.findings.every((s: unknown) => typeof s === 'string'))) throw new Error('invalid or stale verdict');
    if (a.subject !== undefined && a.subject !== state.subject) throw new Error('stale artifact subject');
    return { ...a, stage: state.stage, hash: hash(JSON.stringify(a)) };
  }
  #failedWithoutOwner(id: string, state: State): boolean {
    let workflow: unknown;
    let failed = false;
    for (const event of this.events().filter(e => e.id === id)) {
      const artifact = event.artifact as Artifact | undefined;
      if (event.type === 'completed' && workflow === state.workflow && artifact?.stage === state.stage && artifact.subject === state.subject && artifact.kind === 'verdict' && artifact.verdict === 'FAIL') failed = true;
      if (event.type === 'decision' && event.subject === state.subject) failed = false;
      if (event.workflow) workflow = event.workflow;
    }
    return failed;
  }
  /** Drive automatic stages until a human, terminal state or in-flight run is reached. */
  async advance(id: string): Promise<State> {
    if (observer.getStore()) throw new Error('observer cannot change state');
    while (true) {
      let { state, version } = this.#read(id);
      if (terminal.has(state.stage) || state.pending) return state;
      const stage = this.#workflows.get(state.workflow)!.stages[state.stage];
      if (stage.kind === 'human') return state;
      if ((state.spent[state.stage] ?? 0) >= stage.budget!) { this.#write(id, { type: 'escalated', reason: `budget exhausted at ${state.stage}` }, version); return this.state(id); }
      if (this.#failedWithoutOwner(id, state)) { this.#write(id, { type: 'escalated', reason: `failed stage ${state.stage} needs a new subject or the owner before retry` }, version); return this.state(id); }
      const runId = randomUUID();
      const commit = state.artifacts.findLast(a => a.kind === 'commit' && a.sha === state.subject);
      const workspaceKind = stage.access?.workspace ?? (stage.produces === 'commit' ? 'repository' : commit ? 'subject' : 'empty');
      const write = stage.access?.write ?? (workspaceKind === 'repository' && stage.produces !== 'commit' ? 'none' : 'full');
      const scratch = write === 'none' ? undefined : join(this.#options.directory, 'scratch', runId);
      this.#write(id, { type: 'started', runId, stage: state.stage, ...(scratch && { scratch }) }, version++);
      state = this.state(id);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), this.#options.deadlineMs ?? 30000);
      let runtime: Runtime | undefined;
      let active = true;
      try {
        let workspace = state.workspace;
        if (workspaceKind === 'repository') {
          // The clone has its own object database and gitdir: candidate writes cannot affect the source repository.
          mkdirSync(state.workspace, { recursive: true });
          if (!this.events().some(e => e.id === id && e.type === 'workspace' && e.repository)) {
            if (!this.#options.repository) throw new Error('repository workspace requires an owner repository');
            execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--no-local', '--quiet', '--', this.#options.repository, state.workspace], { timeout: 10000, stdio: 'pipe' });
            let base: string | undefined;
            try { base = execFileSync('git', ['-C', state.workspace, 'rev-parse', '--verify', '--quiet', 'HEAD'], { encoding: 'utf8', stdio: 'pipe' }).trim(); } catch { /* an empty repository has no base */ }
            this.#write(id, { type: 'workspace', path: state.workspace, repository: true, base }, version++);
          }
        } else {
          workspace = join(this.#options.directory, randomUUID()); mkdirSync(workspace, { recursive: true });
          if (workspaceKind === 'subject') {
            if (!commit) throw new Error('subject workspace needs a commit');
            const snapshot = await this.#execute(workspace, [process.execPath, '-e', SNAPSHOT, commit.repository!, state.subject!, workspace], true, { backend: 'bwrap' }, abort.signal, [commit.repository!, process.execPath]);
            if (snapshot.exitCode !== 0) throw new Error(`cannot materialize commit: ${snapshot.stderr}`);
            if (stage.access?.history ?? true) {
              // History comes from the controller's retained repository, so no candidate Git configuration arrives with it.
              const history = await this.#execute(workspace, ['sh', '-c', 'set -e; git init -q; git --no-replace-objects -c core.hooksPath=/dev/null fetch -q --no-tags "$1" "refs/artifacts/$2"; git update-ref HEAD "$2"; git reset -q', 'history', commit.repository!, state.subject!], true, { backend: 'bwrap' }, abort.signal, [commit.repository!]);
              if (history.exitCode !== 0) throw new Error(`cannot copy commit history: ${history.stderr}`);
            }
          }
        }
        if (scratch) mkdirSync(scratch, { recursive: true });
        const agent = stage.agent ? this.#options.agents[stage.agent] : undefined;
        const own = agent?.sandbox ?? { backend: 'bwrap' };
        const access = stage.access ?? {};
        const sandbox: Sandbox = { ...own, read: [...own.read ?? [], ...access.read ?? []], env: [...own.env ?? [], ...access.env ?? []], network: !!(own.network || access.network) };
        const policy: Policy = { cwd: workspace, write: [...write === 'full' ? [workspace] : [], ...scratch ? [scratch] : []], read: write === 'full' ? [] : [workspace], env: scratch ? { MEDRENGARD_SCRATCH: scratch } : {} };
        const base = this.events().find(e => e.id === id && e.type === 'workspace' && e.repository)?.base as string | undefined;
        const context: StageContext = frozen({ work: id, subject: state.subject, base, scratch, artifacts: copy(state.artifacts), execute: (argv: string[], { signal, ...options }: ExecuteOptions & { signal?: AbortSignal } = {}) => {
          if (!active || abort.signal.aborted) return Promise.reject(new Error('stage execution has ended'));
          if (!Array.isArray(argv) || !argv.length || !argv.every(a => typeof a === 'string')) return Promise.reject(new Error('invalid command'));
          return execute(sandbox, policy, argv, signal ? AbortSignal.any([signal, abort.signal]) : abort.signal, options);
        } });
        let result: any;
        const operation = async () => {
          if (stage.kind === 'agent') {
            runtime = this.#options.runtimes[agent!.runtime];
            await runtime.start(frozen({ runId, agent: copy(agent!), produces: stage.produces!, input: state.input, workspace, subject: state.subject, feedback: state.feedback }), context);
            for await (const event of runtime.events(runId)) {
              if (!active || abort.signal.aborted) throw new Error('stage execution has ended');
              this.#write(id, { type: 'runtime', runId, event: data(event) }, version++);
            }
            return runtime.result(runId);
          }
          return this.#options.extensions![stage.extension!](context);
        };
        const expired = new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error('stage deadline exceeded')), { once: true }));
        result = data(await Promise.race([operation(), expired]));
        if (!result || typeof result.outcome !== 'string' || !result.artifact) throw new Error('result has no artifact');
        const artifact = await this.#artifact(result.artifact, stage, state, abort.signal);
        if (artifact.kind === 'verdict' && result.outcome !== artifact.verdict) throw new Error('outcome disagrees with verdict');
        this.#write(id, { type: 'completed', runId, artifact, ...this.#edge(state, result.outcome) }, version);
      } catch (error) {
        abort.abort();
        if (runtime) void Promise.resolve().then(() => runtime!.cancel(runId)).catch(() => {});
        // A competing controller may already have escalated the pending run during recovery.
        if (this.state(id).pending === runId) this.#write(id, { type: 'escalated', runId, reason: error instanceof Error ? error.message : 'unclassified stage failure' }, this.#version(id));
        return this.state(id);
      } finally { active = false; abort.abort(); clearTimeout(timer); }
    }
  }
  /** Close the controller's database connection. */
  close(): void { if (observer.getStore()) throw new Error('observer cannot close the controller'); if (!this.#closed) { this.#db.close(); this.#closed = true; } }
}
