// Fails whatever the change: the passing case must catch it.
import { commandKit } from '../../src/kits/command.ts';
import { base } from './command-shared.ts';

const o = base();
commandKit('strict', { ...o, stage: { ...o.stage, run: [{ name: 'check', command: ['false'] }] } });
