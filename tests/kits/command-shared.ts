// Shared by the command kit fixtures, which tests/kits.test.ts runs in a child `node --test`.
import { realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CommandKitOptions } from '../../src/kits/command.ts';

const NODE_PREFIX = dirname(dirname(realpathSync(process.execPath)));

/** The fixture check, PASS on good.txt and FAIL on bad.txt, under bwrap with node readable. */
export const base = (args: string[] = []): CommandKitOptions => ({
  stage: { kind: 'command', run: [{ name: 'check', command: [process.execPath, { file: 'check.ts' }, ...args] }], transitions: { PASS: 'ACCEPTED' } },
  workflowDir: join(import.meta.dirname, '..', 'fixtures', 'command'),
  passing: (repo) => writeFileSync(join(repo, 'good.txt'), 'good\n'),
  failing: (repo) => writeFileSync(join(repo, 'bad.txt'), 'bad\n'),
  sandbox: { backend: 'bwrap', read: [NODE_PREFIX] },
});
