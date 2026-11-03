import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Access } from "./replay.ts";

// The directories the step contract always gives a step, by path.
type Areas = { workspace: string; input: string; output: string };

const order = { write: 0, empty: 1, read: 2 };

/** What a program may use at once: bytes of memory, and processes and threads. */
export type Bounds = { memory: number; processes: number };

// What systemd-run needs to reach the owner's systemd, and what the scope adds; a step has them
// only when its access names them.
const scoped = ["XDG_RUNTIME_DIR", "INVOCATION_ID"];

const runtime = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`;

/**
 * The command that runs `argv` in `areas.workspace` under `access`, within `bounds`, the
 * environment to start it with, and the systemd scope it runs in: bubblewrap, in a scope of the
 * owner's systemd, which holds its memory and processes.
 */
export function confine(
  access: Access,
  areas: Areas,
  argv: readonly [string, ...string[]],
  bounds: Bounds,
) {
  const mounts = [
    ...access.paths,
    { path: areas.workspace, mode: access.workspace },
    { path: areas.input, mode: "read" as const },
    { path: areas.output, mode: "write" as const },
  ];

  const depth = (path: string) => resolve(path).split("/").filter(Boolean).length;

  // A later mount hides what is under it, so parents go first and a nested path keeps its own
  // mode. On the same path read goes last, so it wins.
  const sorted = mounts.toSorted(
    (one, other) => depth(one.path) - depth(other.path) || order[one.mode] - order[other.mode],
  );

  const binds = sorted.flatMap((mount) => {
    switch (mount.mode) {
      case "read":
        return ["--ro-bind", mount.path, mount.path];
      case "write":
        return ["--bind", mount.path, mount.path];
      case "empty":
        return ["--size", String(mount.size), "--tmpfs", mount.path];
    }
  });

  // bwrap's own root is a tmpfs: read-only, so nothing outside the declared paths takes writes,
  // or memory. A step given / itself has that mount instead, in its declared mode.
  const root = access.paths.some(({ path }) => path === "/") ? [] : ["--remount-ro", "/"];

  const passed =
    access.environment === "all"
      ? { ...process.env }
      : Object.fromEntries(access.environment.map((name) => [name, process.env[name]]));

  const unit = `medrengard-${randomUUID()}`;

  const unset =
    access.environment === "all" ? [] : scoped.filter((name) => !access.environment.includes(name));

  return {
    unit,
    command: "systemd-run",
    args: [
      "--user",
      "--scope",
      "--quiet",
      // Otherwise systemd-run replaces $NAME in the step's own arguments, and $$ with $.
      "--expand-environment=no",
      "--unit",
      unit,
      "-p",
      `MemoryMax=${bounds.memory}`,
      // Swap would let a step past its memory limit by slowing the machine instead.
      "-p",
      "MemorySwapMax=0",
      "-p",
      `TasksMax=${bounds.processes}`,
      "--",
      "bwrap",
      ...unset.flatMap((name) => ["--unsetenv", name]),
      // Each namespace by name: --unshare-all only tries for the user and cgroup ones, and carries
      // on without them where the kernel refuses. The PID namespace means nothing the step starts
      // outlives bwrap, and bwrap dies with the engine.
      "--die-with-parent",
      "--unshare-user",
      "--unshare-cgroup",
      "--unshare-ipc",
      "--unshare-uts",
      "--unshare-pid",
      ...(access.network ? [] : ["--unshare-net"]),
      ...(access.sandboxes ? [] : ["--disable-userns"]),
      ...binds,
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      // bwrap's /dev is a writable tmpfs: only shared memory, which programs expect to write, is
      // left writable. Its pages count against the scope's MemoryMax, which bounds it.
      "--tmpfs",
      "/dev/shm",
      "--remount-ro",
      "/dev",
      ...root,
      "--chdir",
      areas.workspace,
      "--",
      ...argv,
    ],
    env: {
      XDG_RUNTIME_DIR: runtime,
      ...passed,
      MEDRENGARD_IN: areas.input,
      MEDRENGARD_OUT: areas.output,
    },
  };
}

/**
 * Whether the program that ran in the scope `unit` was stopped for using more than its memory.
 * systemd keeps a scope that failed until it is reset, so this resets it.
 */
export function overMemory(unit: string): boolean {
  const scope = `${unit}.scope`;

  const env = { ...process.env, XDG_RUNTIME_DIR: runtime };

  const result = execFileSync("systemctl", ["--user", "show", scope, "-p", "Result", "--value"], {
    encoding: "utf8",
    env,
  }).trim();

  if (result !== "success" && result !== "") {
    execFileSync("systemctl", ["--user", "reset-failed", scope], { env });
  }

  return result === "oom-kill";
}
