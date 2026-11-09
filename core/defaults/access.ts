// The default access a workflow can give its steps, as values: use one as it is, spread it and
// change a dial, or write your own. The engine knows none of them; a commission records the
// dials themselves, in its definition.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Access } from "../src/replay.ts";

const ownerHome = homedir();

// The system's programs, libraries and configuration, read-only. Not /home, /var, /run or /srv:
// those hold the owner's files and sockets. Some systems lack some of these.
const system = ["/usr", "/etc", "/opt", "/bin", "/sbin", "/lib", "/lib64"].flatMap((path) =>
  existsSync(path) ? [{ path, mode: "read" as const }] : [],
);

// Node and npm, wherever Node is installed, and nothing else installed beside them: its bin
// directory, whose npm and npx link into npm's package, and that package. A Node without npm
// beside it, such as a lone binary in ~/bin, is granted alone, never the directory it sits in.
const installed = dirname(dirname(process.execPath));
const npm = join(installed, "lib", "node_modules", "npm");

const node = (existsSync(npm) ? [dirname(process.execPath), npm] : [process.execPath]).map(
  (path) => ({ path, mode: "read" as const }),
);

// A fresh /tmp. On a RAM-backed tmpfs every byte holds memory, so it is bounded.
const tmp = { path: "/tmp", mode: "empty" as const, size: 256 * 1024 * 1024 };

/** Only what the step contract gives a step, and the system's programs to run in it. */
export const contract: Access = {
  paths: [...system, tmp],
  network: false,
  environment: ["PATH"],
  workspace: "write",
  sandboxes: false,
};

/** The variables that make Git author and commit as `name` and `email`, for an access's values. */
export function gitIdentity(name: string, email: string) {
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

/**
 * What headless Claude Code needs through the adapter in `adapters/`: Node to run the adapter and
 * npm, the `claude` executable, its broker, the only way to the model API, which holds the
 * subscription token from its default token file outside the sandbox, and a Git identity to commit
 * with, Medrengard's unless a factory sets its own with gitIdentity. It reaches no host itself.
 * Its home is empty, so the owner's settings, skills, hooks and MCP servers never load.
 */
export const claudeCode = {
  paths: [
    ...system,
    tmp,
    { path: ownerHome, mode: "empty", size: 256 * 1024 * 1024 },
    // Node and npm, which may be under the owner's home.
    ...node,
    { path: join(import.meta.dirname, "..", "adapters"), mode: "read" },
    // A symlink to the current version; bwrap binds the version it points to when the step starts.
    { path: join(ownerHome, ".local", "bin", "claude"), mode: "read" },
  ],
  // Only the broker, so nothing the agent runs can reach anywhere else. A factory lists hosts, as
  // `{ ...claudeCode, network: { ...claudeCode.network, hosts: ["registry.npmjs.org"] } }`.
  network: {
    hosts: [],
    brokers: {
      anthropic: [
        process.execPath,
        join(import.meta.dirname, "..", "adapters", "claude-code-broker.ts"),
      ],
    },
  },
  environment: ["PATH", "HOME", "LANG"],
  values: gitIdentity("Medrengard", "medrengard@localhost"),
  workspace: "write",
  // The adapter runs claude in a sandbox of its own, which refuses them to what the agent runs.
  sandboxes: true,
} satisfies Access;

// Codex's npm package, beside npm's, where npm installs it globally; it holds the native codex.
const codexPackage = join(installed, "lib", "node_modules", "@openai", "codex");

/**
 * What headless Codex needs through the adapter in `adapters/`: Node to run the adapter and npm,
 * Codex's package, which `codex` in Node's bin directory runs, its broker, the only way to the
 * model, which holds Medrengard's Codex login from its default directory outside the sandbox, and
 * a Git identity to commit with, Medrengard's unless a factory sets its own with gitIdentity. It
 * reaches no host itself. Its home is empty, and the adapter makes Codex a home of its own, so the
 * owner's configuration, skills and sessions never load.
 */
export const codex = {
  paths: [
    ...system,
    tmp,
    { path: ownerHome, mode: "empty", size: 256 * 1024 * 1024 },
    ...node,
    { path: join(import.meta.dirname, "..", "adapters"), mode: "read" },
    ...(existsSync(codexPackage) ? [{ path: codexPackage, mode: "read" as const }] : []),
  ],
  // Only the broker, so nothing the agent runs can reach anywhere else. A factory lists hosts, as
  // `{ ...codex, network: { ...codex.network, hosts: ["registry.npmjs.org"] } }`.
  network: {
    hosts: [],
    brokers: {
      openai: [process.execPath, join(import.meta.dirname, "..", "adapters", "codex-broker.ts")],
    },
  },
  environment: ["PATH", "HOME", "LANG"],
  values: gitIdentity("Medrengard", "medrengard@localhost"),
  workspace: "write",
  // Codex runs with no sandbox of its own: the step's is its boundary.
  sandboxes: false,
} satisfies Access;
