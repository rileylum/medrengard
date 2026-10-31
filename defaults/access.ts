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

// A fresh /tmp. On a RAM-backed tmpfs every byte holds memory, so it is bounded.
const tmp = { path: "/tmp", mode: "empty" as const, size: 256 * 1024 * 1024 };

/** Everything the engine can reach: in practice, no sandbox. */
export const full: Access = {
  paths: [{ path: "/", mode: "write" }],
  network: true,
  environment: "all",
  workspace: "write",
};

/** The system, and the owner's home to read and write, with the network and environment. */
export const home: Access = {
  paths: [...system, tmp, { path: ownerHome, mode: "write" }],
  network: true,
  environment: "all",
  workspace: "write",
};

/** Only what the step contract gives a step, and the system's programs to run in it. */
export const contract: Access = {
  paths: [...system, tmp],
  network: false,
  environment: [],
  workspace: "write",
};

/**
 * What headless Claude Code needs through the adapter in `adapters/`: Node to run the adapter,
 * the `claude` executable, the network, the subscription token in `CLAUDE_CODE_OAUTH_TOKEN` and a
 * Git identity to commit with. Its home is empty, so the owner's settings, skills, hooks and MCP
 * servers never load.
 */
export const claudeCode: Access = {
  paths: [
    ...system,
    tmp,
    { path: ownerHome, mode: "empty", size: 256 * 1024 * 1024 },
    // Node's installation, which may be under the owner's home.
    { path: dirname(dirname(process.execPath)), mode: "read" },
    { path: join(import.meta.dirname, "..", "adapters"), mode: "read" },
    // A symlink to the current version; bwrap binds the version it points to when the step starts.
    { path: join(ownerHome, ".local", "bin", "claude"), mode: "read" },
  ],
  network: true,
  environment: [
    "HOME",
    "LANG",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
  ],
  workspace: "write",
};
