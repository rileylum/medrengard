# 03-a findings — Claude Code and pi as child processes

Written from the diagnostics of `RUNTIME_SPIKE=1 npm test` on 2026-10-15, owner-run (versions from the `--version` diagnostic: Claude Code 2.1.301, pi 1.1.0, Node 24.13.0). Every number below is a test diagnostic; the owner-run output is quoted in the ticket logs of 03-a and 03-b. Timings are one run on one machine.

## Spawn helper

`src/runtime/spawn.ts` launches `command args` in a `cwd`, writes the prompt to stdin and closes it, collects stdout and stderr, and resolves with `status`, `exitCode`, `signal`, `wallMs`. `status` is `exited`, `cancelled` (we signalled it) or `failed` (never started: missing binary, non-executable file, or a `cwd` that does not exist, each named in `stderr`). Cancel signals the child's whole process group (the child is spawned `detached`): SIGTERM, then SIGKILL after `graceMs`. Once the child has exited nothing a surviving descendant writes is collected, so a grandchild holding the stdout pipe can neither stretch the cancel bound nor outlive it. `status` is the only cancel signal; the exit code after cancel is recorded, not asserted. Verified against `node` children: one that ignores SIGTERM (resolves with `signal=SIGKILL`, exit code null), one with a grandchild on the pipe that would write a file 2.5 s later (resolves inside the bound, file never appears), one that exits while a grandchild holds the pipe (cancel unsticks it, reported `exited`), and one that dies by its own SIGSEGV before cancel (reported `exited`, not `cancelled`).

Both CLIs accept the prompt on stdin with no positional argument.

## Claude Code

Flags: `claude -p --output-format json --tools "" --no-session-persistence`.

| Case | Exit | Observed |
| --- | --- | --- |
| Ping | 0 | One JSON object on stdout, 1.8 KB, nothing on stderr. `type:"result"`, `result:"pong"`, `session_id` (UUID), `is_error:false`, `subtype:"success"`, `terminal_reason:"completed"`, `api_error_status:null` (from the `ping fields` diagnostic), plus `num_turns`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, `duration_ms`, `uuid` (from the key list). Wall 3.4 s in the owner run. |
| Tools disabled, asked to create a file | 0 | No file. The `result` text is a tool call rendered as text; the rendering is not stable between runs (`入 (tool_use)\n{ "file_path": ... }`, `<invoke name="Write">...</invoke>`, `{"name":"Write","input":...}` have each been seen). The model tried to call a tool that was not offered; nothing executed. 4.0 to 4.3 s when it returns (two owner runs). **In three of nine runs this case did not return**: the owner's first run passed 120 s with nothing on stdout (the suite then waited about eight minutes for the child); one implementer run and the owner run on 75bf36d each hit the test's 60 s cap, were cancelled, and had 0 bytes of stdout. Cause unknown. The file was not created in any run. |
| Cancelled 3 s in (SIGTERM, 2 s grace) | 143 | `status=cancelled`. Exited 0.83 to 0.88 s after SIGTERM (`cancel-to-exit`, three owner runs), on its own, with exit code 143 (not a signal from Node's view). Stdout empty: no partial JSON. |
| `--model no-such-model-xyz` | 1 | Still a full JSON result on stdout: `is_error:true`, `subtype:"success"`, `terminal_reason:"api_error"`, `api_error_status:404`, `result` is a human sentence about the model. Stderr: `[claude-code:unrecognized_model] {"model":...}`. 2.2 s. |
| No auth (empty HOME, no env keys) | 1 | Same JSON shape: `is_error:true`, `api_error_status:null`, `result:"Not logged in · Please run /login"`. Stderr empty. 0.6 s. |

Session identity: `session_id` in the result object. Present even on error results. `--no-session-persistence` did not remove it.

Things a controller must not assume: `subtype` is `success` on errors, so `is_error` is the flag. Errors come back with exit 1 *and* a JSON body on stdout; stderr may be empty. A one-turn prompt can fail to return at all (two of seven runs above), so every launch needs a deadline. Cancel gives exit 143 with `signal=null`.

## pi

Flags: `pi -p --mode json --no-tools --no-session`.

| Case | Exit | Observed |
| --- | --- | --- |
| Ping | 0 | JSON Lines on stdout, 9.8 KB for one word. Event types in order: `session`, `agent_start`, `turn_start`, `message_start`/`message_update`/`message_end` (system, user, assistant), `turn_end`, `agent_end`, `agent_settled`. The `session` line carries `id` (UUID v7), `version`, `timestamp`, `cwd`. The assistant text is in `turn_end.message.content[].text`. Stderr empty. Wall 2.5 to 4.8 s in the owner runs. |
| Tools disabled, asked to create a file | 0 | No file. The reply wording varies by run ("I don't have file-writing tools in this session", "I can't write files in this session") and ends with a shell one-liner for the user. 25 to 26 KB of stdout because every `message_*` event repeats the whole system prompt. |
| Cancelled 3 s in (SIGTERM, 2 s grace) | 143 | `status=cancelled`. Exited 11 to 12 ms after SIGTERM (`cancel-to-exit`, three owner runs) with exit code 143, `signal=null`. 5 KB of partial JSONL already on stdout (the `session` line and streaming deltas); no `agent_end`. |
| `--model no-such-model-xyz` | 1 | Stdout empty. Stderr: `Error: Model "no-such-model-xyz" not found. Use --list-models to see available models.` 0.2 s, no network. |
| No auth (empty HOME, no env keys) | 1 | Stdout: just the `session` line. Stderr: `No API key found for the selected model.` plus doc paths. 0.2 s. |

Session identity: `id` on the first `session` line. Emitted before auth is checked, so it exists even for a run that then fails.

Things a controller must not assume: a `session` line does not mean the run will do anything. Completion is `agent_end` (or `agent_settled` with `aborted`), not EOF. Errors go to stderr, not into the JSONL. Each event embeds full messages, so output size grows with the system prompt, not the answer.

## Limits of the helper

`exited` versus `cancelled` is decided by whether `cancel()` ran before Node dispatched the child's `exit` event. A child that died in the kernel a few milliseconds before `cancel()` is reported `cancelled`. 04-a should not rely on the distinction being exact at that resolution.

## Common

- Both read the prompt from stdin and exit 0 on success.
- Both honour SIGTERM and exit 143 within one second; the SIGKILL fallback was not needed. Neither spawned a descendant in these tool-less runs; with tools on they will, which is why cancel signals the process group.
- Both return exit 1 for bad model and missing auth. Claude says so in JSON on stdout; pi says so in plain text on stderr.
- Tool denial works in both: `--tools ""` and `--no-tools`. The Claude model may still emit tool-call-shaped text; the file is not created.
- Ten live tests take about 24 s when Claude returns; 82 s in the owner run where the deny case hit its 60 s cap. A controller cannot rely on `claude -p` returning promptly even for a one-turn prompt; it needs its own deadline and cancel, which the spawn helper provides.

## For 04-a

The adapter will have to normalise: one result object (claude) versus an event stream with the answer in a nested message (pi); error text in stdout JSON versus stderr; `is_error` versus exit code. Session ID is available from both before the run finishes only for pi. Cancel can be treated the same for both: SIGTERM to the process group, and `status` from the helper is the cancelled signal; the exit code (143 so far) is informational.
