// Ticket 10-d: the observation stream. The store numbers and times each row; `events` replays each
// cycle to print the stage an event moved it to; `accept` and `cancel` record their source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { apply, defaultWorkflow, newCycle, type Event } from '../src/lifecycle.ts';
import { EventStore } from '../src/store.ts';
import { openStream, type Line } from '../src/stream.ts';
import { ownerCheck } from './workflows.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-stream-');
test.after(() => rmSync(dir, { recursive: true, force: true }));
process.env.XDG_CONFIG_HOME = join(dir, 'xdg');

const MAIN = join(import.meta.dirname, '..', 'src', 'main.ts');
const FIXTURES = join(import.meta.dirname, 'fixtures');
const H = 'a'.repeat(40);
const B = 'b'.repeat(40);
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
let n = 0;
const fresh = (name: string) => {
  const d = join(dir, `${n++}-${name}`);
  mkdirSync(d);
  return d;
};
const sf = (args: string[]) => spawnSync(process.execPath, [MAIN, ...args], { encoding: 'utf8', timeout: 60_000 });
const lines = (stdout: string): Line[] => stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));

const TO_ACCEPTANCE: Event[] = [
  { type: 'claim', runId: 'dev1', base: B, runtime: 'fake' },
  { type: 'developer_result', runId: 'dev1', head: H, artifacts: ['x'] },
  { type: 'verification', head: H, checks: [{ name: 'ok', result: 'PASS' }] },
  { type: 'verdict', runId: 'std1', head: H, verdict: 'PASS', findings: [] },
  { type: 'verdict', runId: 'adv1', head: H, verdict: 'PASS', findings: [] },
];
const OWNER_CHECK: Event[] = [
  { type: 'claim', runId: 'dev1', base: B, runtime: 'fake' },
  { type: 'developer_result', runId: 'dev1', head: H, artifacts: ['x'] },
  { type: 'verification', head: H, checks: [{ name: 'ok', result: 'PASS' }] },
  { type: 'verdict', runId: 'rv1', head: H, verdict: 'PASS', findings: [] },
];

function seed(db: string, cycleId: string, workId: string, events: Event[], workflow = defaultWorkflow) {
  const store = new EventStore(db, workflow);
  store.open(cycleId, workId, undefined, B);
  for (const e of events) store.append(cycleId, e);
  store.close();
}
const rows = (db: string) => {
  const raw = new DatabaseSync(db, { readOnly: true });
  try { return raw.prepare('SELECT cycle_id, seq, type, pos, at, body FROM events ORDER BY pos').all() as { cycle_id: string; seq: number; type: string; pos: number | null; at: string | null; body: string }[]; } finally { raw.close(); }
};

/** A job file whose runs directory holds `db`. Its repository is never touched by `events`. */
function job(workId: string, workflowModule?: string) {
  const root = fresh('job');
  const repo = join(root, 'repo');
  const runsDir = join(root, 'runs');
  mkdirSync(repo);
  mkdirSync(runsDir);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
  const jobFile = join(root, 'job.json');
  writeFileSync(jobFile, JSON.stringify({ workId, ticket: 'x', repo, runsDir, checks: [], ...(workflowModule ? { workflow: workflowModule } : {}) }));
  return { root, repo, runsDir, jobFile, db: join(runsDir, 'events.sqlite') };
}

// The store

test('each row a 10-d store writes has a store-wide increasing pos and an ISO time', () => {
  const db = join(fresh('pos'), 'events.sqlite');
  const before = new Date().toISOString();
  const store = new EventStore(db);
  store.open('c1', 'w1');
  store.open('c2', 'w2');
  store.append('c1', TO_ACCEPTANCE[0]!);
  store.append('c2', TO_ACCEPTANCE[0]!);
  store.append('c1', TO_ACCEPTANCE[1]!);
  // A redelivered result is dropped at insert; it takes no position.
  store.append('c1', TO_ACCEPTANCE[1]!);
  store.close();
  const after = new Date().toISOString();
  const all = rows(db);
  assert.deepEqual(all.map((r) => [r.cycle_id, r.seq]), [['c1', 0], ['c2', 0], ['c1', 1], ['c2', 1], ['c1', 2]]);
  assert.deepEqual(all.map((r) => r.pos), [1, 2, 3, 4, 5]);
  for (const r of all) {
    assert.match(r.at!, ISO);
    assert.ok(r.at! >= before && r.at! <= after, `${r.at} outside ${before}..${after}`);
  }
});

