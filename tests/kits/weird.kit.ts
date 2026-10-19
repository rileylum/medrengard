// Run by tests/kits.test.ts in a child `node --test`: the runtime kit against a broken extension.
import { runtimeKit } from '../../src/kits/runtime.ts';
import { cliAdapter, extensionSpec } from '../../src/runtime/cli-adapter.ts';

runtimeKit('weird', () => cliAdapter(extensionSpec('weird', new URL('../fixtures/ext-weird.ts', import.meta.url).pathname), { isolation: 'process-group' }));
