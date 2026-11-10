/**
 * Opens the owner's factory for a program that drives the engine, such as the CLI or the TUI:
 * the module at `path`, whose default export is the engine's options, with its log relative to it.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createEngine as Create } from "../src/engine.ts";
import { isRecord } from "../src/json.ts";

export type Engine = ReturnType<typeof Create>;

/** The engine over the factory at `path`, and the names of the factory's workflows. */
export async function openFactory(path: string): Promise<{ engine: Engine; workflows: string[] }> {
  // node:sqlite warns that it is experimental on every start; stderr is for errors only, so the
  // engine is imported once that warning is dropped.
  process.removeAllListeners("warning");

  process.on("warning", (warning) => {
    if (warning.name !== "ExperimentalWarning") {
      process.stderr.write(`${warning.stack}\n`);
    }
  });

  const { createEngine } = await import("../src/engine.ts");
  const module = resolve(path);
  const options = (await import(pathToFileURL(module).href)).default;

  refuseFactory(module, isRecord(options) ? Object.keys(options) : []);

  const log = resolve(dirname(module), options.log);

  mkdirSync(dirname(log), { recursive: true });

  const engine = createEngine({
    log,
    workflows: options.workflows,
    kinds: options.kinds,
    defaults: options.defaults,
    triggers: options.triggers,
  });

  return { engine, workflows: Object.keys(options.workflows) };
}

// The factory module is the owner's code, so its shape is checked here, before the engine sees it;
// a misspelled key would otherwise be dropped and fail later, far from the cause.
function refuseFactory(path: string, given: readonly string[]): void {
  const keys = ["log", "kinds", "workflows", "defaults"];
  const missing = keys.filter((key) => !given.includes(key));
  const extra = given.filter((key) => !keys.includes(key) && key !== "triggers");

  if (missing.length > 0 || extra.length > 0) {
    const problems = [
      ...(missing.length > 0 ? [`missing ${missing.join(", ")}`] : []),
      ...(extra.length > 0 ? [`not allowed ${extra.join(", ")}`] : []),
    ];

    throw new Error(
      `Factory ${path} must default-export { log, kinds, workflows, defaults } and any triggers: ${problems.join(", ")}.`,
    );
  }
}
