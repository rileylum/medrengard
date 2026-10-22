# Live runs

A live run drives the factory with real runtimes (claude, pi) on a scratch repository, to check what the fake-runtime tests cannot: how a real agent reads a prompt, and the real sandbox, checks and evidence around it. Each agent run costs money, so a live run needs the owner's word and a plan of scenarios first.

## Steps

1. **Plan.** List each scenario as a path through the workflow and what it proves, with the number of paid runs. Get the owner's yes to the plan and the cost.
2. **Build the kit** under `/var/tmp/software_factory/live-N/`: one scratch repository per set of rules, a workflow module, one job file per scenario (one work ID each), and a fake grant token when a stage holds a grant. Write checks that print what they ran and what they saw: a silent `exit 0` reads to a reviewer as the script's own exit (live run 1).
3. **Show the owner** the tickets, job files and workflow before the first paid run.
4. **Seed** every state a scenario needs that an agent would only produce by chance: a reviewer FAIL, a dispute, a run that fails. See "Seeding" below. Spend paid runs only on the steps the scenario exists to test.
5. **Run** each scenario. After each, read the report, the cycle's events (`node src/main.ts events <job.json>`) and the evidence folder, and compare with what the scenario expected.
6. **Record** the results in the ticket log and `docs/STATUS.md`: per scenario, what ran, what happened, which steps were seeded, and the number of paid runs. A scenario that did not happen is reported as not happening, never forced.

Done when every scenario in the plan has a recorded result.

## Seeding

A job file may add its own runtime: `"runtimes": { "seed": { "module": "seed/seed.ts" } }`, then name it per role in `"runtime"`. The module reads one RunRequest as JSON on stdin and prints one RunOutcome on stdout; `tests/fixtures/ext-runtime.ts` is the template. It tells roles apart by the prompt: a reviewer's prompt holds its role text (`reviewer for the change below`) and `Candidate SHA: <sha>`; a fix run's holds `FAILED. Fix these findings`. Check those strings against `src/prompt.ts` and `src/lifecycle.ts` first; they move with the prompts.

Run the seed job to bring the cycle to the state, then send the live step with a second job file for the same work ID whose runtimes are real. The seeded steps go through the real loop, sandbox and checks, cost nothing, and are recorded on every outcome event with runtime `seed` and the module's hash, so the log never passes them off as an agent's.

Example (live run 2, scenario 6): the seed developer committed a script, the seed reviewer FAILed it, the seed fix run disputed, and the cycle escalated as in live run 1. Then `overrule` with all-claude runtimes reran the real reviewer, which PASSed under the ruling's contract hash.

To show that a live prompt carried a section, compare the outcome events' `contractHash`: a prompt with an owner's ruling has its own.

## Environment

- Start runs, moves and merges inside the user manager. From an SSH login the shell sits in `session-N.scope`, and cgroup isolation refuses (`docs/work/parked.md`). Prefix the command with `systemd-run --user --scope --quiet`, or start the shell that way.
- A fake grant script that compares against the token's value holds that value itself, so a search of the evidence finds it in the stage's copy of the script. Its output must show only `[grant <name>]`.
- Live runs so far took about a minute per scenario: one developer run and two reviews.
