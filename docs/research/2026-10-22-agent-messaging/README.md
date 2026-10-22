# Research, 2026-10-22: messaging between sandboxed runs

The owner asked whether several agents can work at once and talk to each other, through herdr, Claude Code's messaging or other means, while each stays sandboxed: "I have found it valuable to have streams work on dependent or linked work be able to communicate between each other to validate design etc. so it is a paradigm or a workflow that should be possible." Four research agents worked in parallel; a fifth wrote the report from their notes.

- `REPORT.md`: the answer, ranked options, a threat model per option, decisions for the owner and an order of experiments.
- `brokered_messaging.md`: a broker the controller owns; what Claude Code 2.1.306, pi 1.1.0 and herdr 0.9.5 offer for sending and receiving mid-run; recording messages as events.
- `no_vm_isolation.md`: per-run network namespaces with pasta, an egress proxy, abstract sockets, Landlock, systemd and nftables limits for user units.
- `vm_isolation.md`: VMs, microVMs and containers on the owner's home server; host-guest channels; how hosted agent platforms isolate.
- `protocols_and_threats.md`: A2A, MCP, coordination patterns, the evidence on chat between agents, and threats with mitigations.
- `probes/`: the scripts behind the local probes. They write under `/var/tmp/software_factory/agent-messaging-research/scratch/`, which may be gone.

Read with A-106 (pasta) and the egress proxy row in `docs/plan.md` (A-115): the report's "drop `--share-net`" is already decided there. What it adds is the probe result for `pasta --splice-only` (each run reaches only its own forwarded port) and the clients' proxy behaviour. The owner's decision on messaging is A-144; what is still open is O-018. Citations into `src/` are at `5151d16`.