test('open records the workflow definition beside its hash', () => {
  const db = join(fresh('definition'), 'events.sqlite');
  seed(db, 'o1', 'wo', [], ownerCheck);
  assert.deepEqual(JSON.parse(rows(db)[0]!.body).definition, ownerCheck);
});

for (const fixture of ['v1-store.sqlite', 'v2-store.sqlite']) {
  test(`${fixture}, written before 10-d, gets a pos for every row in cycle order, keeps at null, and replays unchanged`, () => {
    const db = join(fresh('old'), 'events.sqlite');
    copyFileSync(join(FIXTURES, fixture), db);
    const raw = new DatabaseSync(db);
    const before = raw.prepare('SELECT cycle_id, seq FROM events ORDER BY cycle_id, seq').all().map((r) => [r.cycle_id, r.seq]);
    raw.close();
    const stages = (s: EventStore) => [...new Set(before.map(([c]) => c as string))].map((c) => { try { return s.load(c)!.stage; } catch { return 'other workflow'; } });
    const store = new EventStore(db);
    const loaded = stages(store);
    store.close();
    const all = rows(db);
    assert.deepEqual(all.map((r) => [r.cycle_id, r.seq]), before);
    assert.deepEqual(all.map((r) => r.pos), before.map((_, i) => i + 1));
    assert.ok(all.every((r) => r.at === null));
    // A second open neither renumbers nor fails, and a new row goes after every old one.
    const again = new EventStore(db);
    assert.deepEqual(stages(again), loaded);
    again.open('new', 'wnew');
    again.close();
    assert.equal(rows(db).at(-1)!.pos, before.length + 1);
  });
}

test('two processes opening one pre-10-d store at once both succeed', async () => {
  const db = join(fresh('race'), 'events.sqlite');
  copyFileSync(join(FIXTURES, 'v1-store.sqlite'), db);
  const script = `import { EventStore } from ${JSON.stringify(join(import.meta.dirname, '..', 'src', 'store.ts'))}; new EventStore(${JSON.stringify(db)}).close();`;
  // Hold the write lock so both children see no pos column, then queue on the lock together.
  const lock = new DatabaseSync(db);
  lock.exec('BEGIN IMMEDIATE');
  const once = () => new Promise<{ code: number | null; err: string }>((done) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => done({ code, err }));
  });
  const both = Promise.all([once(), once()]);
  await new Promise((r) => setTimeout(r, 1500));
  lock.exec('COMMIT');
  lock.close();
  for (const { code, err } of await both) assert.equal(code, 0, err);
  assert.ok(rows(db).every((r, k) => r.pos === k + 1));
});

// The reader

test('the stream gives each event its stage before and after and the escalation, matching history; the open marker gives no line', () => {
  const db = join(fresh('replay'), 'events.sqlite');
  seed(db, 'c1', 'w1', TO_ACCEPTANCE);
  seed(db, 'e1', 'w2', [TO_ACCEPTANCE[0]!, { type: 'run_failed', runId: 'dev1', reason: 'timeout' }, { type: 'cancel', source: 'owner' }]);
  const s = openStream(db);
  const got = s.poll();
  s.close();
  const store = new EventStore(db);
  const expected = ['c1', 'e1'].flatMap((id) => {
    const c = store.load(id)!;
    let replayed = newCycle(id, c.workId);
    return c.history.map((h) => {
      replayed = apply(replayed, h.event, defaultWorkflow);
      return { cycleId: id, workId: c.workId, event: h.event, from: h.from, stage: h.to, escalation: replayed.escalation ?? null };
    });
  });
  store.close();
  assert.deepEqual(got.map(({ seq: _, at: __, ...rest }) => rest), expected);
  assert.deepEqual(got.map((l) => l.seq), rows(db).filter((r) => r.seq > 0).map((r) => r.pos));
  assert.ok(got.every((l) => ISO.test(l.at!)));
  assert.equal(got.at(-1)!.escalation, 'run failed: timeout');
});

