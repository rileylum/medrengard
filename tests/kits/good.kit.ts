// Run by tests/kits.test.ts in a child `node --test`: the runtime kit against the fixture extension.
import { runtimeKit } from '../../src/kits/runtime.ts';
import { cliAdapter, extensionSpec } from '../../src/runtime/cli-adapter.ts';

runtimeKit('ext', () => cliAdapter(extensionSpec('ext', new URL('../fixtures/ext-runtime.ts', import.meta.url).pathname), { isolation: 'process-group' }));
