import { execFileSync } from "node:child_process";
import { constants, openSync, readFileSync, rmSync } from "node:fs";
import { Socket } from "node:net";

/**
 * The command that runs `argv` in a pseudo-terminal of its own, made by script(1) from the
 * owner's terminal on this process's stdin: script copies what the owner types into it and what
 * the program shows onto its own stdout, keeps the window's size in step, and writes each
 * keystroke to `keys`. The program's controlling terminal is the pseudo-terminal, so it cannot
 * push input into the owner's.
 */
export function inTerminal(argv: readonly string[], keys: string) {
  // script runs one command line through the shell, so each argument is quoted, and exec makes
  // the program script's own child, which a stop signals.
  const line = `exec ${argv.map((arg) => `'${arg.replaceAll("'", `'\\''`)}'`).join(" ")}`;

  return { command: "script", args: ["-q", "-e", "-f", "-I", keys, "-O", "/dev/null", "-c", line] };
}

/**
 * Makes `path` a FIFO and reads it, calling `typed` on each chunk the owner types, which is
 * discarded: only that they typed counts. Returns what closes and removes it.
 */
export function keysAt(path: string, typed: () => void): () => void {
  execFileSync("mkfifo", ["-m", "600", path]);

  // Non-blocking, so the open does not wait for script to open its end.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  const reader = new Socket({ fd, readable: true, writable: false });

  reader.on("data", typed);

  return () => {
    reader.destroy();
    rmSync(path, { force: true });
  };
}

/**
 * Saves the owner's terminal settings, and returns what restores them: script leaves the terminal
 * raw if it is killed.
 */
export function keepTerminal(): () => void {
  const saved = execFileSync("stty", ["-g"], { stdio: ["inherit", "pipe", "ignore"] })
    .toString()
    .trim();

  return () => {
    execFileSync("stty", [saved], { stdio: ["inherit", "ignore", "ignore"] });
  };
}

/** The program script started, by pid, or undefined before it starts and once it has ended. */
export function underTerminal(script: number): number | undefined {
  try {
    const [child] = readFileSync(`/proc/${script}/task/${script}/children`, "utf8").split(" ");

    return child === "" ? undefined : Number(child);
  } catch {
    return undefined;
  }
}
