// Ticket 04-a: the seam between the controller and a runtime. An adapter starts one run and
// settles with a normalised outcome. It knows nothing about cycles, stages or events; the
// controller (controller.ts) decides what an outcome means.
import type { Role } from './lifecycle.ts';

export interface RunRequest {
  /** Minted by the controller; the adapter echoes it in nothing, it is for the adapter's own logs. */
  runId: string;
  role: Role;
  /** The contract plus, for reviewers, diff, SHA and evidence. Assembled by the caller. */
  prompt: string;
  cwd: string;
  /**
   * Absolute paths the run's sandbox binds read-only, chosen by the controller per run: a shared
   * clone's mirror objects (11-b2, A-134). An extension runtime receives it in the request JSON.
   */
  read?: string[];
  /**
   * The run's folder, `<runsDir>/runs/<runId>/` (11-e): a `cliAdapter` keeps the run's stdin,
   * output and exit code there, so they outlive the controller. Set by the controller; never sent
   * to an extension runtime. Without one the run's output goes through pipes and dies with this process.
   */
  runDir?: string;
  /** The controller's deadline for the run, so the supervisor can enforce it without the controller (11-e). Not sent to an extension. */
  deadlineMs?: number;
}

/**
 * Plain data only: the controller puts the outcome through a JSON round trip before reading it,
 * so getters, Proxies, functions, symbols, BigInt and cycles are either run once inside its guard
 * or turned into a failed run. Build outcomes from JSON.parse and literals.
 */
export type RunOutcome =
  /** The runtime returned something. `claim` is parsed JSON and unvalidated; the controller classifies it. */
  | { status: 'completed'; claim: unknown; sessionId?: string }
  /** Never started, crashed, or ended with no claim. */
  | { status: 'failed'; reason: string }
  /** Aborted by us and stopped. */
  | { status: 'cancelled' };

/**
 * What a started run left, seen by a process that is not its controller (11-f). `stopped`: it
 * was running and `look` ended it. `gone`: no exit, and nothing holds the run any more.
 */
export type Left =
  | { state: 'running' }
  | { state: 'stopped' }
  | { state: 'finished'; outcome: RunOutcome }
  | { state: 'gone' };

export interface Adapter {
  /** Recorded as `runtime` on the Run by the claim event, and on every outcome event (10-a): `claude`, `pi`, an extension's name, or a test double's. */
  name: string;
  /** SHA-256 of an extension runtime's module file, recorded on every outcome event (10-a). */
  moduleHash?: string;
  /**
   * Must settle after `signal` aborts. The controller does not wait past its deadline either
   * way, so an adapter that ignores abort only leaks its own process; it cannot hold a cycle.
   */
  start(req: RunRequest, signal: AbortSignal): Promise<RunOutcome>;
  /**
   * Reads a run whose controller is gone from its folder, parsed as `start` would have; with
   * `stop`, ends a running one first. Absent on an adapter whose runs cannot outlive the
   * controller (the in-process test doubles): recover takes their runs as gone (11-f).
   */
  look?(runId: string, runDir: string, stop: boolean): Promise<Left>;
}
