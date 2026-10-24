# Parked findings

Findings and capability gaps that survive the core refactor. These are not
new owner approvals. Historical tickets and findings for deleted code remain
in Git history; [decisions.md](../decisions.md) preserves the owner's decisions.

| Source | Finding | Revisit when |
| --- | --- | --- |
| Existing sandbox limit; foundations research | No memory or disk quotas. Output caps and stage deadlines do not bound allocations, files, retained repositories or SQLite growth. | Before unattended or resource-intensive runs. |
| Core refactor, repository isolation | The developer's independent full clone exposes all fetched refs and their history, including private branches. Clone isolation protects the source from writes, not confidentiality within the clone. | Before running on a repository whose refs have different access rules. |
| Core refactor, owner decisions | `decide` binds a decision to the current subject but has no command ID, expected stage or delivery deduplication. A-143 accepted hand-run repetition only; this does not approve automated redelivery. | Before adding an automated owner-command transport or same-subject human stages. |
| Core refactor, runtime integrations | Claude and Pi adapters, credential mounts, grants and layered job configuration were removed. `commandRuntime` is a generic JSON process adapter. Controller execution always uses `network: false` and provisions no provider credentials. | Before a paid/provider-backed runtime is introduced; decide its network and credential boundary first. |
| Core refactor, recovery | Replay preserves spent budget and escalates an interrupted run. It does not adopt a process result, resume an escalated work, or migrate a historical `events` database. | When an owner needs adoption, continuation or historical migration; preserve exact evidence and no-duplicate execution. |
| Core refactor, trusted extensions | Runtime adapters, extension functions and observer callbacks execute trusted owner TypeScript in the controller process. Synchronous hangs cannot be interrupted by its timer, and trusted code can access host resources. | Before accepting any third-party implementation as untrusted code. |
| Core refactor, artifact limits | JSON artifacts are capped at 1 MiB; retained packs share the process output cap; snapshots refuse non-UTF-8 paths/links and unsupported tree entries such as submodules. | When a real workflow needs larger artifacts or those tree forms. |

The public controller uses process-group supervision around bwrap. Public API
tests verify that its PID namespace and parent-death behavior end a descendant
in a new session after a stage deadline or controller death. The unused systemd
and run-folder mechanisms were removed; the wrapper-only 11-e2 finding retired
with the wrapper.
