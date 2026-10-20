// Ticket 10-c: the command-stage kit (A-074, A-081). A user calls `commandKit` from their own test
// file, run with `node --test`, to check a command stage keeps the contract the controller relies
// on. It runs the stage through the real verify, on a scratch repository changed by `passing` or
// `failing`. Import it by path: the factory is not a package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, sep } from 'node:path';
import type { Adapter } from '../adapter.ts';
import { develop } from '../developer.ts';
import type { StageDef, Workflow } from '../lifecycle.ts';
import { restoreAccess, type Sandbox } from '../sandbox.ts';
import { EventStore } from '../store.ts';
import { verify } from '../verify.ts';
import { readRequest } from './request.ts';

export interface CommandKitOptions {
  /** The command stage as the workflow declares it; its transitions are replaced. */
  stage: Extract<StageDef, { kind: 'command' }>;
  /** Where its `{ file }` arguments are: the workflow file's folder. */
  workflowDir?: string;
  /** Change the scratch repository so the stage should PASS. The kit commits it. */
  passing: (repo: string) => void;
  /** Change it so the stage should FAIL. */
  failing: (repo: string) => void;
  /** As the job's. Default bwrap; `read` must hold any toolchain outside /usr. */
  sandbox?: Sandbox;
  /** Per command. Default 60000. */
  deadlineMs?: number;
}

const STAGE = 'CHECK';
const TICKET = 'The command kit change.';