test('a cycle opened by 10-d under a custom workflow replays from its recorded definition, without the job file', () => {
  const db = join(fresh('custom'), 'events.sqlite');
  seed(db, 'o1', 'wo', OWNER_CHECK, ownerCheck);
  const s = openStream(db);
  assert.deepEqual(s.poll().map((l) => [l.from, l.stage]), [['QUEUED', 'DEV'], ['DEV', 'CHECK'], ['CHECK', 'REVIEW'], ['REVIEW', 'OWNER']]);
  s.close();
});

test('a definition that does not hash to the recorded workflow is not used', () => {
  const db = join(fresh('forged'), 'events.sqlite');
  seed(db, 'o1', 'wo', OWNER_CHECK, ownerCheck);
  const raw = new DatabaseSync(db);
  const body = JSON.parse((raw.prepare("SELECT body FROM events WHERE cycle_id = 'o1' AND seq = 0").get() as { body: string }).body);
  body.definition.stages.REVIEW.transitions.PASS = 'ACCEPTED';
  raw.prepare("UPDATE events SET body = ? WHERE cycle_id = 'o1' AND seq = 0").run(JSON.stringify(body));
  raw.close();
  const s = openStream(db);
  const got = s.poll();
  s.close();
  assert.ok(got.every((l) => l.from === null && l.stage === null && l.escalation === null), JSON.stringify(got));
});

test('a pre-10-d custom-workflow cycle gives null stages from the store alone, and real ones given its workflow', () => {
  const db = join(fresh('v2'), 'events.sqlite');
  copyFileSync(join(FIXTURES, 'v2-store.sqlite'), db);
  const bare = openStream(db);
  const got = bare.poll();
  bare.close();
  assert.ok(got.filter((l) => l.cycleId === 'o1').every((l) => l.stage === null && l.from === null));
  assert.equal(got.filter((l) => l.cycleId === 'd1').at(-1)!.stage, 'DEVELOPING');
  assert.ok(got.every((l) => l.at === null));
  const given = openStream(db, { workflow: ownerCheck });
  assert.equal(given.poll().filter((l) => l.cycleId === 'o1').at(-1)!.stage, 'OWNER');
  given.close();
});

test('a row of a type the reader does not know is given as stored, with null stages for it and the rest of its cycle', () => {
  const db = join(fresh('unknown'), 'events.sqlite');
  seed(db, 'c1', 'w1', TO_ACCEPTANCE.slice(0, 1));
  seed(db, 'c2', 'w2', TO_ACCEPTANCE.slice(0, 1));
  const future = { type: 'future_event', runId: 'x', extra: { nested: [1] } };
  const raw = new DatabaseSync(db);
  raw.prepare("INSERT INTO events (cycle_id, seq, type, run_id, body, pos, at) VALUES ('c1', 2, 'future_event', NULL, ?, 100, NULL)").run(JSON.stringify(future));
  raw.close();
  const store = new EventStore(db);
  // The store would refuse this; it reaches the reader only through a newer controller.
  assert.throws(() => store.append('c1', future as never));
  store.append('c1', TO_ACCEPTANCE[1]!);
  store.append('c2', TO_ACCEPTANCE[1]!);
  store.close();
  const s = openStream(db);
  const got = s.poll();
  s.close();
  const c1 = got.filter((l) => l.cycleId === 'c1');
  assert.deepEqual(c1.map((l) => l.stage), ['DEVELOPING', null, null]);
  assert.deepEqual(c1[1]!.event, future);
  assert.deepEqual(got.filter((l) => l.cycleId === 'c2').map((l) => l.stage), ['DEVELOPING', 'VERIFYING']);
});

