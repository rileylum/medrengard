// Passes whatever the change: the failing case must catch it.
import { commandKit } from '../../src/kits/command.ts';
import { base } from './command-shared.ts';

const o = base();
commandKit('lenient', { ...o, stage: { ...o.stage, run: [{ name: 'check', command: ['true'] }] } });
