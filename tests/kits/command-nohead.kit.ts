// A merge step holding a grant that never writes outputDir/head: the head case must catch it.
import { commandKit } from '../../src/kits/command.ts';
import { base } from './command-shared.ts';

const b = base(['merge-nohead']);
commandKit('nohead', { ...b, stage: { ...b.stage, network: true, grants: ['github'] }, grants: { github: { variable: 'GH_TOKEN', value: 'kit-token' } } });
