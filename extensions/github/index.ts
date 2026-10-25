import { execFileSync } from 'node:child_process';
import type { StageContext } from '../../src/index.ts';

// GitHub refuses a PR body over 65,536 characters.
const MAX_BODY = 60000;

/**
 * A publication stage's code: trusted host code using the owner's `git` and `gh`. It pushes the accepted SHA from the
 * controller's retained copy to one branch per work, so the owner's checkout is never written, and reuses an open PR
 * on that branch rather than opening a second one when it runs again or the owner sends back a revision.
 */
export function githubPullRequest(options: {
  /** The owner's repository; its remote and `gh`'s repository come from here. */
  repository: string;
  remote?: string;
  /** Opens the PR as a draft; on by default. */
  draft?: boolean;
  branch?: (work: string) => string;
  /** The `gh` executable and any leading arguments. */
  gh?: string[];
}) {
  return async (context: StageContext) => {
    const sha = context.subject;
    const commit = context.artifacts.findLast(a => a.kind === 'commit' && a.sha === sha);
    if (!sha || !commit?.repository) throw new Error('publication needs a retained commit as its subject');
    const branch = (options.branch ?? (work => `medrengard/${work}`))(context.work);
    const run = (argv: string[], input?: string) => execFileSync(argv[0], argv.slice(1), { cwd: options.repository, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 }).trim();
    const url = run(['git', 'remote', 'get-url', options.remote ?? 'origin']);
    run(['git', '-C', commit.repository, 'push', '--quiet', url, `+${sha}:refs/heads/${branch}`]);
    const plan = context.artifacts.findLast(a => a.kind === 'document' && !a.subject)?.content ?? '';
    const evidence = context.artifacts.filter(a => a.kind === 'verdict' && a.subject === sha)
      .map(a => [`- ${a.stage}: ${a.verdict}`, ...a.findings!.map(f => `  - ${f}`)].join('\n'));
    // The plan goes last, so it is what a body over GitHub's limit loses.
    const body = [`## Change\n\n${commit.content ?? ''}`, `## Evidence for ${sha}\n\n${evidence.join('\n')}`, `## Plan\n\n${plan}`, `Opened by Medrengard work ${context.work}.`].join('\n\n').slice(0, MAX_BODY);
    const gh = options.gh ?? ['gh'];
    let pr = run([...gh, 'pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url // ""']);
    if (pr) run([...gh, 'pr', 'edit', pr, '--body-file', '-'], body);
    else {
      const title = plan.split('\n').map(l => l.replace(/^#+\s*/, '').trim()).find(Boolean)?.slice(0, 120) ?? `Medrengard work ${context.work}`;
      pr = run([...gh, 'pr', 'create', '--head', branch, '--title', title, '--body-file', '-', ...(options.draft ?? true ? ['--draft'] : [])], body).split('\n').at(-1)!;
    }
    return { outcome: 'done', artifact: { kind: 'document', subject: sha, content: pr } };
  };
}
