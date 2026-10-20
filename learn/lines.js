// What `node src/main.ts events` prints, read from the store stand-in's rows (shims/store.js)
// instead of SQLite. The steps of src/stream.ts#openStream: rows in `pos` order, each cycle
// replayed from its open row under the workflow it recorded, a row it cannot replay passed on with
// null stages. src/stream.ts opens SQLite itself, so the browser cannot run it; keep this in step.
import { apply, checkWorkflow, defaultWorkflow, isEvent, newCycle } from '/src/lifecycle.ts';
import { DEFAULT_RECORD, workflowHash } from './shims/store.js';

/** Every line after `after`, for one work ID or all of them. */
export function lines(table, { workId, after = 0 } = {}) {
  const cycles = new Map();
  const out = [];
  for (const r of [...table].sort((a, b) => a.pos - b.pos)) {
    const body = JSON.parse(r.body);
    if (r.seq === 0) {
      const { hash } = body.workflow ?? DEFAULT_RECORD;
      const workflow = [body.definition, defaultWorkflow].find((w) => w !== undefined && checkWorkflow(w).length === 0 && workflowHash(w) === hash);
      cycles.set(r.cycle_id, { workId: body.workId, workflow, cycle: workflow && newCycle(r.cycle_id, body.workId, body.parentCycleId) });
      continue;
    }
    const c = cycles.get(r.cycle_id);
    if (workId !== undefined && c.workId !== workId) continue;
    let step = { from: null, stage: null, escalation: null };
    if (c.cycle && isEvent(body)) {
      c.cycle = apply(c.cycle, body, c.workflow);
      const h = c.cycle.history.at(-1);
      step = { from: h.from, stage: h.to, escalation: c.cycle.escalation ?? null };
    } else c.cycle = undefined;
    if (r.pos > after) out.push({ seq: r.pos, at: r.at, cycleId: r.cycle_id, workId: c.workId, event: body, ...step });
  }
  return out;
}
