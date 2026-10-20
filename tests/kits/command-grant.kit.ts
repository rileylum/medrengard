// A merge step holding a grant, which writes the head it acted on.
import { commandKit } from '../../src/kits/command.ts';
import { base } from './command-shared.ts';

const b = base(['merge']);
commandKit('grant', { ...b, stage: { ...b.stage, network: true, grants: ['github'] }, grants: { github: { variable: 'GH_TOKEN', value: 'kit-token' } } });
