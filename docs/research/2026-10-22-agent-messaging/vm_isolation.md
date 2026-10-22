# VM- and container-based isolation for coding agents on a self-hosted home server

Scope note: researched 2026-10-22. Local probes ran on the owner's Arch desktop (the machine this
session runs on), not on the new home server: `/dev/kvm` and `/dev/vhost-vsock` exist (mode 0666,
group kvm); `docker`, `bwrap`, `systemd-nspawn` and `herdr` are installed; `firecracker`,
`cloud-hypervisor`, `qemu-system-x86_64`, `incus`, `podman`, `runsc`, `kata-runtime`, `krunvm` and
`muvm` are not. Project context read: `src/sandbox.ts` (a `BACKENDS` table with `bwrap` and `none`;
its header says "Docker, a VM or a cloud runner would be further entries"), `docs/work/herdr-findings.md`
(herdr saw `bwrap, bwrap, claude` as pane foreground processes; open gaps include full network access
and readable CLI credentials, A-043), plan row 13 (A-126 pools: one read-only checkout per base SHA,
developer in a bwrap overlay; measured working tree ~400 MB to 3.9 MB, set-up 1.3 s to 0.17 s), and
O-006 (long-term goal: a daemon, e.g. on a VM serving another computer).

Research budget was limited (~17 tool calls). Several platforms (Daytona, OpenHands, Cursor, Copilot
coding agent, Sysbox, nspawn) were not fetched this session; they are listed under Gaps rather than
asserted.

## 1. Isolation options: strength, boot time, memory, snapshots/CoW, maintenance

### Takeaway
For one person on a KVM home server, the real choice is between (a) a microVM VMM driven directly
(Firecracker or Cloud Hypervisor: ~100-125 ms VMM boot, 3-13 MB VMM overhead, but you build the
kernel/rootfs/network plumbing yourself) and (b) Incus, which gives system containers and full VMs
with ZFS/LVM copy-on-write clones and snapshots out of the box at higher per-instance cost. gVisor
and rootless containers are cheaper but share or emulate the host kernel, which is a weaker boundary
than a VM.

