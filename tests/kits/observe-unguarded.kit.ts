// Accepts without catching a refusal.
import { observerKit } from '../../src/kits/observe.ts';
import { cases, comment } from './observe-shared.ts';

observerKit('unguarded', () => async (line, owner) => {
  if (line.stage === 'AWAITING_ACCEPTANCE' && line.from !== line.stage) await owner.accept(comment);
}, cases.slice(0, 1));
