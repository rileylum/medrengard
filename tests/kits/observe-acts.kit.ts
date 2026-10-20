// Cancels the cycle when it sees an event type it does not know.
import { observerKit } from '../../src/kits/observe.ts';
import { commentOnly } from '../fixtures/comment-observer.ts';
import { cases, repo } from './observe-shared.ts';

observerKit('acts', () => {
  const inner = commentOnly(repo);
  return async (line, owner) => {
    if (line.stage === null) return owner.cancel();
    return inner(line, owner);
  };
}, cases);
