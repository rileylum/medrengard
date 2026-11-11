/**
 * Where the programs this package ships are, for a factory that names one in a step or runs one
 * itself: a harness adapter as an agent's `harness.run`, the CLI as a service's command.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Real, because a step's sandbox grants a program's real directory, not a link to it in node_modules.
const at = (path: string) => realpathSync(fileURLToPath(new URL(path, import.meta.url)));

/** The path of the CLI and of each harness adapter, each run by Node. */
export const programs = {
  medrengard: at("../cli/medrengard.ts"),
  claudeCode: at("../adapters/claude-code.ts"),
  codex: at("../adapters/codex.ts"),
} as const;
