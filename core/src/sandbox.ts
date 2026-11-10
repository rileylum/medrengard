import { execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statfsSync,
} from "node:fs";
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

// Where a step whose access grants cgroups finds its own control group, and so where an engine
// running in such a step finds the one it runs in.
const hierarchy = "/sys/fs/cgroup";

// Whether this engine runs in a step whose access grants cgroups. No systemd answers it there, and
// its control group is its own to divide, so it holds each program in a group it makes, with the
// same limits. On the owner's machine the hierarchy's root is not the owner's to write.
const delegated = (() => {
  try {
    accessSync(join(hierarchy, "cgroup.subtree_control"), constants.W_OK);

    return true;
  } catch {
    return false;
  }
})();

// Runs the rest in place of the shell. A shell that was not given SHLVL sets it, and sets it again
// as it hands over: a program started through one is given only what its access names, so env
// takes the shell's own away. One that was given it hands it on as it was.
const handOver = `[ "\${SHLVL:-1}" -le 1 ] && exec env -u SHLVL "$@"
exec "$@"`;

// Makes the control group $1 with $2 bytes of memory, no swap and $3 processes, moves into it and
// runs the rest: what systemd-run does, where there is no systemd to ask.
const enter = `mkdir "$1" && echo "$2" > "$1/memory.max" && echo 0 > "$1/memory.swap.max" &&
  echo "$3" > "$1/pids.max" && echo $$ > "$1/cgroup.procs" || exit 125
shift 3
${handOver}`;

// Divides the control group this runs in, $1 or else the one /proc names, so what it runs can make
// groups of its own there: a group holding processes cannot give its children limits, so this one
// moves to a leaf, main, first. The argument equal to $3 becomes the group's path.
//
// systemd forgets a scope once it ends, and says nothing of memory for one it does not manage
// alone. So with $2, a process outside the program's group and session waits for it to end, then
// writes to the file $2 whether the group itself ran out of memory, whatever its own groups did:
// over, or within. The file appears whole, by a rename, and the engine waits for it.
//
// That process is in the group it reports on, so a group out of memory could lose it in place of
// the program. The program and all it starts are therefore made the likelier to be stopped, by
// their score, which they inherit; a program that lowers its own again risks only that the engine
// is told nothing, which fails the attempt as the engine's own.
const divide = `group=\${1:-${hierarchy}$(cut -d: -f3- /proc/self/cgroup)}
marker=$2
sentinel=$3
shift 3
mkdir "$group/main" && echo $$ > "$group/main/cgroup.procs" &&
  echo "+memory +pids" > "$group/cgroup.subtree_control" || exit 125
if [ -n "$marker" ]; then
  setsid sh -c 'while kill -0 "$1" 2> /dev/null; do sleep 0.05; done
    if grep -q "^oom [1-9]" "$2/memory.events.local"; then echo over; else echo within; fi > "$3.part"
    mv "$3.part" "$3"' sh $$ "$group" "$marker" < /dev/null > /dev/null 2>&1 &
  echo 500 > /proc/self/oom_score_adj
fi
for argument; do
  shift
  [ "$argument" = "$sentinel" ] && argument=$group
  set -- "$@" "$argument"
done
${handOver}`;

// How long the engine waits to be told whether a scope ran out of memory, once its program ended.
const answerWait = 5000;

// The scopes whose memory systemd does not answer for, and the file each is answered in.
const markers = new Map<string, string>();

/**
 * The command that runs `argv` held within `bounds`, as the unit `unit`: in a scope of the owner's
 * systemd, or, for an engine in a step whose access grants cgroups, in a control group of its own
 * making. With `divided`, the program may divide its group in turn: its argument `sentinel`
 * becomes the group's path, and `marker` a file left if the group itself runs out of memory.
 */
function held(
  unit: string,
  bounds: Bounds,
  argv: readonly string[],
  divided?: { marker: string; sentinel: string },
) {
  const group = join(hierarchy, unit);

  // A group this engine made is still there to read once its program ends: no file is needed.
  const dividing =
    divided === undefined
      ? []
      : [
          "sh",
          "-c",
          divide,
          "sh",
          delegated ? group : "",
          delegated ? "" : divided.marker,
          divided.sentinel,
        ];

  if (delegated) {
    return {
      command: "sh",
      args: [
        "-c",
        enter,
        "sh",
        group,
        String(bounds.memory),
        String(bounds.processes),
        ...dividing,
        ...argv,
      ],
    };
  }

  if (divided !== undefined) {
    markers.set(unit, divided.marker);
  }

  return {
    command: "systemd-run",
    args: [
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
      // The scope's group is the program's to divide: systemd leaves what is under it alone.
      ...(divided === undefined ? [] : ["-p", "Delegate=yes"]),
      "--",
      ...dividing,
      ...argv,
    ],
  };
}

/**
 * The command that runs `argv` outside any sandbox, with `env`, held within `bounds`, and its unit.
 */
export function inScope(argv: readonly string[], bounds: Bounds, env: NodeJS.ProcessEnv) {
  const unit = `medrengard-${randomUUID()}`;

  return { unit, ...held(unit, bounds, argv), env: { XDG_RUNTIME_DIR: runtime, ...env } };
}

