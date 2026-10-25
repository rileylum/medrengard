import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Controller, type Options, type State } from '../src/index.ts';

const USAGE = `usage: medrengard start "<idea>"
       medrengard show <work>
       medrengard decide <work> <outcome> <hash> ["feedback"]`;

function show(controller: Controller, state: State): string {
  const plan = state.artifacts.findLast(a => a.kind === 'document');
  const feedback = controller.events().filter(e => e.id === state.id && e.type === 'decision' && typeof e.feedback === 'string');
  return [
    `work ${state.id}`,
    `stage ${state.stage}${state.reason ? ` (${state.reason})` : ''}`,
    ...(state.subject ? [`hash ${state.subject}`] : []),
    ...(plan ? ['', plan.content!] : []),
    ...(feedback.length ? ['', 'feedback', ...feedback.map(e => `- ${e.subject}: ${e.feedback}`)] : []),
  ].join('\n') + '\n';
}

const [command, ...args] = process.argv.slice(2);
const arity: Record<string, number[]> = { start: [1], show: [1], decide: [3, 4] };
if (!Object.hasOwn(arity, command ?? '') || !arity[command].includes(args.length)) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}
const factory: { options: Options; workflow: string } = (await import(pathToFileURL(join(process.cwd(), 'factory.ts')).href)).default;
mkdirSync(dirname(factory.options.path), { recursive: true });
const controller = new Controller(factory.options);
try {
  let id = args[0];
  if (command === 'start') { id = randomUUID().slice(0, 8); controller.open(id, factory.workflow, args[0]); }
  if (command === 'decide') controller.decide(id, args[1], args[2], args[3]);
  const state = command === 'show' ? controller.state(id) : await controller.advance(id);
  process.stdout.write(show(controller, state));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  controller.close();
}
