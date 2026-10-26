import type { AgentRequest, RunResult, Runtime, StageContext } from '../../src/index.ts';

type Output = AgentRequest['produces'];

/** Tools for each output; every set runs with permissions bypassed, because the sandbox is the boundary (A-148). */
export const DEFAULT_TOOLS: Record<Output, string[]> = {
  document: ['Read', 'Grep', 'Glob', 'Skill'],
  // Reviewers run `git diff` and the tests in their disposable copy.
  verdict: ['Read', 'Grep', 'Glob', 'Skill', 'Bash'],
  commit: ['Read', 'Grep', 'Glob', 'Skill', 'Bash', 'Edit', 'Write'],
};

// Structured results keep what the workflow acts on apart from what the owner reads.
const VERDICT_SCHEMA = JSON.stringify({
  type: 'object', additionalProperties: false, required: ['verdict', 'findings', 'summary'],
  properties: {
    verdict: { enum: ['PASS', 'FAIL'] },
    findings: { type: 'array', items: { type: 'string' }, description: 'Problems that must be fixed before the owner sees the change; empty on PASS.' },
    summary: { type: 'string', description: 'A short review for the owner: what you checked, what you ran, and any concerns that do not block.' },
  },
});
const COMMIT_SCHEMA = JSON.stringify({
  type: 'object', additionalProperties: false, required: ['message', 'report', 'deviations'],
  properties: {
    message: { type: 'string', description: 'The commit message: a summary line under 72 characters, a blank line, then what changed and why.' },
    report: { type: 'string', description: 'For the owner: what you did, which tests you ran and their result.' },
    deviations: { type: 'array', items: { type: 'string' }, description: 'Each way the change departs from the approved plan, and why; empty if none.' },
  },
});
// One event must stay under the controller's 1 MiB claim limit once wrapped.
const MAX_LINE = 512 * 1024;
const FAILURE_TAIL = 8000;

/** The default prompt: the input, the plan, what failed on the current commit, the change to review and the owner's feedback. */
export function defaultPrompt(request: AgentRequest, context: StageContext): string {
  // A document bound to a subject, such as a PR link, is evidence rather than the plan.
  const plan = context.artifacts.findLast(a => a.kind === 'document' && !a.subject);
  const failures = request.produces === 'commit' ? context.artifacts.filter(a => a.kind === 'verdict' && a.verdict === 'FAIL' && a.subject === context.subject) : [];
  const recorded = request.produces === 'verdict' ? context.artifacts.filter(a => a.kind === 'verdict' && a.subject === context.subject) : [];
  return [
    request.input,
    plan && `${request.produces === 'document' ? 'Previous plan' : 'Approved plan'}:\n${plan.content}`,
    ...failures.map(a => [`${a.stage} FAIL:`, ...a.findings!.map(f => `- ${f}`), ...a.content ? [a.content.slice(-FAILURE_TAIL)] : []].join('\n')),
    recorded.length && ['Already recorded for this commit:', ...recorded.map(a => `- ${a.stage}: ${a.verdict}`)].join('\n'),
    request.produces === 'verdict' && context.base && `Review the change ${context.base}..${context.subject}: run \`git diff ${context.base} HEAD\` in your workspace to see it.`,
    request.feedback && `Owner feedback:\n${request.feedback}`,
  ].filter(Boolean).join('\n\n') + '\n';
}

