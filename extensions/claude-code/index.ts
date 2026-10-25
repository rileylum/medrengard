import type { AgentRequest, Runtime, StageContext } from '../../src/index.ts';

type RunResult = Awaited<ReturnType<StageContext['execute']>>;

/** Runs headless Claude Code in the agent's sandbox; its final message becomes the stage's document. */
export function claudeCodeRuntime(options: {
  /** The `claude` executable and any leading arguments; the agent's sandbox must be able to read it. */
  command: string[];
  /**
   * Defaults to `user`, which is empty under the sandbox's private home. `project` loads the repository's
   * `.claude/` settings, including hooks and permission rules: use it only for a repository you trust.
   */
  settingSources?: ('user' | 'project' | 'local')[];
  /** Passed to `--model` unchanged, e.g. `opus` or a full model ID; Claude Code's default when absent. */
  model?: string;
}): Runtime {
  const runs = new Map<string, { abort: AbortController; result: Promise<RunResult> }>();
  return {
    async start(request: AgentRequest, context: StageContext) {
      if (runs.has(request.runId)) throw new Error('runtime run already started');
      // lazy: MCP servers are refused; pass them with --mcp-config when an agent declares one.
      if (Object.keys(request.agent.mcpServers).length) throw new Error('claude code runtime does not pass MCP servers yet');
      const argv = [...options.command, '-p', '--output-format', 'json', '--no-session-persistence',
        '--setting-sources', (options.settingSources ?? ['user']).join(','),
        // Skill loads the agent's plugin skills; without it they register but cannot be used.
        ...(options.model ? ['--model', options.model] : []), '--tools', 'Read,Grep,Glob,Skill', '--strict-mcp-config', '--append-system-prompt', request.agent.role,
        ...request.agent.skills.flatMap(skill => ['--plugin-dir', skill])];
      const previous = context.artifacts.findLast(a => a.kind === 'document');
      const prompt = [request.input, previous && `Previous plan:\n${previous.content}`, request.feedback && `Owner feedback:\n${request.feedback}`];
      const abort = new AbortController();
      runs.set(request.runId, { abort, result: context.execute(argv, { signal: abort.signal, input: `${prompt.filter(Boolean).join('\n\n')}\n` }) });
    },
    async result(runId) {
      const run = await runs.get(runId)!.result;
      if (run.status !== 'exited' || run.exitCode !== 0) throw new Error(`claude ${run.status}: ${run.stderr || run.stdout}`);
      const output = JSON.parse(run.stdout);
      if (output.is_error || typeof output.result !== 'string') throw new Error(`claude reported an error: ${output.result ?? output.subtype}`);
      return { outcome: 'done', artifact: { kind: 'document', content: output.result } };
    },
    async cancel(runId) { runs.get(runId)!.abort.abort(); await runs.get(runId)!.result; },
    async *events(runId) { const run = await runs.get(runId)!.result; yield { type: 'exit', status: run.status, exitCode: run.exitCode }; },
  };
}
