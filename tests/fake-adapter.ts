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
}

export function fakeAdapter(...script: Step[]): FakeAdapter {
  const requests: RunRequest[] = [];
  return {
    name: 'fake',
    requests,
    start(req, signal) {
      requests.push(req);
      const step = script.shift();
      if (step === undefined) throw new Error('fake adapter: script exhausted');
      return new Promise<RunOutcome>((resolve) => {
        if (step === 'ignore-abort') return;
        if (step === 'hang') { signal.addEventListener('abort', () => resolve({ status: 'cancelled' })); return; }
        setTimeout(() => resolve(step.outcome), step.afterMs ?? 0);
      });
    },
  };
}