### Cited Findings
- Firecracker's published figures: ~125 ms to user-space code, <5 MiB overhead per microVM; but
  booting within production frameworks (containerd etc.) measured 700-1300 ms — summary of
  [Northflank comparison](https://northflank.com/blog/kata-containers-vs-firecracker-vs-gvisor) and
  [arXiv 2310.03522](https://arxiv.org/pdf/2310.03522) as surfaced in search; numbers are vendor/paper
  figures, not measured here.
- VMM memory overhead comparison: Firecracker ~3 MB, Cloud Hypervisor ~13 MB, QEMU ~131 MB —
  [arXiv paper cited in search, see Mewz 2411.01129](https://arxiv.org/pdf/2411.01129) (search
  snippet; attribution to the exact paper not confirmed).
- Controlled bare-metal benchmark (Edera paper, Jan 2025, older data): full container start ~2.4 s on
  Firecracker, ~1.9 s on Kata, ~0.57 s Docker, ~0.68 s gVisor. Authors note this is full container
  start, not VMM boot — [arXiv 2501.04580](https://arxiv.org/pdf/2501.04580).
- Cloud Hypervisor cold boot ~100 ms (blog figure) —
  [opencomputer.dev guide](https://opencomputer.dev/guides/firecracker-vs-cloud-hypervisor-vs-kata/).
- Kata boot ~150-300 ms depending on hypervisor backend; Kata-on-Firecracker needs extra filesystem
  tooling (devicemapper-style block devices, as Firecracker has no virtiofs) —
  [Northflank](https://northflank.com/blog/kata-containers-vs-firecracker-vs-gvisor).
- gVisor: fast start, syscall overhead on I/O-heavy workloads; ~10-50 MB per sandbox is an
  unverified blog figure — [Northflank](https://northflank.com/blog/kata-containers-vs-firecracker-vs-gvisor);
  2026 comparison: [bex.co, 2026-09-22](https://bex.co/blog/2026/09/22/gvisor-vs-kata-vs-firecracker-agent-sandbox-isolation).
- Cloud Hypervisor snapshot/restore: a restored VM comes back `paused` and must be resumed —
  [Cloud Hypervisor snapshot_restore.md](https://git.phyllo.me/External/cloud-hypervisor/raw/branch/main/docs/snapshot_restore.md).
- Firecracker vsock snapshot support "is currently limited"; restoring without the jailer can collide
  on the same host socket path, fixed by `vsock_override` on snapshot load —
  [Firecracker vsock.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/vsock.md).
- Incus (6.22, March 2026): instance boot-time metrics, VM fast reboot, disk-only snapshot restore,
  snapshots of running instances; Windows VM agent moved from TCP to vsock —
  [Announcing Incus 6.22](https://stgraber.org/2026/03/02/announcing-incus-6-22/),
  [linuxiac](https://linuxiac.com/incus-6-22-container-and-virtual-machine-manager-released/).
- Incus storage: on btrfs a VM disk is one constantly changing file that must be marked nocow, so VM
  snapshots are slower than container snapshots; ZFS or LVM recommended for many VMs on local storage —
  [Incus forum](https://discuss.linuxcontainers.org/t/btrfs-os-disk-subvolume-for-var-lib-incus/24239/8).
- libkrun-based sandboxes (microsandbox, Gondolin's experimental backend, agent-vm) are a growing
  self-hosted category; a 2026 blog argues "agent sandboxes are converging on libkrun, not
  Firecracker" — [iii.dev](https://iii.dev/blog/why-agent-sandboxes-are-converging-on-libkrun-not-firecracker/);
  microsandbox is pre-1.0 and a 2026 security study found it applies "0 layers" of extra Linux
  hardening at defaults — [arXiv 2606.08433](https://arxiv.org/pdf/2606.08433),
  [rywalker microsandbox](https://rywalker.com/research/microsandbox).
- Claude Code docs rank isolation: sandboxed Bash tool < sandbox runtime (bwrap) < dev container /
  custom container < VM; "A dedicated virtual machine provides the strongest separation"; for an
  untrusted repository, "A dedicated virtual machine" — [Claude Code: Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments).
- Claude Code refuses `--dangerously-skip-permissions` as root on Linux/macOS; run the container/VM as
  non-root — [same page](https://code.claude.com/docs/en/sandbox-environments).
- Bubblewrap inside an unprivileged container needs `enableWeakerNestedSandbox` (relevant to the
  "bwrap inside a VM/container" variant) — [same page](https://code.claude.com/docs/en/sandbox-environments).

### Inferences
- Comparison matrix (strength from docs above; rootless/maintenance columns are my assessment from
  general knowledge, not verified this session):

  | Option | Boundary | Boot | Per-instance overhead | CoW / snapshot for per-SHA base | Root needed | One-person maintenance |
  |---|---|---|---|---|---|---|
  | Firecracker | KVM VM, minimal device model | ~125 ms VMM | ~3-5 MB VMM + guest RAM | Block devices only (no virtiofs); use dm/qcow-less raw + reflink or overlay; full mem snapshots | /dev/kvm access (user in `kvm` group); TAP needs CAP_NET_ADMIN once | High: kernel, rootfs, TAP, jailer all DIY |
  | Cloud Hypervisor | KVM VM | ~100 ms | ~13 MB VMM | virtiofs (via virtiofsd) + snapshots | kvm group; TAP setup | High, a bit lower than FC (virtiofs, more devices) |
  | QEMU microvm / libvirt | KVM VM, large device model | slower; ~131 MB VMM | qcow2 backing files (native CoW) | libvirt system daemon | Medium (libvirt tooling mature) |
  | Kata | VM per container (pod) | 150-300 ms | tens of MB+ | containerd snapshotters | root containerd | Medium-high |
  | gVisor (runsc) | user-space kernel, shared host kernel underneath | sub-second | small | OCI/overlay | rootless possible | Low (Docker/Podman runtime) |
  | Incus containers / VMs | namespaces / QEMU VM | containers ~1 s, VMs seconds | containers small; VMs QEMU-sized | ZFS/LVM clones and snapshots, native | root daemon (incus group) | Low: one CLI, images, profiles, vsock agent built in |
  | systemd-nspawn | namespaces | fast | small | btrfs subvol snapshots via machinectl clone | root | Low, but not a VM boundary |
  | Podman/Docker rootless | namespaces | ~0.5 s | small | overlayfs image layers | rootless | Low |
  | libkrun / muvm / microsandbox | KVM VM | sub-second (vendor) | small | virtiofs to host dirs | kvm group, no root daemon | Medium; young projects |
- For A-126 pools (one read-only checkout per base SHA, overlay per developer): virtiofs (Cloud
  Hypervisor, QEMU, libkrun, Incus VMs) can share the read-only base into each guest, and the guest
  mounts an overlayfs with a guest-local upper dir — this preserves the measured 0.17 s set-up. With
  Firecracker (no virtiofs) the base must be a read-only block device (e.g. an ext4/erofs image built
  once per SHA) plus a per-VM writable disk; still cheap, but adds an image-build step per SHA.
- Incus on ZFS gives per-SHA "golden" instances and `incus copy` clones in near-constant time; this
  is the least code for one person, at the cost of QEMU-sized VM overhead (hundreds of MB guest RAM
  each; a home server with 32-64 GB handles several concurrent agents comfortably — assumption).
- Hardware that matters on the server: KVM + nested virt only if the "factory in one VM" variant also
  wants VMs inside; RAM (Claude Code/Node CLIs use a few hundred MB each plus build/test toolchains);
  fast NVMe for CoW clones; ZFS needs RAM for ARC.

### Gaps
- No independent, current (2026) per-instance RAM measurement for Claude Code CLI inside each VMM.
  Measure on the server.
- Sysbox, systemd-nspawn/machinectl and Lima were not researched this session (no sources fetched).
- Rootless figures for Firecracker/Cloud Hypervisor TAP setup not verified this session.

## 2. Host-guest channels for a broker, and unforgeable sender identity

### Takeaway
vsock is the best fit: no network stack, and the host (not the guest) assigns each guest's identity.
In Firecracker, each VM has its own host Unix socket, so the broker learns the sender from *which
socket* a connection arrived on — the guest cannot choose it. With kernel vhost-vsock (QEMU,
Cloud Hypervisor, Incus), the host assigns each guest's CID and the broker reads it with
`getpeername()`.

### Cited Findings
- Firecracker maps guest AF_VSOCK ports 1:1 to host AF_UNIX sockets. Guest-initiated connections to
  port N go to the host socket `<uds_path>_N` (e.g. `./v.sock_52`); no listener means the guest gets
  a reset. Host-initiated connections connect to `uds_path` and send `CONNECT <port>\n`; Firecracker
  answers `OK <host_port>`. Host is always CID 2. Ports [2^30, 2^31) are reserved —
  [Firecracker vsock.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/vsock.md).
- vsock addressing: CID 2 = host, CID 1 = loopback, 0 = hypervisor; `sockaddr_vm.svm_cid` carries the
  CID; a guest's CID may change across live migration —
  [vsock(7)](https://www.man7.org/linux/man-pages/man7/vsock.7.html).
- A 2026 kernel patch (under review, not merged as of the thread) proposes a G2H fallback and a
  `VMADDR_FLAG_TO_HOST` flag visible via `getpeername()` —
  [LKML, March 2026](https://lkml.iu.edu/hypermail/linux/kernel/2603.0/04020.html).
- Incus already uses vsock for its VM agent (moved Windows agent to vsock in 6.22) —
  [Incus 6.22](https://stgraber.org/2026/03/02/announcing-incus-6-22/).
- Local probe: `/dev/vhost-vsock` exists on the owner's desktop (mode 0666), so kernel vhost-vsock is
  available without root there (server unverified).

### Inferences
- Identity per channel type:
  - Firecracker vsock-over-UDS: identity = host socket path, chosen by the controller per run
    (e.g. `/run/factory/<runId>/v.sock_5000`). Unforgeable by the guest. Best match for "controller
    decides state; agents return claims".
  - vhost-vsock (QEMU/CH/Incus/libkrun): identity = CID; the host sets the CID at VM start, the guest
    cannot change it. Broker maps CID→runId. Unforgeable as long as the host never reuses a CID while
    a stale connection lives.
  - virtio-serial: one host chardev (Unix socket) per VM → identity by socket path, like Firecracker.
    Single stream, no multiplexing; fine for a line-oriented JSON protocol.
  - virtiofs/9p shared dir: identity by which directory is mounted; workable as a mailbox but
    file-based (polling or inotify), and a shared writable dir is a larger attack surface.
  - TAP + nftables: identity = source IP/MAC, which the guest can attempt to spoof; needs per-TAP
    anti-spoof rules (match `iifname` per TAP rather than source IP). Weaker and more config than vsock.
  - Containers: a bind-mounted per-run Unix socket gives identity by path, and `SO_PEERCRED` gives
    pid/uid (uids may be shared across containers, so prefer path).
- The broker should treat any message as a claim bound to (runId-from-channel, commit SHA), never
  trust a runId written inside the message.

### Gaps
- No primary source found stating explicitly "a guest cannot spoof its vsock CID"; this follows from
  the host assigning `guest_cid` to the vhost device, but I did not find doc text saying so.

## 3. Credentials: keeping OAuth / API keys out of the guest

### Takeaway
The pattern Anthropic, Docker and others document is a proxy outside the sandbox that injects the
credential, so the agent never holds it. Claude Code's own devcontainer warns that with
`--dangerously-skip-permissions` anything inside, including `~/.claude` credentials, can be exfiltrated.

### Cited Findings
- Claude Code devcontainer: "dev containers do not prevent a malicious project from exfiltrating
  anything accessible inside the container, including the Claude Code credentials stored in
  `~/.claude`"; "prefer repository-scoped or short-lived tokens"; OAuth account lives in
  `~/.claude.json`, so set `CLAUDE_CONFIG_DIR` to persist; `CLAUDE_CODE_OAUTH_TOKEN` from
  `claude setup-token` or `ANTHROPIC_API_KEY` can be supplied as env —
  [Claude Code: Development containers](https://code.claude.com/docs/en/devcontainer).
- Reference devcontainer `init-firewall.sh` limits outbound traffic to allowed destinations; needs
  `NET_ADMIN` and `NET_RAW` via `runArgs`; non-root `remoteUser` required for skip-permissions —
  [same page](https://code.claude.com/docs/en/devcontainer),
  [init-firewall.sh](https://github.com/anthropics/claude-code/blob/main/.devcontainer/init-firewall.sh).
- Required domains: `api.anthropic.com`, plus `claude.ai` and `platform.claude.com` for OAuth sign-in
  and refresh (API-key runs can drop the latter two) —
  [Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments).
- Agent SDK secure deployment: run a proxy outside the boundary that adds the key to requests, so the
  agent never sees it — [Secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment)
  (via search summary).
- sandbox-runtime routes network through a proxy outside the sandbox that enforces domain allowlists
  and can be customized — [Anthropic engineering: Claude Code sandboxing](https://anthropic.com/engineering/claude-code-sandboxing).
- Claude Code on the web: "a separate proxy holds your GitHub token outside the sandbox while issuing
  scoped credentials for repository access inside it" — [Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments).
- Docker Sandboxes: "Credentials are injected at runtime and outside the MicroVM boundary, never baked
  into the environment" — [Docker blog, 2026-04-16](https://www.docker.com/blog/why-microvms-the-architecture-behind-docker-sandboxes/).
- IP-level firewalls are weaker than an inspecting proxy — [Formal blog](https://www.joinformal.com/blog/using-proxies-claude-code).
- Codex cloud: secrets available only during setup, removed before the agent phase; agent internet
  off by default — [OpenAI Codex security](https://developers.openai.com/codex/agent-approvals-security),
  [agent internet](https://developers.openai.com/codex/cloud/agent-internet).

### Inferences
- For Claude Code with an API key: set `ANTHROPIC_BASE_URL` in the guest to the host proxy (reached
  over vsock or a TAP with only that destination allowed) and have the proxy add `x-api-key`. The guest
  gets a dummy key. (ANTHROPIC_BASE_URL behaviour is standard but not re-verified this session.)
- OAuth subscription login is harder to proxy: the CLI expects to hold and refresh the token. Options:
  per-run copy of a `setup-token` long-lived token (exfiltratable but revocable), or the herdr-findings
  approach (overlay `~/.claude`, per-run `.claude.json` copy) which leaves credentials readable (A-043).
  pi's `auth.json` has the same issue.
- With a vsock-only guest (no TAP at all), egress is impossible except through the broker/proxy; that
  closes the "full network access" gap from herdr-findings, at the cost of proxying package installs.

### Gaps
- Whether Claude Code's OAuth mode works cleanly behind a header-injecting proxy (token never in guest)
  is not documented in what I fetched.

## 4. Git transfer in and out, and evidence binding to SHAs

### Takeaway
Keep the authoritative repo on the host. Push in a read-only base (virtiofs share or block image per
SHA), pull results out as a `git bundle` or a fetch over the broker channel, then have the host verify
the SHA itself. Products in this space do the same: Claude Code `--cloud` uploads a bundle;
container-use gives each agent a branch.

### Cited Findings
- Claude Code `--cloud` "can bundle and upload your local repository" instead of cloning from GitHub —
  [Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments).
- container-use (Dagger): each agent gets a fresh container on its own git branch; review with
  `git checkout <branch>`; logs kept; can drop into the agent's terminal; early development —
  [container-use README](https://cdn.jsdelivr.net/gh/dagger/container-use@main/README.md),
  [InfoQ, Aug 2025](https://www.infoq.com/news/2025/08/container-use).

### Inferences
- In: per base SHA, the controller materializes the A-126 read-only checkout once and shares it
  read-only (virtiofs) or as an erofs/ext4 image (Firecracker). The guest writes to an overlay upper.
- Out: the guest runs `git bundle create out.bundle <base>..HEAD` and sends it over the broker
  channel (or the host reads it from a per-run output disk). The host `git fetch`es from the bundle
  into a quarantine ref, runs `git bundle verify`, and records the SHA it computed. Evidence binds to
  the host-computed SHA, never one the agent reported.
- `git daemon` over vsock is possible but gives the guest a server to talk to; a one-shot bundle is
  narrower and fits the claim model.

### Gaps
- No source fetched on git-over-vsock tooling or real-world bundle transfer timings.

## 5. Interactive use with herdr

### Takeaway
Running herdr on the server and attaching from the desktop (`herdr --remote <ssh-target>`) keeps one
SSH hop; the agent's pane on the server then runs `ssh`/console into the VM. herdr's agent detection
by foreground process will likely see the VMM or `ssh`, not `claude`, unless the pane's process is
the agent itself (container exec) — unverified.

### Cited Findings
- herdr-findings (local): herdr listed `bwrap, bwrap, claude` as pane foreground processes when claude
  ran in bwrap; `--new-session` vs TIOCSTI concern; closing the tab ends the run —
  `/home/riley/dev/software_factory/docs/work/herdr-findings.md` (local file).
- container-use lets the owner step into an agent's terminal to take over —
  [container-use](https://container-use.com).

### Inferences
- bwrap and namespaces keep `claude` in the host's process tree, so herdr sees it. A container
  (`podman exec -it`) also keeps the agent visible as a host process in the container's PID namespace,
  but the pane's direct child is `podman`/`conmon`. A VM hides the agent entirely: the pane shows
  `ssh` or the VMM's serial console. Agent-state detection (working/idle/waiting) would then need a
  signal from inside the guest, e.g. the broker reporting state, or herdr running inside the VM.
- Latency: one LAN SSH hop adds a few ms; vsock console into a local VM adds negligible latency.
- TIOCSTI: in a VM, TIOCSTI injects only into the guest's tty, so the host-shell injection risk from
  herdr-findings disappears.

### Gaps
- herdr's detection mechanism (process name vs. output parsing) and `herdr --machine` semantics were
  not checked against herdr docs this session. Test: run `claude` via `ssh` into a VM in a herdr pane
  and read herdr's agent status.

## 6. How others do it (2026) and inter-agent communication

### Takeaway
Hosted platforms converge on microVMs (Firecracker: E2B, Fly Sprites; custom VMM: Docker Sandboxes;
Cloud Hypervisor: Arrakis) or gVisor (Modal), with an out-of-sandbox proxy for credentials and egress.
None of the sources I read offers first-class agent-to-agent messaging; communication is via the
control API, MCP (microsandbox, container-use), or git branches.

### Cited Findings
- E2B: Firecracker microVMs; starts "almost instantly" by resuming pre-booted snapshots; snapshots
  capture filesystem and memory; snapshotting briefly pauses the sandbox and drops PTY/WebSocket
  connections; templates beat live snapshots for fast restore —
  [E2B infra ARCHITECTURE.md](https://raw.githubusercontent.com/e2b-dev/infra/main/docs/ARCHITECTURE.md),
  [E2B snapshots docs](https://docs.e2b.dev/sandbox/snapshots).
- CubeSandbox (Tencent, E2B-API compatible, RustVMM/KVM) claims <60 ms average cold start
  (self-reported) — [search summary of p.codekk.com](https://p.codekk.com/detail/69eae8725b02fc5c75bb9f4a).
- Docker Sandboxes: each agent session in a dedicated microVM with a private Docker daemon, "no path
  back to the host"; Docker wrote its own VMM rather than Firecracker (no macOS/Windows), using KVM on
  Linux; supports Claude Code, Codex CLI, Copilot CLI, Gemini CLI, Kiro —
  [Docker blog, 2026-04-16](https://www.docker.com/blog/why-microvms-the-architecture-behind-docker-sandboxes/),
  [Docker Sandboxes blog](https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/).
  "Sandbox Kits" are YAML specs of tools, env, injected credentials, allowed domains (secondary source:
  [drweb.de](https://www.drweb.de/docker-sandboxes-ki-agenten-microvm/)). Launch date conflicts between
  sources (Jan vs. March vs. April 2026).
- Modal Sandboxes: gVisor by default, full VM runtime in beta; 5 min default lifetime, 24 h max;
  Fly Sprites: Firecracker per Sprite, checkpoints restore in place; Sprites create in 1-2 s (Fly's own
  comparison, biased) — [Fly vs Modal](https://fly.io/learn/fly-vs-modal/),
  [rywalker Sprites](https://rywalker.com/research/sprites).
- Arrakis: self-hosted, Cloud Hypervisor microVM per sandbox, snapshot restores processes and files;
  restore reuses the original IP so the original must be stopped; AGPL-3.0; last push June 2025 (likely
  unmaintained) — [Arrakis README](https://raw.githubusercontent.com/abshkbh/arrakis/main/README.md),
  [sourcepulse](https://www.sourcepulse.org/projects/2338763).
- microsandbox: libkrun microVMs, self-hosted, MCP server so agents create sandboxes; keys never enter
  the VM (listing claim) — [rywalker microsandbox](https://rywalker.com/research/microsandbox),
  [Vultr guide](https://docs.vultr.com/how-to-set-up-agent-sandboxing-on-vultr-cloud-compute).
- container-use: MCP server; agent per container + git branch — [container-use](https://container-use.com).
- Claude Code on the web: Anthropic-managed VM, proxy allowlist, GitHub token held by a separate proxy;
  self-hosted environments are possible, where isolation and egress are the operator's job —
  [Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments).
- Codex cloud: OpenAI-managed containers, setup phase with network, agent phase offline by default —
  [OpenAI Codex security](https://developers.openai.com/codex/agent-approvals-security).
- Curated list of agent sandboxes: [awesome-agent-sandbox](https://github.com/fishman/awesome-agent-sandbox).

### Inferences
- The industry pattern matches the owner's model: a controller outside, agents inside, narrow channel
  + proxy. Agent-to-agent messaging is something the owner's broker must provide; no platform supplies
  it as a primitive in what I read.

### Gaps
- Not researched this session: Daytona, OpenHands runtime, Cursor background agents, GitHub Copilot
  coding agent (its Actions-based firewall), Lima/krunvm/muvm details, Sysbox. Search for Copilot's
  firewall returned nothing.

## 7. Concrete minimal design for this owner

### Takeaway
Two tiers. Cheapest: one VM (Incus or libvirt) holding the whole factory, bwrap inside unchanged,
herdr inside it, reached via `herdr --remote`. Stronger: controller daemon on the server host (O-006),
one microVM per run, broker on vsock, credential-injecting proxy as the only egress.

### Inferences (design proposals, not sourced facts)
- **Variant A — factory-in-a-VM (days of work).** One Incus VM (or libvirt/QEMU) on the server runs
  the existing Node controller, SQLite, bwrap backend and herdr. The owner attaches from the desktop
  with `herdr --remote server-vm`. Gains: the owner's desktop, SSH keys and home are out of reach;
  snapshot the VM before risky runs; no code change in `src/sandbox.ts`. Keeps: agents can still see
  each other's runs within the VM, full network unless the VM's network is restricted, credentials
  readable inside. Note bwrap inside a VM works as on the desktop (it is not a nested *container*, so
  `enableWeakerNestedSandbox` is not needed). Restrict the VM's egress with host nftables to
  Anthropic/model API, the code host and package mirrors.
- **Variant B — VM per run (a new BACKENDS entry).**
  1. Controller runs as a systemd service on the server host (O-006 daemon), owns SQLite and the
     per-SHA bare checkouts (A-126).
  2. Per run, the `vm` backend starts a Cloud Hypervisor (virtiofs available) or Firecracker microVM:
     shared read-only base checkout + guest overlay upper; a minimal rootfs with node, git, claude, pi.
  3. Channel: vsock only. Guest port 5000 → broker; identity from the per-run socket path
     (Firecracker) or CID (vhost-vsock). No TAP, or a TAP whose nftables rules allow only the proxy.
  4. Proxy on the host injects the API key; guest has `ANTHROPIC_BASE_URL` pointing at a vsock-to-TCP
     forwarder; OAuth runs fall back to a per-run setup-token.
  5. Output: guest sends a git bundle; host verifies and records the SHA it computed.
  6. Interactive: herdr runs on the server; each pane runs a small attach command that opens the guest
     PTY over vsock (or SSH over vsock). Agent status comes from the broker, since herdr cannot see
     `claude` inside the VM.
- **Middle option worth testing first:** Incus VMs per run with ZFS clones from a per-SHA golden
  instance. Incus provides vsock, snapshots, images and `incus exec` (PTY attach) without custom
  VMM plumbing; cost is QEMU-sized RAM per VM.

### Gaps
- Server hardware (RAM, CPU, disk, filesystem) unknown; boot/RAM numbers above must be measured there.
- No measurement of Claude Code or pi CLI startup inside a microVM.
