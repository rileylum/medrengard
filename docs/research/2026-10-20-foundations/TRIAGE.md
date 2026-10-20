# Triage: foundations research, 2026-10-20

Sources (same folder): `design-audit.md`, `engine.md`, `runtime-process.md`, `security.md`, `extend-config.md`. Proposal IDs are each report's own (DA = design-audit, EN = engine, RT = runtime-process, SE = security, EC = extend-config).

Spot-checked by the session: spec core rules 2 and 3 (`docs/specs/core-lifecycle-v1.md:12-13`) do say "budget already spent stays spent" and "no automatic retry of a quality gate ... The owner chooses: a new cycle, or cancel"; claude runs bind `~/.claude` read-only (`src/runtime/cli-adapter.ts:216`); `main.ts:192` prints the developer's worktree path.

## Themes, by impact

| # | Theme | Merged from | Impact | Touches decisions |
|---|---|---|---|---|
| T1 | Escalation is a dead end: owner moves in place (retry, overrule, targeted fix, route, accept with risk, fork from the candidate) | DA P1, EN P1; DA's tally of the factory's own reviews | 5 | Spec core rule 3, D-016, A-105, A-109 B, O-011 |
| T2 | Network and credentials: all egress through a controller proxy with an allow list and log; credentials injected by the proxy, never in the sandbox. A-106's pasta alone leaves Docker-bridge and LAN hosts open (probed) | SE P1, P2 | 5 | A-106, A-068, D-021, A-037 |
| T3 | Run output: stream, keep and parse what the CLIs already report (cost, tokens, model, progress); structured claims through each CLI's schema option | RT P1, P2, P3, P6 | 5 | A-111, A-112, A-113 (gives them mostly free), D-024/A-074 one-in-one-out, 04-d "no streaming" |
| T4 | Step inputs and outputs: named outcomes, declared inputs/outputs checked as dataflow (replaces `driverLimits`), then a step-type registry | EN P3, P4 | 5 | A-108, A-109 (design before building), D-024, A-057, A-074 Q8 |
| T5 | Pre-sandbox defaults: developer runs checks by default, reviewers may run commands, a red check gets one fix round | DA P2, P3 | 5 | A-112 item 11, A-030, A-108 item 2 (owner decided otherwise today) |
| T6 | Repository trust: owner floor no repository can lower; trust a repository workflow by content hash; JSON-only repository workflows; a default protected-paths check; grant stages without the candidate checkout and with a human accept | SE P3, P4; EC P3 | 4 | A-078, A-095, A-111, A-083 Q3, A-107 |
| T7 | Configuration: one schema-driven loader, strict at every depth (typos accepted today, probed); provenance; effective config hash on the cycle; canonical workflow hash; runtime entries as data with a model | EC P1, P2, P4, P5, P11, P14; DA P8 | 4 | A-111, A-105 item 2, A-056 |
| T8 | Sandbox hardening and limits: memory/process/`/tmp` limits, disk floor, `stop` command, `--disable-userns`, seccomp, narrower binds (`~/.claude`), subordinate UID, do not hand the owner the developer's `.git`, clone only base history, pi reviewer `--no-mcp` | SE P5, P6, P7, P10, P11; RT side finding | 4 | D-019 (kept), D-021 |
| T9 | Process model: no daemon now, but runs that outlive the controller (output and exit code on disk) so `recover` can adopt a finished run. The design audit wants O-006 decided before row 11 | RT P4, P7; DA P4 | 4 | A-105, O-006 |
| T10 | Engine correctness: SHA and idempotency key on owner and external events; replay divergence detection and an engine version; quadratic replay; checker gaps (unreachable stage, PASS to ESCALATED with no reason, budget 1) | EN P2, P5, P6, P9 | 4 | A-056, 10-d |
| T11 | Extension model: one manifest and lock file for every extension kind; a pure "decision" extension shape for dispatch; observer `stop-run`/`note`; and the counterweight: build an extension point only when something the owner runs needs it | EC P6, P7, P8, P12, P13; DA P7; EN caveats | 3–4 | A-113 (qualify), D-024 |
| T12 | Process and record: one "current rules" page and the nine contradictions; spec up to row 10; review tiers written down; tests in a pre-merge hook; a private remote; a threat model page; dogfooding | DA P5, P6, P10, P11; SE P12 | 3–5 | workflow.md, AGENTS.md |
| T13 | Workspaces: `--shared` clone against a bare mirror, overlay checkout per base (562 MB → a few MB per cycle, measured) | RT P5 | 3 | A-038 |
| T14 | Smaller: Codex built-in and ACP as an extension runtime; ticket provenance for row 12; personal per-repository sections; secret references; SIGINT before SIGTERM for claude; workflow tooling (schema, lint, diagram) | RT P8, SE P9, EC P9, P10, EN P7 | 2–3 | — |

## Conflicts between reports

- O-006 (daemon): DA says decide before row 11; RT says no daemon now, add runs that outlive the controller instead.
- A-113: confirmed by EN, EC and SE, each with a qualifier (no extension point bypasses core guarantees; each costs a schema, a kit and a doctor line; security floors only in the owner's layers). DA proposes a counterweight: build only on demand.
- Step-type registry: EN for, one of its helpers against.
- Reviewers running commands (DA P2) against SE's confirmation of "reviewers with no network tools".
