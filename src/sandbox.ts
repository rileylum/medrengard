import { resolve } from "node:path";
import type { Access } from "./replay.ts";

// The directories the step contract always gives a step, by path.
type Areas = { workspace: string; input: string; output: string };

const order = { write: 0, empty: 1, read: 2 };

/**
 * The bubblewrap command that runs `argv` in `areas.workspace` under `access`, and the
 * environment to start it with.
 */
export function confine(access: Access, areas: Areas, argv: readonly [string, ...string[]]) {
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

  return {
    command: "bwrap",
    args: [
      // --unshare-all includes the PID namespace, so nothing the step starts outlives bwrap, and
      // bwrap dies with the engine.
      "--die-with-parent",
      "--unshare-all",
      ...(access.network ? ["--share-net"] : []),
      ...binds,
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      ...root,
      "--chdir",
      areas.workspace,
      "--",
      ...argv,
    ],
    env: {
      ...passed,
      PATH: process.env.PATH,
      MEDRENGARD_IN: areas.input,
      MEDRENGARD_OUT: areas.output,
    },
  };
}
