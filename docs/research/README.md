# Research

Research kept for planned work. Each report cites the code at the commit it
names; that code was replaced in the core refactor, but the external findings
and prior art stand. Reports about deleted code were removed on 2026-10-25
(A-147) and remain in Git history at `c3f91f9`.

- `2026-10-22-agent-messaging/`: messaging between sandboxed runs, per-run
  network namespaces, egress proxies and VM isolation. Evidence for
  destination-specific network access and the herdr integration.
- `2026-10-20-foundations/security.md`: sandbox, network and credential design;
  the egress proxy with an allow list and injected credentials.
- `2026-10-20-foundations/runtime-process.md`: how Claude Code, pi and others
  report runs; streaming and keeping output. Evidence for session transcripts.
- `2026-10-20-foundations/engine.md`: workflow engine prior art; declared step
  inputs and outputs. Evidence for separating stage access from output
  contracts.
