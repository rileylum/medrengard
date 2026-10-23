// Every path under the runs folder that more than one module, or recover, must find from a cycle
// ID alone (A-112 item 3). Changing one moves where existing cycles are looked for: a store
// written before the change still names cycles whose clones and evidence sit at the old paths.
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** On disk: /tmp is a RAM tmpfs on the owner's machine. */
export const DEFAULT_RUNS_DIR = '/var/tmp/software_factory/runs';

/** Absolute: git -C repo would resolve a relative path against the repository, mkdir against cwd. */
export const runsRoot = (runsDir: string | undefined): string => resolve(runsDir ?? DEFAULT_RUNS_DIR);

export const storeFile = (runsDir: string): string => join(runsDir, 'events.sqlite');

/** Which process drives or recovers each work (11-f). Apart from the store, which keeps one table and no leases. */
export const lockFile = (runsDir: string | undefined): string => join(runsRoot(runsDir), 'locks.sqlite');

export function cyclePaths(runsDir: string | undefined, cycleId: string) {
  const root = runsRoot(runsDir);
  return {
    /** The developer's clone, checked out on `branch`. */
    clone: join(root, cycleId),
    branch: `sf/${cycleId}`,
    /** The candidate head's files with no `.git`, made by verify and read by the reviewers. */
    checkout: join(root, `${cycleId}-verify`),
    /** Per head and stage: a second command stage on the same head must not delete the first one's evidence. */
    evidence: (head: string, stage: string): string => join(root, 'evidence', head, stage),
  };
}

/** What one run left: its stdin, output and exit code (11-e). Never bound into a sandbox. */
export const runDir = (runsDir: string | undefined, runId: string): string => join(runsRoot(runsDir), 'runs', runId);

/**
 * The bare mirror every clone of `repo` shares its objects with (11-b2, A-126): one per repository,
 * so two job files on one repository share it and two repositories never do. Keyed by the real
 * path, so a symlinked or trailing-slash spelling finds the same mirror. `repo` must exist.
 */
export function mirrorPath(runsDir: string | undefined, repo: string): string {
  const key = createHash('sha256').update(realpathSync(repo)).digest('hex').slice(0, 16);
  return join(runsRoot(runsDir), 'mirrors', `${key}.git`);
}
