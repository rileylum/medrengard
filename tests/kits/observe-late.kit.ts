// Acts on, or throws on, an unknown event only once its cycle has a candidate head (10-d adversarial).
import { observerKit, type Observer } from '../../src/kits/observe.ts';
import { commentOnly } from '../fixtures/comment-observer.ts';
import { cases, repo } from './observe-shared.ts';

const KNOWN = ['claim', 'developer_result', 'verification', 'verdict', 'accept', 'cancel'];
const late = (mode: 'act' | 'throw') => (): Observer => {
  const inner = commentOnly(repo);
  let head: string | undefined;
  return async (line, owner) => {
    const e = line.event as { type: string; head?: string };
    if (e.type === 'developer_result') head = e.head;
    if (!KNOWN.includes(e.type) && head) {
      if (mode === 'throw') throw new Error('unknown event after a head');
      return owner.cancel();
    }
    return inner(line, owner);
  };
};
observerKit('late-acts', late('act'), cases);
observerKit('late-throws', late('throw'), cases);
