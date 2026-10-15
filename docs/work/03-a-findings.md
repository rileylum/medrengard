# 03-a findings — Claude Code and pi as child processes

Written from `RUNTIME_SPIKE=1 node --test tests/runtime-spike.test.ts` on 2026-10-15 (Claude Code 2.1.301, pi 1.1.0, Node 24.13). Every number below is a test diagnostic; the raw run is `/var/tmp/software_factory/03-a/spike-run1.txt`. Timings are one run on one machine.

## Spawn helper

`src/runtime/spawn.ts` launches `command args` in a `cwd`, writes the prompt to stdin and closes it, collects stdout and stderr, and resolves with `status`, `exitCode`, `signal`, `wallMs`. `status` is `exited`, `cancelled` (we signalled it) or `failed` (never started, for example ENOENT). Cancel sends SIGTERM, then SIGKILL after `graceMs`. Verified against `node` children, including one that ignores SIGTERM (resolves with `signal=SIGKILL`, exit code null).

Both CLIs accept the prompt on stdin with no positional argument.

## Claude Code

Flags: `claude -p --output-format json --tools "" --no-session-persistence`.

| Case | Exit | Observed |
| --- | --- | --- |
| Ping | 0 | One JSON object on stdout, 1.8 KB, nothing on stderr. `type:"result"`, `result:"pong"`, `session_id` (UUID), `is_error:false`, `subtype:"success"`, `terminal_reason:"completed"`, `num_turns`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, `duration_ms`, `uuid`. Wall 2.9 s. |
| Tools disabled, asked to create a file | 0 | No file. The `result` text was a tool call rendered as text: `入 (tool_use)\n{ "file_path": ..., "content": "hello\n" }`. The model tried to call a tool that was not offered; nothing executed. |
| Cancelled 3 s in (SIGTERM, 2 s grace) | 143 | Exited 0.8 s after SIGTERM, on its own, with exit code 143 (not a signal from Node's view). Stdout empty: no partial JSON. |
| `--model no-such-model-xyz` | 1 | Still a full JSON result on stdout: `is_error:true`, `subtype:"success"`, `terminal_reason:"api_error"`, `api_error_status:404`, `result` is a human sentence about the model. Stderr: `[claude-code:unrecognized_model] {"model":...}`. 2.2 s. |
| No auth (empty HOME, no env keys) | 1 | Same JSON shape: `is_error:true`, `api_error_status:null`, `result:"Not logged in · Please run /login"`. Stderr empty. 0.6 s. |

Session identity: `session_id` in the result object. Present even on error results. `--no-session-persistence` did not remove it.

Things a controller must not assume: `subtype` is `success` on errors, so `is_error` is the flag. Errors come back with exit 1 *and* a JSON body on stdout; stderr may be empty. Cancel gives exit 143 with `signal=null`, so "non-zero exit" is the test, not "signal set".

## pi

Flags: `pi -p --mode json --no-tools --no-session`.

| Case | Exit | Observed |
| --- | --- | --- |
| Ping | 0 | JSON Lines on stdout, 9.8 KB for one word. Event types in order: `session`, `agent_start`, `turn_start`, `message_start`/`message_update`/`message_end` (system, user, assistant), `turn_end`, `agent_end`, `agent_settled`. The `session` line carries `id` (UUID v7), `version`, `timestamp`, `cwd`. The assistant text is in `turn_end.message.content[].text`. Stderr empty. Wall 3.0 s. |
| Tools disabled, asked to create a file | 0 | No file. Reply: "I don't have file-writing tools in this session" plus a shell one-liner for the user. 26 KB of stdout because every `message_*` event repeats the whole system prompt. |
| Cancelled 3 s in (SIGTERM, 2 s grace) | 143 | Exited 12 ms after SIGTERM with exit code 143, `signal=null`. 5 KB of partial JSONL already on stdout (the `session` line and streaming deltas); no `agent_end`. |
| `--model no-such-model-xyz` | 1 | Stdout empty. Stderr: `Error: Model "no-such-model-xyz" not found. Use --list-models to see available models.` 0.2 s, no network. |
| No auth (empty HOME, no env keys) | 1 | Stdout: just the `session` line. Stderr: `No API key found for the selected model.` plus doc paths. 0.2 s. |

Session identity: `id` on the first `session` line. Emitted before auth is checked, so it exists even for a run that then fails.

Things a controller must not assume: a `session` line does not mean the run will do anything. Completion is `agent_end` (or `agent_settled` with `aborted`), not EOF. Errors go to stderr, not into the JSONL. Each event embeds full messages, so output size grows with the system prompt, not the answer.

## Common

- Both read the prompt from stdin and exit 0 on success.
- Both honour SIGTERM and exit 143 within one second; the SIGKILL fallback was not needed.
- Both return exit 1 for bad model and missing auth. Claude says so in JSON on stdout; pi says so in plain text on stderr.
- Tool denial works in both: `--tools ""` and `--no-tools`. The Claude model may still emit tool-call-shaped text; the file is not created.
- Ten live tests took 24 s total, well under the 120 s per-test cap.

## For 04-a

The adapter will have to normalise: one result object (claude) versus an event stream with the answer in a nested message (pi); error text in stdout JSON versus stderr; `is_error` versus exit code. Session ID is available from both before the run finishes only for pi. Cancel can be treated the same for both: SIGTERM, expect exit 143, treat non-zero after cancel as `cancelled`.