test('after returns only later lines, with stages replayed from the earlier ones; each poll returns what was written since', () => {
  const db = join(fresh('after'), 'events.sqlite');
  seed(db, 'c1', 'w1', TO_ACCEPTANCE.slice(0, 3));
  const all = openStream(db);
  const first = all.poll();
  all.close();
  const s = openStream(db, { after: first[1]!.seq });
  assert.deepEqual(s.poll().map((l) => [l.from, l.stage]), [['VERIFYING', 'STANDARD_REVIEW']]);
  assert.deepEqual(s.poll(), []);
  const store = new EventStore(db);
  store.append('c1', TO_ACCEPTANCE[3]!);
  store.close();
  assert.deepEqual(s.poll().map((l) => [l.from, l.stage]), [['STANDARD_REVIEW', 'ADVERSARIAL_REVIEW']]);
  s.close();
});

test('workId keeps only that work\'s lines', () => {
  const db = join(fresh('work'), 'events.sqlite');
  seed(db, 'c1', 'w1', TO_ACCEPTANCE.slice(0, 2));
  seed(db, 'c2', 'w2', TO_ACCEPTANCE.slice(0, 1));
  const s = openStream(db, { workId: 'w2' });
  assert.deepEqual(s.poll().map((l) => l.cycleId), ['c2']);
  s.close();
});

// The command

test('events on a job file prints that work\'s lines as JSON, and on a runs directory every work\'s', () => {
  const j = job('w1');
  seed(j.db, 'c1', 'w1', TO_ACCEPTANCE.slice(0, 2));
  seed(j.db, 'c2', 'w2', TO_ACCEPTANCE.slice(0, 1));
  const one = sf(['events', j.jobFile]);
  assert.equal(one.status, 0, one.stderr);
  assert.deepEqual(lines(one.stdout).map((l) => [l.cycleId, l.workId, l.stage]), [['c1', 'w1', 'DEVELOPING'], ['c1', 'w1', 'VERIFYING']]);
  const every = sf(['events', j.runsDir]);
  assert.equal(every.status, 0, every.stderr);
  assert.deepEqual(lines(every.stdout).map((l) => l.cycleId), ['c1', 'c1', 'c2']);
  assert.deepEqual(Object.keys(lines(every.stdout)[0]!), ['seq', 'at', 'cycleId', 'workId', 'event', 'from', 'stage', 'escalation']);
  const after = sf(['events', j.runsDir, '--after', String(lines(every.stdout)[1]!.seq)]);
  assert.deepEqual(lines(after.stdout).map((l) => [l.cycleId, l.stage]), [['c2', 'DEVELOPING']]);
});

test('events on a job file replays a pre-10-d custom-workflow cycle under the job\'s workflow', () => {
  const root = fresh('wfmod');
  const mod = join(root, 'owner-check.ts');
  writeFileSync(mod, `export const workflow = ${JSON.stringify(ownerCheck)};\n`);
  const j = job('wo', mod);
  copyFileSync(join(FIXTURES, 'v2-store.sqlite'), j.db);
  const r = sf(['events', j.jobFile]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lines(r.stdout).map((l) => l.stage), ['DEV', 'CHECK', 'REVIEW', 'OWNER']);
});

test('events prints an unknown row and exits 0', () => {
  const j = job('w1');
  seed(j.db, 'c1', 'w1', TO_ACCEPTANCE.slice(0, 1));
  const raw = new DatabaseSync(j.db);
  raw.prepare("INSERT INTO events (cycle_id, seq, type, run_id, body, pos, at) VALUES ('c1', 2, 'future_event', NULL, '{\"type\":\"future_event\"}', 50, NULL)").run();
  raw.close();
  const r = sf(['events', j.runsDir]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lines(r.stdout).map((l) => [(l.event as { type: string }).type, l.stage]), [['claim', 'DEVELOPING'], ['future_event', null]]);
});

test('events refuses a missing store without --follow, bad flags and extra words, printing nothing', () => {
  const j = job('w1');
  for (const args of [[j.runsDir], [j.runsDir, '--after'], [j.runsDir, '--after', 'x'], [j.runsDir, '--after', '-1'], [j.runsDir, '--bogus'], [j.runsDir, j.runsDir], []]) {
    const r = sf(['events', ...args]);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stdout, '', args.join(' '));
  }
  assert.match(sf(['events', j.runsDir]).stderr, /no event store at /);
});

