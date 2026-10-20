// Accepts every change that reaches acceptance, comments or not.
import { observerKit } from '../../src/kits/observe.ts';
import { cases } from './observe-shared.ts';

observerKit('eager', () => {
  let head = '';
  return async (line, owner) => {
    const e = line.event as { type: string; head?: string };
    if (e.type === 'developer_result') head = e.head!;
    if (line.stage === 'AWAITING_ACCEPTANCE' && line.from !== line.stage) await owner.accept(head).catch(() => {});
  };
}, cases);
