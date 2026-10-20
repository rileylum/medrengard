// Unconfined, the check adds a file to its own stage folder, beside the evidence: the writes case
// must catch it. network is set so that the network case, which also fails unconfined, is skipped.
import { commandKit } from '../../src/kits/command.ts';
import { base } from './command-shared.ts';

const o = base(['forge-stage']);
commandKit('forge-stage', { ...o, stage: { ...o.stage, network: true }, sandbox: { backend: 'none' } });
