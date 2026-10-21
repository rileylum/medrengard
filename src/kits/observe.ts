// Ticket 10-d: the observer helper and contract kit (A-074, A-088). An observer reads the event
// stream and acts only through the owner's commands, which record its name as their source. The
// controller never starts one. Import it by path: the factory is not a package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { storeOf } from '../config.ts';
import { storeFile } from '../layout.ts';
import type { Event } from '../lifecycle.ts';
import { EventStore } from '../store.ts';
import { FOLLOW_MS, openStream, storeReady, type Line } from '../stream.ts';

/** The owner's commands, run as `node src/main.ts … --source <source>` against the job file. A refused command rejects. */
export interface Owner {
  accept(sha: string): Promise<void>;
  cancel(): Promise<void>;
}
export type Observer = (line: Line, owner: Owner) => void | Promise<void>;

const MAIN = join(import.meta.dirname, '..', 'main.ts');

function ownerFor(jobFile: string, source: string): Owner {
  const run = (args: string[]) =>
    new Promise<void>((done, fail) =>
      execFile(process.execPath, [MAIN, ...args, '--source', source], (err, _out, stderr) =>
        // The last line: stderr opens with node's SQLite ExperimentalWarning.
        err ? fail(new Error(stderr.trim().split('\n').at(-1) || err.message)) : done()));
  return { accept: (sha) => run(['accept', jobFile, sha]), cancel: () => run(['cancel', jobFile]) };
}

/**
 * Follow the job's stream and hand each line to `observer`, one at a time, until `signal` aborts.
 * Lines after `after` only; an observer that restarts passes the last seq it handled. Rejects
 * with the observer's error if it throws.
 */
export async function observe(jobFile: string, source: string, observer: Observer, opts: { after?: number; signal?: AbortSignal } = {}): Promise<void> {
  const { runsDir, workId } = storeOf(jobFile);
  const db = storeFile(runsDir);
  const owner = ownerFor(resolve(jobFile), source);
  let stream: ReturnType<typeof openStream> | undefined;
  try {
    while (!opts.signal?.aborted) {
      stream ??= storeReady(db) ? openStream(db, { workId, after: opts.after }) : undefined;
      for (const line of stream?.poll() ?? []) {
        if (opts.signal?.aborted) return;
        await observer(line, owner);
      }
      await sleep(FOLLOW_MS, undefined, { signal: opts.signal }).catch(() => {});
    }
  } finally {
    stream?.close();
  }
}

export interface ObserverCase {
  name: string;
  /** One cycle under the default workflow, written to a scratch store and read back through the stream. */
  events: Event[];
  /** What the observer must do, in order. */
  expect: ({ accept: string } | 'cancel')[];
}

/**
 * Registers node:test cases for the observer `makeObserver` builds, a fresh one per case. The kit
 * sees only what the observer does through `Owner`; any other effect is the observer's own.
 */
export function observerKit(name: string, makeObserver: () => Observer, cases: ObserverCase[]): void {
  mkdirSync('/var/tmp/software_factory', { recursive: true });
  const dir = mkdtempSync('/var/tmp/software_factory/sf-observer-kit-');
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  let n = 0;
  /** The lines a store holding `events` gives, and then the line for `unknown`, a row only a newer controller could write. */
  const linesOf = (events: Event[], unknown?: object): Line[] => {
    const db = join(dir, `${n++}.sqlite`);
    const store = new EventStore(db);
    store.open('c1', 'w');
    for (const e of events) store.append('c1', e);
    store.close();
    if (unknown) {
      const raw = new DatabaseSync(db);
      raw.prepare("INSERT INTO events (cycle_id, seq, type, run_id, body, pos, at) SELECT 'c1', MAX(seq) + 1, ?, NULL, ?, MAX(pos) + 1, NULL FROM events")
        .run((unknown as { type: string }).type, JSON.stringify(unknown));
      raw.close();
    }
    const s = openStream(db);
    try { return s.poll(); } finally { s.close(); }
  };
  const recording = (refuse: boolean) => {
    const actions: ObserverCase['expect'] = [];
    const owner: Owner = {
      accept: async (sha) => { actions.push({ accept: sha }); if (refuse) throw new Error('refused by the kit'); },
      cancel: async () => { actions.push('cancel'); if (refuse) throw new Error('refused by the kit'); },
    };
    return { actions, owner };
  };

  for (const c of cases) {
    test(`${name}: ${c.name}`, async () => {
      const observer = makeObserver();
      const { actions, owner } = recording(false);
      for (const line of linesOf(c.events)) await observer(line, owner);
      assert.deepEqual(actions, c.expect);
    });
  }

  // After a claim, and after each case's events: an observer may treat a cycle with a head differently.
  test(`${name}: an event of an unknown type, with unknown fields, makes the observer neither throw nor act`, async () => {
    const claim: Event = { type: 'claim', runId: 'dev1', base: 'b'.repeat(40), runtime: 'kit' };
    for (const events of [[claim], ...cases.map((c) => c.events)]) {
      const observer = makeObserver();
      const lines = linesOf(events, { type: 'kit_future_event', runId: 7, nested: { list: [null, 'x'] } });
      const { actions, owner } = recording(false);
      for (const line of lines.slice(0, -1)) await observer(line, recording(false).owner);
      await observer(lines.at(-1)!, owner);
      assert.deepEqual(actions, []);
    }
  });

  test(`${name}: a refused command does not make the observer throw`, async () => {
    for (const c of cases) {
      const observer = makeObserver();
      const { owner } = recording(true);
      for (const line of linesOf(c.events)) await observer(line, owner);
    }
  });
}
