import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function until(check: () => boolean, message: () => string): Promise<void> {
  const end = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < end, message());
    await delay(20);
  }
}

for (const mode of ['deadline', 'crash']) {
  test(`public controller ${mode} ends a sandbox descendant that called setsid`, { timeout: 20000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'factory-confinement-'));
    const repo = join(directory, 'repo');
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Owner', '-c', 'user.email=owner@example.test', 'commit', '--allow-empty', '-qm', 'base']);
    const child = spawn(process.execPath, [join(import.meta.dirname, 'fixtures/confined-controller.ts'), directory, mode], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', bytes => { errors += bytes; });
    const closed = new Promise<void>(resolve => child.on('close', () => resolve()));
    t.after(async () => {
      child.kill('SIGKILL');
      await closed;
      // Every fixture process carries the unique directory as an argv entry,
      // allowing cleanup across PID namespaces even if confinement regresses.
      for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
        try {
          if (readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').includes(directory)) process.kill(Number(pid), 'SIGKILL');
        } catch (error) { if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code!)) throw error; }
      }
      rmSync(directory, { recursive: true, force: true });
    });
    await until(() => existsSync(join(directory, 'workspace')), () => `controller did not open work: ${errors}`);
    const workspace = readFileSync(join(directory, 'workspace'), 'utf8');
    const marker = join(workspace, 'late');
    const ready = join(workspace, 'ready');
    await until(() => existsSync(ready), () => `setsid descendant never became ready: ${errors}`);
    const { attemptAt } = JSON.parse(readFileSync(ready, 'utf8'));
    assert.ok(attemptAt > Date.now(), 'descendant already attempted its marker');
    if (mode === 'crash') {
      assert.equal(child.kill('SIGKILL'), true);
      await closed;
      assert.equal(child.signalCode, 'SIGKILL');
    } else {
      await until(() => existsSync(join(directory, 'result')), () => `deadline did not end the stage: ${errors}`);
      const state = JSON.parse(readFileSync(join(directory, 'result'), 'utf8'));
      assert.equal(state.stage, 'ESCALATED');
      assert.match(state.reason, /stage deadline exceeded/);
    }
    await delay(Math.max(0, attemptAt - Date.now()) + 300);
    assert.equal(existsSync(marker), false, `setsid descendant survived controller ${mode}`);
  });
}
