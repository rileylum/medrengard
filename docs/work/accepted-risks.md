# Accepted risks

Review findings the owner chose not to fix (A-042). Each line says why the risk is acceptable and what event would reopen it. Unlike [parked.md](parked.md), a line here gates no ticket. When the reopen event happens, the finding becomes a ticket or a parked line.

| Source | Finding | Why accepted | Reopen when |
| --- | --- | --- | --- |
| 08-g (A-068) | Every pi run, developer and reviewer, can overwrite or delete `~/.pi/agent/auth.json`, the owner's pi login. | Runs could already read it (D-021). Without the write, a refresh inside the sandbox loses the rotated refresh token and logs pi out. The worst case is a fresh `pi` login. | A run damages the file, or pi gains a refresh-only command the controller could run outside the sandbox. |
