import { observerKit } from '../../src/kits/observe.ts';
import { commentOnly } from '../fixtures/comment-observer.ts';
import { cases, repo } from './observe-shared.ts';

observerKit('comments', () => commentOnly(repo), cases);