/** Runs headless Claude Code in the agent's sandbox and turns its result into the artifact the stage produces. */
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
  /** Replaces the default tool set for an output. */
  tools?: Partial<Record<Output, string[]>>;
  /** Builds the prompt; wrap `defaultPrompt` to add to it. */
  prompt?: (request: AgentRequest, context: StageContext) => string;
  /**
   * Who commits a developer's work. `runtime` (default) commits everything left in the clone after the session, with
   * `author`; `agent` takes HEAD as the agent left it, so the agent needs a Git identity, e.g. `GIT_AUTHOR_NAME` in `env`.
   */
  commit?: 'runtime' | 'agent';
  author?: { name: string; email: string };
}): Runtime {
  const runs = new Map<string, { abort: AbortController; done: Promise<RunResult>; lines: unknown[]; result?: any; wake(): void; finished: boolean; request: AgentRequest; context: StageContext }>();
  return {
    async start(request, context) {
      if (runs.has(request.runId)) throw new Error('runtime run already started');
      // lazy: MCP servers are refused; pass them with --mcp-config when an agent declares one.
      if (Object.keys(request.agent.mcpServers).length) throw new Error('claude code runtime does not pass MCP servers yet');
      const tools = options.tools?.[request.produces] ?? DEFAULT_TOOLS[request.produces];
      const argv = [...options.command, '-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
        '--setting-sources', (options.settingSources ?? ['user']).join(','), ...(options.model ? ['--model', options.model] : []),
        '--permission-mode', 'bypassPermissions', '--tools', tools.join(','), '--strict-mcp-config',
        ...(request.produces === 'verdict' ? ['--json-schema', VERDICT_SCHEMA] : []),
        ...(request.produces === 'commit' && (options.commit ?? 'runtime') === 'runtime' ? ['--json-schema', COMMIT_SCHEMA] : []),
        '--append-system-prompt', request.agent.role, ...request.agent.skills.flatMap(skill => ['--plugin-dir', skill])];
      const abort = new AbortController();
      const run = { abort, lines: [] as unknown[], result: undefined as any, wake() {}, finished: false, request, context, done: undefined as unknown as Promise<RunResult> };
      let partial = '';
      const take = (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try { event = JSON.parse(line); } catch { event = { type: 'output', line: line.slice(0, MAX_LINE) }; }
        if (event?.type === 'result') run.result = event;
        run.lines.push(Buffer.byteLength(line) > MAX_LINE ? { type: 'oversized', bytes: Buffer.byteLength(line), head: line.slice(0, 64 * 1024) } : event);
        run.wake();
      };
      run.done = context.execute(argv, { signal: abort.signal, input: (options.prompt ?? defaultPrompt)(request, context), buffer: false, onStdout: chunk => {
        const lines = (partial + chunk).split('\n');
        partial = lines.pop()!;
        lines.forEach(take);
      } }).finally(() => { take(partial); run.finished = true; run.wake(); });
      runs.set(request.runId, run);
    },
    async *events(runId) {
      const run = runs.get(runId)!;
      while (true) {
        while (run.lines.length) yield run.lines.shift();
        if (run.finished) return;
        await new Promise<void>(resolve => { run.wake = resolve; });
      }
    },
    async result(runId) {
      const run = runs.get(runId)!;
      const exit = await run.done;
      const output = run.result;
      if (exit.status !== 'exited' || exit.exitCode !== 0) throw new Error(`claude ${exit.status}: ${output?.result ?? exit.stderr}`);
      if (!output || output.is_error || typeof output.result !== 'string') throw new Error(`claude reported an error: ${output?.result ?? output?.subtype ?? 'no result'}`);
      const { request, context } = run;
      if (request.produces === 'document') return { outcome: 'done', artifact: { kind: 'document', content: output.result } };
      if (request.produces === 'verdict') {
        const { verdict, findings, summary } = output.structured_output ?? {};
        if (!['PASS', 'FAIL'].includes(verdict)) throw new Error('claude returned no verdict');
        return { outcome: verdict, artifact: { kind: 'verdict', verdict, findings, subject: context.subject, content: summary } };
      }
      if ((options.commit ?? 'runtime') === 'agent') {
        const head = await context.execute(['git', 'rev-parse', 'HEAD']);
        return { outcome: 'done', artifact: { kind: 'commit', sha: head.stdout.trim(), content: output.result } };
      }
      const { message, report, deviations } = output.structured_output ?? {};
      if (typeof message !== 'string' || !message.trim() || typeof report !== 'string' || !Array.isArray(deviations)) throw new Error('claude returned no commit message, report and deviations');
      const author = options.author ?? { name: 'Medrengard', email: 'medrengard@localhost' };
      const script = 'set -e; git add -A; git diff --cached --quiet || git -c user.name="$1" -c user.email="$2" commit -q --cleanup=verbatim -F -; git rev-parse HEAD';
      const commit = await context.execute(['sh', '-c', script, 'commit', author.name, author.email], { input: message });
      if (commit.status !== 'exited' || commit.exitCode !== 0) throw new Error(`cannot commit the developer's work: ${commit.stderr}`);
      const content = deviations.length ? `${report}\n\nDeviations from the plan:\n${deviations.map(d => `- ${d}`).join('\n')}` : report;
      // A departure from the approved plan is its own outcome, so a workflow can stop for the owner before review.
      return { outcome: deviations.length ? 'deviated' : 'done', artifact: { kind: 'commit', sha: commit.stdout.trim(), content } };
    },
    async cancel(runId) { runs.get(runId)!.abort.abort(); await runs.get(runId)!.done; },
  };
}
