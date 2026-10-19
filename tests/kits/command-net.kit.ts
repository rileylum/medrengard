// Unconfined, so a connection succeeds though the stage does not set network: the network case must catch it.
import { commandKit } from '../../src/kits/command.ts';
import { base } from './command-shared.ts';

commandKit('net', { ...base(), sandbox: { backend: 'none' } });
