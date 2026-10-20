// Throws on an event type it does not know.
import { observerKit } from '../../src/kits/observe.ts';
import { commentOnly } from '../fixtures/comment-observer.ts';
import { cases, repo } from './observe-shared.ts';

const KNOWN = ['claim', 'developer_result', 'verification', 'verdict', 'accept', 'cancel'];
observerKit('throws', () => {
  const inner = commentOnly(repo);
  return (line, owner) => {
    if (!KNOWN.includes((line.event as { type: string }).type)) throw new Error('unknown event');
    return inner(line, owner);
  };
}, cases);
