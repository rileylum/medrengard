import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Controller, type Event, type Options, type State } from '../src/index.ts';

const USAGE = `usage: medrengard start "<idea>"
       medrengard show <work>
       medrengard decide <work> <outcome> <hash or sha, or a unique prefix of 7+ characters> ["feedback"]
       medrengard recover <work>`;

const clock = (event: Event | undefined) => event ? new Date(event.time).toTimeString().slice(0, 8) : '';

/** What the owner decides on: the plan before there is code, then the commit and the verdicts on it. */
function show(controller: Controller, state: State): string {
  const events = controller.events().filter(e => e.id === state.id);
  const recorded = (hash: string) => events.find(e => e.type === 'completed' && (e.artifact as { hash?: string })?.hash === hash);
  const commit = state.artifacts.findLast(a => a.kind === 'commit' && a.sha === state.subject);
  const plan = state.artifacts.findLast(a => a.kind === 'document' && !a.subject);
  const feedback = events.filter(e => e.type === 'decision' && typeof e.feedback === 'string');
  const evidence = state.evidence.map(a => a.kind === 'verdict'
    ? [`${a.stage} ${a.verdict} ${clock(recorded(a.hash))}`, ...a.findings!.map(f => `  - ${f}`)].join('\n')
    : `${a.stage} ${a.content}`);
  return [
    `work ${state.id}`,
    `stage ${state.stage}${state.reason ? ` (${state.reason})` : ''}`,
    ...(state.subject ? [`${commit ? 'sha' : 'hash'} ${state.subject}`] : []),
    ...(state.pending ? [`a run is in progress; if no medrengard command is running it, it was interrupted: medrengard recover ${state.id}`] : []),
    ...(commit ? ['', `commit ${clock(recorded(commit.hash))}`, commit.content ?? ''] : plan ? ['', plan.content!] : []),
    ...(commit && evidence.length ? ['', ...evidence] : []),
    ...(feedback.length ? ['', 'feedback', ...feedback.map(e => `- ${e.subject}: ${e.feedback}`)] : []),
  ].join('\n') + '\n';
}

/** One line per stage start and result, as the controller records them. */
function progress(event: Event): void {
  const artifact = event.artifact as { stage?: string; kind?: string; verdict?: string } | undefined;
  const line = event.type === 'started' ? `started ${event.stage}`
    : event.type === 'completed' ? `${artifact?.stage} ${artifact?.kind === 'verdict' ? artifact.verdict : 'done'}`
    : event.type === 'escalated' ? `escalated: ${event.reason}` : undefined;
  if (line) process.stderr.write(`${clock(event)} ${line}\n`);
}

const [command, ...args] = process.argv.slice(2);
const arity: Record<string, number[]> = { start: [1], show: [1], decide: [3, 4], recover: [1] };
if (!Object.hasOwn(arity, command ?? '') || !arity[command].includes(args.length)) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}
let controller: Controller | undefined;
try {
  const factory: { options: Options; workflow: string } = (await import(pathToFileURL(join(process.cwd(), 'factory.ts')).href)).default;
  mkdirSync(dirname(factory.options.path), { recursive: true });
  controller = new Controller(factory.options);
  controller.observe(progress);
  let id = args[0];
  if (command === 'start') {
    id = randomUUID().slice(0, 8);
    controller.open(id, factory.workflow, args[0]);
    process.stderr.write(`work ${id}\n`);
  }
  if (command === 'decide') {
    // The core binds a decision to the exact subject; a prefix only ever resolves to the current one.
    const current = controller.state(id).subject;
    const subject = args[2].length >= 7 && current?.startsWith(args[2]) ? current : args[2];
    try { controller.decide(id, args[1], subject, args[3]); }
    catch (error) {
      if (error instanceof Error && error.message === 'stale owner decision' && current) throw new Error(`stale owner decision; the current one is ${current}`);
      throw error;
    }
  }
  if (command === 'recover') controller.recover(id);
  const state = command === 'show' || command === 'recover' ? controller.state(id) : await controller.advance(id);
  process.stdout.write(show(controller, state));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  controller?.close();
}
