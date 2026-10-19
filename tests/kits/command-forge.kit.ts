// Unconfined, the check writes beside the stage's folders: the writes case must catch it. network is
// set so that the network case, which also fails unconfined, is skipped.
import { commandKit } from '../../src/kits/command.ts';
import { base } from './command-shared.ts';

const o = base(['forge']);
commandKit('forge', { ...o, stage: { ...o.stage, network: true }, sandbox: { backend: 'none' } });