/**
 * The command that runs `argv` in `areas.workspace`, which it sees as /workspace, under `access`, within `bounds`, the
 * environment to start it with, and the unit it runs as: bubblewrap, held within `bounds` as
 * `inScope` holds a program.
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

  // A step given a range of users runs in a user namespace made for it before bubblewrap starts:
  // bubblewrap's own holds one user, and only the machine's helpers may map a range, which
  // unshare asks of them. The step is user 0 there, the owner outside.
  const ranging =
    access.users === "range" ? ["unshare", "--user", "--map-root-user", "--map-auto", "--"] : [];

  // A step that may divide its control group finds it where any program looks for the hierarchy.
  const sentinel = `${unit}.cgroup`;
  const marker = join(areas.scratch, "over-memory");

  if (access.cgroups === true) {
    mkdirSync(areas.scratch, { recursive: true });
  }

  return {
    unit,
    ...held(
      unit,
      bounds,
      [
        ...ranging,
        "bwrap",
        ...unset.flatMap((name) => ["--unsetenv", name]),
        ...(passed.XDG_RUNTIME_DIR === undefined
          ? []
          : ["--setenv", "XDG_RUNTIME_DIR", passed.XDG_RUNTIME_DIR]),
        // Each namespace by name: --unshare-all only tries for the user and cgroup ones, and carries
        // on without them where the kernel refuses. The PID namespace means nothing the step starts
        // outlives bwrap, and bwrap dies with the engine.
        "--die-with-parent",
        ...(access.users === "range" ? [] : ["--unshare-user"]),
        // A group can be moved into only from the namespace it was made in, so a step that divides
        // its own keeps the engine's.
        ...(access.cgroups === true ? [] : ["--unshare-cgroup"]),
        "--unshare-ipc",
        "--unshare-uts",
        "--unshare-pid",
        ...(access.network === true ? [] : ["--unshare-net"]),
        ...(access.sandboxes ? [] : ["--disable-userns"]),
        ...binds,
        ...(access.cgroups === true ? ["--bind", sentinel, hierarchy] : []),
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
      access.cgroups === true ? { marker, sentinel } : undefined,
    ),
    env: {
      ...passed,
      // For systemd-run, which finds the owner's systemd by it; the step's own is set inside.
      XDG_RUNTIME_DIR: runtime,
      MEDRENGARD_IN: seen.input,
      MEDRENGARD_OUT: seen.output,
    },
  };
}

/**
 * Whether the program that ran as the unit `unit` was stopped for using more than its memory.
 * systemd keeps a scope that failed until it is reset, so this resets it.
 */
export function overMemory(unit: string): boolean {
  // A group this engine made: whether it ran out of memory itself, not a group under it.
  if (delegated) {
    return /^oom [1-9]/m.test(readFileSync(join(hierarchy, unit, "memory.events.local"), "utf8"));
  }

  const marker = markers.get(unit);

  if (marker !== undefined) {
    markers.delete(unit);

    // Written a moment after the program ends, by the process that waited for it.
    const until = Date.now() + answerWait;

    while (!existsSync(marker)) {
      if (Date.now() > until) {
        throw new Error(`Nothing said within ${answerWait} ms whether ${unit} ran out of memory.`);
      }

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }

    return readFileSync(marker, "utf8") === "over\n";
  }

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

/**
 * Hands every file under `directory` back to the owner. A step with a range of users may leave
 * files that belong to another of them, which the owner can neither read nor remove; user 0 of the
 * same range can.
 */
export function reclaim(directory: string): void {
  execFileSync(
    "unshare",
    ["--user", "--map-root-user", "--map-auto", "--", "chown", "-R", "-h", "0:0", directory],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
}

/**
 * The empty area of `access` that the program in the sandbox `sandbox`, by pid, has filled, if it
 * has filled one: seen through the sandbox's root, the sandbox being bwrap's child, in its own
 * mount namespace.
 */
export function fullArea(
  sandbox: number,
  access: Access,
): { path: string; size: number } | undefined {
  let root;

  try {
    const [inner] = readFileSync(`/proc/${sandbox}/task/${sandbox}/children`, "utf8").split(" ");

    root = `/proc/${inner}/root`;
  } catch {
    // Not started yet, or ended: there is nothing to look at.
    return undefined;
  }

  for (const area of access.paths) {
    if (area.mode === "empty") {
      const free = (() => {
        try {
          return statfsSync(join(root, area.path)).bavail;
        } catch {
          return undefined;
        }
      })();

      if (free === 0) {
        return area;
      }
    }
  }

  return undefined;
}

// The time a stopped step has to exit after SIGTERM before it gets SIGKILL.
const grace = 5000;

/**
 * Stops a confined program, started as `child`, whose sandbox leads the process group `group`:
 * SIGTERM to the group, then SIGKILL after the grace period. The group's leader is bwrap, which
 * dies at once on SIGTERM and takes the program with it, so it is spared the SIGTERM and the
 * program has its grace period.
 */
export function stop(child: ChildProcess, group: number): void {
  for (const pid of membersOf(group)) {
    if (pid !== group) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // It exited since the group was listed.
      }
    }
  }

  const kill = setTimeout(() => process.kill(-group, "SIGKILL"), grace);

  child.once("close", () => clearTimeout(kill));
}

// The processes in process group `group`, by their pid in the engine's namespace, read from
// /proc/<pid>/stat: the group is the third field after the command name, which is in parentheses
// and may itself hold spaces or parentheses.
function membersOf(group: number): number[] {
  return readdirSync("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .filter((pid) => {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");

        return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]) === group;
      } catch {
        return false;
      }
    })
    .map(Number);
}
