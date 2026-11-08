// Where the benchmark keeps what is not source: its log, trajectories, results and the pinned
// SlopCodeBench checkouts, shared by every checkout of the repository so a study's worktree sees
// the same record as the main one. MEDRENGARD_BENCH_DATA moves it.
import { homedir } from "node:os";
import { join } from "node:path";

export const data =
  process.env.MEDRENGARD_BENCH_DATA ??
  join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "medrengard", "bench");
