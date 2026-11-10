import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Access } from "./definition.ts";

// The directories the step contract always gives a step, by path; the record's: the log's
// directory, which every program is kept out of; and where its scratch areas go, on disk beside
// its workspace, so its disk limit counts them.
type Areas = { workspace: string; input: string; output: string; record: string; scratch: string };

const order = { write: 0, empty: 1, scratch: 1, read: 2, hidden: 3 };

/** What a program may use at once: bytes of memory, and processes and threads. */
export type Bounds = { memory: number; processes: number };

/**
 * Where a step that may reach only some hosts finds the engine's: its proxy's socket, and each of
 * its brokers' by name.
 */
export type Network = { proxy: string; brokers: ReadonlyMap<string, string> };

// What systemd-run needs to reach the owner's systemd, and what the scope adds; a step has them
// only when its access names them.
const scoped = ["XDG_RUNTIME_DIR", "INVOCATION_ID"];

const runtime = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`;

/**
 * systemd-run's arguments, before the command they run, that put it in a scope of the owner's
 * systemd named `unit`, which holds its memory and processes within `bounds`.
 */
export function scope(unit: string, bounds: Bounds): string[] {
  return [
    "--user",
    "--scope",
    "--quiet",
    // Otherwise systemd-run replaces $NAME in the command's own arguments, and $$ with $.
    "--expand-environment=no",
    "--unit",
    unit,
    "-p",
    `MemoryMax=${bounds.memory}`,
    // Swap would let a program past its memory limit by slowing the machine instead.
    "-p",
    "MemorySwapMax=0",
    "-p",
    `TasksMax=${bounds.processes}`,
    "--",
  ];
}

/**
 * The command that runs `argv` outside any sandbox, with `env`, in a scope of the owner's systemd
 * that holds it within `bounds`, and the scope's unit.
 */
export function inScope(argv: readonly string[], bounds: Bounds, env: NodeJS.ProcessEnv) {
  const unit = `medrengard-${randomUUID()}`;

  return {
    unit,
    command: "systemd-run",
    args: [...scope(unit, bounds), ...argv],
    env: { XDG_RUNTIME_DIR: runtime, ...env },
  };
}

/**
 * The command that runs `argv` in `areas.workspace`, which it sees as /workspace, under `access`, within `bounds`, the
 * environment to start it with, and the systemd scope it runs in: bubblewrap, in a scope of the
 * owner's systemd, which holds its memory and processes.
 */
export function confine(
  access: Access,
  areas: Areas,
  argv: readonly [string, ...string[]],
  bounds: Bounds,
  network?: Network,
) {
  // The step contract's directories, where the program sees them: fixed paths that name nothing of
  // the owner's machine, the same for every step. A step given / sees the machine as it is, its
  // areas where the engine keeps them, since its own root has no place for them.
  const seen = access.paths.some(({ path }) => path === "/")
    ? areas
    : { workspace: "/workspace", input: "/input", output: "/output" };

  // Each scratch area a fresh directory of its own, made here so the mount has something to bind.
  const mounts = [
    ...access.paths.map((entry, index) => {
      if (entry.mode !== "scratch") return { ...entry, source: entry.path };

      const source = join(areas.scratch, String(index));

      mkdirSync(source, { recursive: true });

      return { ...entry, source };
    }),
    { source: areas.workspace, path: seen.workspace, mode: access.workspace },
    { source: areas.input, path: seen.input, mode: "read" as const },
    { source: areas.output, path: seen.output, mode: "write" as const },
    // Whatever the access, a program cannot reach the log or store, so it cannot write a
    // decision; only a path the access names under it, and its own areas, are seen there.
    { source: areas.record, path: areas.record, mode: "hidden" as const },
  ];

  const depth = (path: string) => resolve(path).split("/").filter(Boolean).length;

  // A later mount hides what is under it, so parents go first and a nested path keeps its own
  // mode. On the same path read goes last, so it wins, and hidden after it.
  const sorted = mounts.toSorted(
    (one, other) => depth(one.path) - depth(other.path) || order[one.mode] - order[other.mode],
  );

  const binds = sorted.flatMap((mount) => {
    switch (mount.mode) {
      case "read":
        return ["--ro-bind", mount.source, mount.path];
      case "write":
      case "scratch":
        return ["--bind", mount.source, mount.path];
      case "empty":
        return ["--size", String(mount.size), "--tmpfs", mount.path];
      case "hidden":
        return ["--tmpfs", mount.path];
    }
  });

  // bwrap's own root is a tmpfs: read-only, so nothing outside the declared paths takes writes,
  // or memory. A step given / itself has that mount instead, in its declared mode.
  const root = access.paths.some(({ path }) => path === "/") ? [] : ["--remount-ro", "/"];

  const passed = {
    ...(access.environment === "all"
      ? process.env
      : Object.fromEntries(access.environment.map((name) => [name, process.env[name]]))),
    ...access.values,
  };

  const unit = `medrengard-${randomUUID()}`;

  // A step that may reach only some hosts has loopback alone: the forwarder there relays to the
  // engine's proxy, which decides, and to each broker. This Node and the forwarder are bound in to
  // run it.
  const brokers = [...(network?.brokers ?? [])];

  const forwarding =
    network === undefined
      ? []
      : [
          "--ro-bind",
          process.execPath,
          "/network/node",
          "--ro-bind",
          join(import.meta.dirname, "forward.ts"),
          "/network/forward.mts",
          "--bind",
          network.proxy,
          "/network/socket",
          ...brokers.flatMap(([name, socket]) => ["--bind", socket, `/network/brokers/${name}`]),
        ];

  const unset =
    access.environment === "all"
      ? []
      : scoped.filter((name) => !access.environment.includes(name) && !Object.hasOwn(passed, name));

  return {
    unit,
    command: "systemd-run",
    args: [
      ...scope(unit, bounds),
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
      ...(access.network === true ? [] : ["--unshare-net"]),
      ...(access.sandboxes ? [] : ["--disable-userns"]),
      ...binds,
      // Before the root is read-only, so their places can be made.
      ...forwarding,
      // Read-only once the mounts under it are made; they are mounts of their own, so keep theirs.
      "--remount-ro",
      areas.record,
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
      seen.workspace,
      "--",
      ...(network === undefined
        ? argv
        : [
            "/network/node",
            "/network/forward.mts",
            "/network/socket",
            ...brokers.map(([name]) => `${name}=/network/brokers/${name}`),
            "--",
            ...argv,
          ]),
    ],
    env: {
      XDG_RUNTIME_DIR: runtime,
      ...passed,
      MEDRENGARD_IN: seen.input,
      MEDRENGARD_OUT: seen.output,
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
