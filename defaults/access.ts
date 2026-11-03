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

/**
 * What headless Claude Code needs through the adapter in `adapters/`: Node to run the adapter and npm,
 * the `claude` executable, the network, the subscription token in the adapter's default token file
 * and a Git identity to commit with. Its home is empty, so the owner's settings, skills, hooks and
 * MCP servers never load.
 */
export const claudeCode: Access = {
  paths: [
    ...system,
    tmp,
    { path: ownerHome, mode: "empty", size: 256 * 1024 * 1024 },
    // Node and npm, which may be under the owner's home.
    ...node,
    { path: join(import.meta.dirname, "..", "adapters"), mode: "read" },
    // A symlink to the current version; bwrap binds the version it points to when the step starts.
    { path: join(ownerHome, ".local", "bin", "claude"), mode: "read" },
    // Read by the adapter, which hides it from the agent; never in the environment.
    { path: join(ownerHome, ".config", "medrengard", "claude-token"), mode: "read" },
  ],
  network: true,
  environment: [
    "PATH",
    "HOME",
    "LANG",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
  ],
  workspace: "write",
  // The adapter runs claude in a sandbox of its own, which refuses them to what the agent runs.
  sandboxes: true,
};
