# Accepted risks

Review findings the owner chose not to fix (A-042). Each line says why the risk is acceptable and what event would reopen it. Unlike [parked.md](parked.md), a line here gates no ticket. When the reopen event happens, the finding becomes a ticket or a parked line.

| Source | Finding | Why accepted | Reopen when |
| --- | --- | --- | --- |
| 08-g (A-068) | Every pi run, developer and reviewer, can overwrite or delete `~/.pi/agent/auth.json`, the owner's pi login. | Runs could already read it (D-021). Without the write, a refresh inside the sandbox loses the rotated refresh token and logs pi out. The worst case is a fresh `pi` login. | A run damages the file, or pi gains a refresh-only command the controller could run outside the sandbox. |
| 10-b (A-078) | A workflow named by the repository layer (`.factory/config.json`) is imported into the controller and runs unsandboxed. | It is read at the base SHA, so only code the owner has merged runs; a candidate cannot reach it (A-037 puts damage before malice). | A workflow can be loaded as data, or the factory runs repositories whose base the owner does not control. 10-e (A-085): such a workflow could also read a grant file at import; refusing a repository workflow that asks for grants (A-083 Q5) does not stop that. |
