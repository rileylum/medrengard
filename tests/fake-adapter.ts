// Scripted adapter for controller tests (04-a). Each start() consumes the next step.
import type { Adapter, RunOutcome, RunRequest } from '../src/adapter.ts';

export type Step =
  | { outcome: RunOutcome; afterMs?: number }
  /** Never settles on its own; settles `cancelled` when aborted. */
  | 'hang'
  /** Never settles, abort or not. */
  | 'ignore-abort';

export interface FakeAdapter extends Adapter {
  requests: RunRequest[];
  /** Number of starts whose signal has aborted, whether or not the step honoured it. */
  aborted: number;
}

export function fakeAdapter(...script: Step[]): FakeAdapter {
  const requests: RunRequest[] = [];
  const fake: FakeAdapter = {
    requests,
    aborted: 0,
    start(req, signal) {
      requests.push(req);
      signal.addEventListener('abort', () => fake.aborted++);
      const step = script.shift();
      if (step === undefined) throw new Error('fake adapter: script exhausted');
      return new Promise<RunOutcome>((resolve) => {
        if (step === 'ignore-abort') return;
        if (step === 'hang') { signal.addEventListener('abort', () => resolve({ status: 'cancelled' })); return; }
        setTimeout(() => resolve(step.outcome), step.afterMs ?? 0);
      });
    },
  };
  return fake;
}