test('events --follow waits for a store that does not exist, then prints lines another process appends', async () => {
  const j = job('w1');
  const child = spawn(process.execPath, [MAIN, 'events', j.runsDir, '--follow'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const until = async (count: number) => {
    for (let i = 0; i < 100 && lines(out).length < count; i++) await new Promise((r) => setTimeout(r, 100));
  };
  try {
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(child.exitCode, null, err);
    seed(j.db, 'c1', 'w1', TO_ACCEPTANCE.slice(0, 1));
    await until(1);
    const store = new EventStore(j.db);
    store.append('c1', TO_ACCEPTANCE[1]!);
    store.close();
    await until(2);
    assert.deepEqual(lines(out).map((l) => l.stage), ['DEVELOPING', 'VERIFYING'], err);
  } finally {
    child.kill();
  }
});

// The source

test('accept and cancel record source owner by default, and the --source value when given', () => {
  const j = job('w');
  seed(j.db, 'c1', 'w', TO_ACCEPTANCE);
  const accepted = sf(['accept', j.jobFile, H, '--source', 'observer:comments']);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  seed(j.db, 'c2', 'w', TO_ACCEPTANCE);
  assert.equal(sf(['accept', j.jobFile, H]).status, 0);
  seed(j.db, 'c3', 'w', []);
  assert.equal(sf(['cancel', j.jobFile, '--source', 'bot']).status, 0);
  seed(j.db, 'c4', 'w', []);
  assert.equal(sf(['cancel', j.jobFile]).status, 0);
  const store = new EventStore(j.db);
  assert.deepEqual(['c1', 'c2', 'c3', 'c4'].map((c) => store.events(c).at(-1)), [
    { type: 'accept', head: H, source: 'observer:comments' },
    { type: 'accept', head: H, source: 'owner' },
    { type: 'cancel', source: 'bot' },
    { type: 'cancel', source: 'owner' },
  ]);
  store.close();
});

test('an empty or multi-line source, or a missing one, is refused and writes nothing', () => {
  const j = job('w');
  seed(j.db, 'c1', 'w', TO_ACCEPTANCE);
  const count = () => rows(j.db).length;
  const before = count();
  for (const args of [
    ['accept', j.jobFile, H, '--source', ''],
    ['accept', j.jobFile, H, '--source', 'a\nb'],
    ['accept', j.jobFile, H, '--source', 'a\rb'],
    ['accept', j.jobFile, H, '--source'],
    ['cancel', j.jobFile, '--source', ''],
    ['cancel', j.jobFile, '--source', 'x\ny'],
    ['cancel', j.jobFile, '--source'],
    ['cancel', j.jobFile, '--source', 'a', 'extra'],
  ]) {
    const r = sf(args);
    assert.equal(r.status, 2, JSON.stringify(args));
  }
  assert.equal(count(), before);
});

test('an accept or cancel event without a source, from before 10-d, still replays; a non-string source is unclassifiable', () => {
  const db = join(fresh('nosource'), 'events.sqlite');
  seed(db, 'c1', 'w1', [...TO_ACCEPTANCE, { type: 'accept', head: H }]);
  const store = new EventStore(db);
  assert.equal(store.load('c1')!.stage, 'ACCEPTED');
  store.open('c2', 'w2');
  assert.throws(() => store.append('c2', { type: 'cancel', source: 7 } as never), /unclassifiable/);
  assert.throws(() => store.append('c2', { type: 'cancel', source: '' } as never), /unclassifiable/);
  store.close();
});

// Review findings (A-090).

test('a store file with no events table yet is no store: events refuses it, and --follow waits for the table (10-d standard 1)', async () => {
  const j = job('w1');
  writeFileSync(j.db, '');
  const now = sf(['events', j.runsDir]);
  assert.equal(now.status, 2, now.stderr);
  assert.match(now.stderr, /no event store at /);
  const child = spawn(process.execPath, [MAIN, 'events', j.runsDir, '--follow'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  try {
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(child.exitCode, null, err);
    seed(j.db, 'c1', 'w1', TO_ACCEPTANCE.slice(0, 1));
    for (let i = 0; i < 100 && lines(out).length < 1; i++) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(lines(out).map((l) => l.stage), ['DEVELOPING'], err);
  } finally {
    child.kill();
  }
});

test('the store refuses a source that is not one line of printable text (10-d standard 1, adversarial note)', () => {
  const db = join(fresh('source-shape'), 'events.sqlite');
  const store = new EventStore(db);
  store.open('c1', 'w1');
  for (const bad of ['a\nb', 'a\rb', 'a\u2028b', 'a\u2029b', 'a\u0085b', 'a\vb', 'a\fb', 'a\u001bb', 'a\u007fb', 'a\tb'])
    assert.throws(() => store.append('c1', { type: 'cancel', source: bad }), /unclassifiable/, JSON.stringify(bad));
  assert.equal(store.append('c1', { type: 'cancel', source: 'observer:é ü' }).stage, 'CANCELLED');
  store.close();
});

test('accept and cancel refuse a --source with any control character or line separator, writing nothing (10-d adversarial note)', () => {
  const j = job('w');
  seed(j.db, 'c1', 'w', TO_ACCEPTANCE);
  const before = rows(j.db).length;
  for (const bad of ['a\u2028b', 'a\u2029b', 'a\u0085b', 'a\u001bb', 'a\vb']) {
    for (const args of [['accept', j.jobFile, H], ['cancel', j.jobFile]]) {
      const r = sf([...args, '--source', bad]);
      assert.equal(r.status, 2, JSON.stringify(bad));
      // The CLI's own refusal, not the store's: it names the flag.
      assert.match(r.stderr, /^--source must be one line of printable text$/m, JSON.stringify(bad));
    }
  }
  assert.equal(rows(j.db).length, before);
});

test('an open row whose body is not an object gives null stages for its cycle, and the reader goes on (10-d adversarial note)', () => {
  const db = join(fresh('null-open'), 'events.sqlite');
  seed(db, 'c1', 'w1', TO_ACCEPTANCE.slice(0, 1));
  const raw = new DatabaseSync(db);
  for (const [id, body] of [['n1', 'null'], ['n2', '5'], ['n3', '"open"']]) {
    raw.prepare("INSERT INTO events (cycle_id, seq, type, run_id, body, pos, at) SELECT ?, 0, 'open', NULL, ?, MAX(pos) + 1, NULL FROM events").run(id!, body!);
    raw.prepare("INSERT INTO events (cycle_id, seq, type, run_id, body, pos, at) SELECT ?, 1, 'cancel', NULL, '{\"type\":\"cancel\"}', MAX(pos) + 1, NULL FROM events").run(id!);
  }
  raw.close();
  const store = new EventStore(db);
  store.append('c1', TO_ACCEPTANCE[1]!);
  store.close();
  const s = openStream(db);
  const got = s.poll();
  s.close();
  assert.deepEqual(got.map((l) => [l.cycleId, l.stage]), [['c1', 'DEVELOPING'], ['n1', null], ['n2', null], ['n3', null], ['c1', 'VERIFYING']]);
});

test('cancel and events on a job file wait for another connection\'s exclusive lock instead of failing (10-d adversarial)', async () => {
  const j = job('w');
  seed(j.db, 'c1', 'w', []);
  const run = (args: string[]) => new Promise<{ code: number | null; err: string }>((done) => {
    const child = spawn(process.execPath, [MAIN, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => done({ code, err }));
  });
  for (const args of [['events', j.jobFile], ['cancel', j.jobFile]]) {
    // EXCLUSIVE, not IMMEDIATE: a read-only connection reads through a RESERVED lock.
    const lock = new DatabaseSync(j.db);
    lock.exec('BEGIN EXCLUSIVE');
    const child = run(args);
    await new Promise((r) => setTimeout(r, 1500));
    lock.exec('COMMIT');
    lock.close();
    const { code, err } = await child;
    assert.equal(code, 0, `${args[0]}: ${err}`);
  }
});
