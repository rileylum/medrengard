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

export interface Adapter {
  readonly name: string;
  /**
   * Must settle after `signal` aborts. The controller does not wait past its deadline either
   * way, so an adapter that ignores abort only leaks its own process; it cannot hold a cycle.
   */
  start(req: RunRequest, signal: AbortSignal): Promise<RunOutcome>;
}
