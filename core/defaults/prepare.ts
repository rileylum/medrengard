/**
 * Environment preparation: a step's run that first prepares its workspace, such as installing
 * dependencies, then runs the step's program in it. Preparation runs inside the attempt because a
 * step of its own could not hand its workspace on: steps share state only through artifacts.
 */

// The longest command a note quotes; a longer one is cut, as the adapter cuts its notes.
const quoted = 120;

// Runs the command ($1) in the workspace, then the program after it. A failure exits with the
// command's code before the program starts, so the commission escalates rather than the program
// failing for reasons that look like its own; fd 3 carries the step's notes.
const script = `command=$1
shift
said=$(printf '%s' "$command" | tr '\\n' ' ' | cut -c1-${quoted})
started=$(date +%s)
sh -c "$command"
code=$?
if [ "$code" -ne 0 ]; then
  echo "Preparation failed: $said exited with $code." >&3
  echo "Preparation failed: $said exited with $code." >&2
  exit "$code"
fi
echo "Prepared in $(( $(date +%s) - started )) s: $said" >&3
exec "$@"`;

/**
 * Returns `run` preceded by the shell command `command`, run in the step's workspace with the
 * step's access; if it fails, the step escalates before `run` starts. Works for a command step's
 * `run` and an agent's `harness.run`.
 *
 * lazy: preparation has the step's own access and network. Move it into the engine, as a step
 * field run in a sandbox of its own, once a step's setup needs access its agent must not have, as
 * an egress allowlist would make it.
 */
export function prepare(
  command: string,
  run: readonly [string, ...string[]],
): readonly [string, ...string[]] {
  return ["sh", "-c", script, "sh", command, ...run];
}
