// Ticket 10-a: runtimes chosen by name (A-074, Q7). `claude` and `pi` are built in; a job file
// adds an extension runtime as a module. main.ts builds one adapter per agent role from here.
import { resolve } from 'node:path';
import type { DeveloperAdapter } from '../developer.ts';
import type { Sandbox } from '../sandbox.ts';
import { claudeDeveloper, claudeReviewer, cliAdapter, extensionSpec, piDeveloper, piReviewer } from './cli-adapter.ts';

export interface RuntimeEntry {
  /** One adapter for a role. `writes` is true when the role produces a commit. */
  adapter(opts: { sandbox: Sandbox; writes: boolean }): DeveloperAdapter;
}

export const BUILT_IN: Record<string, RuntimeEntry> = {
  // A function of the worktree: claude's developer allow list names it by absolute path.
  claude: { adapter: ({ sandbox, writes }) => (writes ? (worktree) => cliAdapter(claudeDeveloper(worktree), { sandbox, writes }) : cliAdapter(claudeReviewer, { sandbox, writes })) },
  pi: { adapter: ({ sandbox, writes }) => cliAdapter(writes ? piDeveloper : piReviewer, { sandbox, writes }) },
};

/** The built-in runtimes plus the job's, whose modules resolve against `relativeTo`. */
export function runtimes(extra: Record<string, { module: string }> | undefined, relativeTo: string): Record<string, RuntimeEntry> {
  const all = { ...BUILT_IN };
  for (const [name, entry] of Object.entries(extra ?? {})) {
    // A built-in name meaning someone's module would hide which runtime ran.
    if (Object.hasOwn(BUILT_IN, name)) throw new Error(`runtimes.${name} reuses a built-in runtime name; pick another`);
    if (typeof entry?.module !== 'string') throw new Error(`runtimes.${name}.module must be a path to a TypeScript file`);
    const spec = extensionSpec(name, resolve(relativeTo, entry.module));
    all[name] = { adapter: ({ sandbox, writes }) => cliAdapter(spec, { sandbox, writes }) };
  }
  return all;
}

export function runtimeFor(registry: Record<string, RuntimeEntry>, name: string | undefined, role: string): RuntimeEntry {
  if (name !== undefined && Object.hasOwn(registry, name)) return registry[name]!;
  throw new Error(`runtime.${role} must be one of ${Object.keys(registry).join(', ')}, got ${JSON.stringify(name)}`);
}