/** Registers node:test cases for one command stage. Call it once per stage. */
export function commandKit(name: string, o: CommandKitOptions): void {
  // /var/tmp, not os.tmpdir(): /tmp is often a RAM tmpfs.
  mkdirSync('/var/tmp/software_factory', { recursive: true });
  const dir = mkdtempSync('/var/tmp/software_factory/sf-command-kit-');
  // A check may have locked what it wrote in the checkout, and rmSync cannot clear that.
  test.after(() => { restoreAccess(dir); rmSync(dir, { recursive: true, force: true }); });
  let n = 0;

  /** develop then verify, on a fresh repository, with `change` as the developer's commit. */
  const runStage = async (change: (repo: string) => void, stage = o.stage) => {
    const root = join(dir, `run${n++}`);
    const repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
    const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=kit', '-c', 'user.email=kit@example.invalid', ...a], { cwd, encoding: 'utf8' });
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'README.md'), '# command kit\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'kit base');
    // Nothing the stage is given names this folder: it is where an escaped write would land.
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'sentinel'), 'kit\n');
    const workflow: Workflow = {
      name: 'command-kit',
      start: 'DEV',
      stages: {
        DEV: { kind: 'agent', role: 'developer', produces: 'commit', roleText: 'You are the developer for the command kit.', transitions: { PASS: STAGE } },
        [STAGE]: { ...stage, transitions: { PASS: 'ACCEPTED' } },
      },
    };
    const developer: Adapter = {
      name: 'command-kit',
      async start(req) {
        change(req.cwd);
        git(req.cwd, 'add', '-A');
        git(req.cwd, 'commit', '-q', '-m', 'kit change');
        return { status: 'completed', claim: { head: git(req.cwd, 'rev-parse', 'HEAD').trim(), artifacts: ['.'] } };
      },
    };
    const store = new EventStore(join(root, 'events.sqlite'), workflow);
    try {
      const runsDir = join(root, 'runs');
      const job = { workId: 'kit', ticket: TICKET, repo };
      const deadlineMs = o.deadlineMs ?? 60_000;
      const dev = await develop(store, developer, job, { deadlineMs, runsDir });
      assert.equal(dev.cycle.stage, STAGE, `the kit's developer did not reach the stage: ${dev.cycle.escalation}`);
      const r = await verify(store, dev.cycle.cycleId, job, { deadlineMs, runsDir, isolation: 'process-group', sandbox: o.sandbox, workflowDir: o.workflowDir });
      const event = r.cycle.history.at(-1)!.event;
      assert.equal(event.type, 'verification');
      const checks = event.type === 'verification' ? event.checks : [];
      // What a failing check said, so the user sees why without opening the evidence.
      const said = checks.filter((c) => c.result !== 'PASS')
        .map((c) => `${c.name}: ${c.result} (${readFileSync(join(r.evidenceDir, `${c.name}.exit`), 'utf8').trim()}) ${readFileSync(join(r.evidenceDir, `${c.name}.stderr`), 'utf8').slice(-2000)}`).join('\n');
      return { repo, outside, checks, said, evidenceDir: r.evidenceDir, cycleId: dev.cycle.cycleId, ...dev.cycle.candidate! };
    } finally {
      store.close();
    }
  };

  test(`${name}: the passing change gives PASS`, async () => {
    const r = await runStage(o.passing);
    assert.ok(r.checks.length > 0 && r.checks.every((c) => c.result === 'PASS'), r.said || 'no commands ran');
  });

  test(`${name}: the failing change gives FAIL`, async () => {
    const r = await runStage(o.failing);
    assert.ok(!r.checks.some((c) => c.result === 'MISSING'), `a command could not start, which is not the FAIL this case wants:\n${r.said}`);
    assert.ok(r.checks.some((c) => c.result === 'FAIL'), 'every command passed the failing change');
  });

  // A check on the controller and readRequest, not on the command: the controller writes the
  // request, so no command can break it. It shows the user what their command is given.
  test(`${name}: the request the command is given names every field, and diffFile holds the change`, async () => {
    const r = await runStage(o.passing);
    const req = readRequest(join(r.evidenceDir, 'request.json'));
    assert.deepEqual(req, {
      cycleId: r.cycleId, workId: 'kit', stage: STAGE, head: r.head, base: r.base, ticket: TICKET,
      diffFile: join(r.evidenceDir, 'diff.patch'), outputDir: join(r.evidenceDir, 'output'),
    });
    const diff = execFileSync('git', ['diff', '--text', r.base, r.head], { cwd: r.repo, encoding: 'utf8' });
    assert.ok(diff.length > 0, 'the passing change is empty');
    assert.equal(readFileSync(req.diffFile, 'utf8'), diff);
  });

  test(`${name}: the command writes nothing outside outputDir and the checkout`, async () => {
    const r = await runStage(o.passing);
    // What the controller wrote in the stage directory, as it wrote it.
    const req = JSON.parse(readFileSync(join(r.evidenceDir, 'request.json'), 'utf8'));
    assert.equal(req.stage, STAGE, 'request.json was rewritten');
    assert.equal(req.outputDir, join(r.evidenceDir, 'output'), 'request.json was rewritten');
    assert.equal(readFileSync(join(r.evidenceDir, 'diff.patch'), 'utf8'), execFileSync('git', ['diff', '--text', r.base, r.head], { cwd: r.repo, encoding: 'utf8' }), 'diff.patch was rewritten');
    for (const c of r.checks)
      for (const [file, hash] of Object.entries(c.files ?? {}))
        assert.equal(createHash('sha256').update(readFileSync(join(r.evidenceDir, 'files', file))).digest('hex'), hash, `files/${file} was rewritten`);
    // Everything in the stage folder outside output/ is the controller's: no file more.
    const wrote = new Set(['request.json', 'diff.patch', 'output', ...r.checks.flatMap((c) => ['exit', 'stdout', 'stderr'].map((x) => `${c.name}.${x}`))]);
    const files = new Set(r.checks.flatMap((c) => Object.keys(c.files ?? {}).map((f) => join('files', f))));
    const extra = readdirSync(r.evidenceDir, { recursive: true }).map(String)
      .filter((p) => !wrote.has(p) && !p.startsWith(`output${sep}`) && !files.has(p) && ![...files].some((f) => f.startsWith(`${p}${sep}`)));
    assert.deepEqual(extra, [], 'files appeared in the stage folder outside output/');
    assert.deepEqual(readdirSync(dirname(r.evidenceDir)), [STAGE], 'files appeared beside the stage folder');
    assert.deepEqual(readdirSync(r.outside), ['sentinel'], 'a file appeared outside the stage');
    assert.equal(readFileSync(join(r.outside, 'sentinel'), 'utf8'), 'kit\n', 'a file outside the stage changed');
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: r.repo, encoding: 'utf8' }), '', 'the repository changed');
  });

  test(`${name}: with network unset, a connection from the stage fails`, async (t) => {
    if (o.stage.network === true) return t.skip('the stage sets network: true');
    let connections = 0;
    const server = createServer((s) => { connections++; s.end(); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
    try {
      const { port } = server.address() as { port: number };
      // A probe in the stage's place, with the stage's sandbox and network setting.
      const probe = `require('node:net').connect(${port}, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1));`;
      const r = await runStage(o.passing, { ...o.stage, run: [{ name: 'connect', command: [process.execPath, '-e', probe] }] });
      assert.ok(!r.checks.some((c) => c.result === 'MISSING'), `the probe could not start; add node's folder to sandbox.read:\n${r.said}`);
      assert.equal(connections, 0, 'the stage reached a listener on the host');
      assert.deepEqual(r.checks.map((c) => c.result), ['FAIL']);
    } finally {
      server.close();
    }
  });
}
