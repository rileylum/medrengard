import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { Controller } from '../../src/index.ts';

const returns = {
  getter: (attempt: () => void) => ({ get then() { attempt(); return (resolve: () => void) => resolve(); } }),
  callback: (attempt: () => void) => ({ then(resolve: (value?: unknown) => void) { attempt(); resolve(); } }),
  nested: (attempt: () => void) => ({ then(resolve: (value: unknown) => void) {
    resolve({ get then() { attempt(); return (done: () => void) => done(); } });
  } }),
};

for (const [name, returned] of Object.entries(returns)) {
  test(`observer return ${name} cannot create work or reorder notifications`, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'factory-observation-'));
    const controller = new Controller({
      directory, path: join(directory, 'events.sqlite'), agents: {}, runtimes: {},
      workflows: [{ name: 'wait', start: 'owner', stages: { owner: { kind: 'human', on: { accept: 'DONE' } } } }],
    });
    t.after(() => { controller.close(); rmSync(directory, { recursive: true, force: true }); });
    const refusals: string[] = [];
    const seen: number[] = [];
    controller.observe(event => {
      if (event.id !== 'original') return;
      return returned(() => {
        try { controller.open('from-observer', 'wait', 'unauthorized'); }
        catch (error) { refusals.push((error as Error).message); throw error; }
      });
    });
    controller.observe(event => { seen.push(event.position); });

    controller.open('original', 'wait', 'owner input');
    await setImmediate();
    controller.open('next', 'wait', 'another owner input');

    // Assertions stay outside observers, whose failures are deliberately isolated.
    assert.deepEqual(refusals, ['observer cannot change state']);
    assert.deepEqual(controller.events().map(event => event.id), ['original', 'next']);
    assert.deepEqual(seen, [1, 2]);
    assert.throws(() => controller.state('from-observer'), /unknown work/);
    assert.equal(controller.state('original').stage, 'owner');
    assert.equal(controller.state('next').stage, 'owner');
  });
}
