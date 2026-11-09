// Where the benchmark keeps what is not source: its log, trajectories, results and the pinned
// SlopCodeBench checkouts, shared by every checkout of the repository so a study's worktree sees
// the same record as the main one. MEDRENGARD_BENCH_DATA moves it.
import { mkdirSync, mkdtempSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const data =
  process.env.MEDRENGARD_BENCH_DATA ??
  join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "medrengard", "bench");

// A fresh scratch directory under TMPDIR, else on disk under /var/tmp/medrengard: /tmp is often a
// small tmpfs, and a full one once left grades from half-unpacked commits.
export function scratch(prefix: string) {
  const base = process.env.TMPDIR ?? "/var/tmp/medrengard";

  mkdirSync(base, { recursive: true });

  return mkdtempSync(join(base, prefix));
}
