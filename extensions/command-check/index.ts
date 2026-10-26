import type { StageContext } from '../../src/index.ts';

/** A check stage's code: runs argv in the stage's access; exit 0 is PASS, any other exit FAIL, with the output kept. */
export function commandCheck(argv: string[]) {
  return async (context: StageContext) => {
    if (!context.subject) throw new Error('check needs a subject');
    const run = await context.execute(argv);
    if (run.status !== 'exited' || run.exitCode === null) throw new Error(`check did not finish: ${run.status}`);
    const verdict = run.exitCode === 0 ? 'PASS' : 'FAIL';
    return { outcome: verdict, artifact: { kind: 'verdict', verdict, subject: context.subject, findings: [], content: run.stdout + run.stderr } };
  };
}
