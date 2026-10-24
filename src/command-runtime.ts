import type { Runtime, AgentRequest, StageContext } from './primitives.ts';
import type { RunResult } from './runtime/spawn.ts';

/** A portable JSON runtime: a sandboxed command receives the request and artifacts as JSON on stdin. */
export function commandRuntime(command: string[]): Runtime {
  const runs = new Map<string, { abort: AbortController; result: Promise<RunResult> }>();
  return {
    async start(request: AgentRequest, context: StageContext) {
      if (runs.has(request.runId)) throw new Error('runtime run already started');
      const abort = new AbortController();
      runs.set(request.runId, { abort, result: context.execute(command, { signal: abort.signal, input: JSON.stringify({ ...request, artifacts: context.artifacts }) }) });
    },
    async result(runId) {
      const result = await runs.get(runId)!.result;
      if (result.status !== 'exited' || result.exitCode !== 0) throw new Error(`runtime ${result.status}: ${result.stderr}`);
      return JSON.parse(result.stdout);
    },
    async cancel(runId) { runs.get(runId)!.abort.abort(); await runs.get(runId)!.result; },
    async *events(runId) { const result = await runs.get(runId)!.result; yield { type: 'exit', status: result.status, exitCode: result.exitCode }; },
  };
}
