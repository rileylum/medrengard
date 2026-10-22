# Linux network and IPC isolation without VMs for sandboxed agent runs

Scope: each run must reach (a) its model provider's API and (b) a controller-owned broker, and must not reach other runs, the LAN, or the rest of the internet. Current state of the project (read-only inspection of /home/riley/dev/software_factory): `src/sandbox.ts` `wrapBwrap` builds `bwrap --die-with-parent --unshare-all [--share-net] --new-session ...` and binds `/run/systemd/resolve` read-only when network is on; decision A-043 (2026-10-17, `docs/decisions.md`) accepted two open gaps: "every run has full network access, and a run can read its own CLI's config directory, credentials included". `docs/work/08-a-findings.md` parked "Network filtering by domain ... A proxy as in sandbox-runtime".

Local machine facts (probed 2026-10-22, read-only or throwaway in /var/tmp/software_factory/agent-messaging-research/scratch/): kernel 7.2.9-arch1-1; bubblewrap 0.13.0; `pasta`/`passt` 2026_10_02 installed at /usr/bin; slirp4netns, socat, podman NOT installed; nft installed but `nft list tables` as user fails "Operation not permitted (perhaps you must be root?)"; `kernel.unprivileged_userns_clone=1`; LSMs `capability,landlock,lockdown,yama,bpf`; Landlock ABI reported by `landlock_create_ruleset(NULL,0,VERSION)` = **10**; `kernel.unprivileged_bpf_disabled=2`; `kernel.yama.ptrace_scope=1`; `dev.tty.legacy_tiocsti=0`; systemd 262; Node v24.13.0; Claude Code 2.1.306 (native ELF binary); pi 1.1.0 (`@earendil-works/pi-coding-agent`, Node). Probe scripts: `probes/probe.sh`, `probe2.sh`, `sd.sh`, `proxytest.sh`, `client.js`.

## 1. Per-run network namespace + userspace stack (pasta / slirp4netns)

### Takeaway
Dropping `--share-net` and wrapping each run in `pasta --splice-only -T <nsport>:<hostport>` gives each run a private netns whose only route out is one loopback TCP port spliced to one host port (the controller's proxy/broker). Measured locally: ~10 ms extra startup, other runs' ports, host loopback ports, abstract sockets and the internet all unreachable. Fully rootless; pasta is already installed. slirp4netns is not installed and is deprecated by Podman.

### Cited Findings
- pasta "creates a new user and network namespace, and spawns the given command ... A tap device within the network namespace is created"; it can also attach to an existing namespace by PID or `--netns` — [pasta(1), local man page, passt 2026_10_02](https://passt.top/builds/latest/web/passt.1.html)
- `--splice-only`: "Do not create a tap device in the namespace. In this mode, pasta only forwards loopback traffic between namespaces." `-T/--tcp-ns spec`: "Configure TCP port forwarding from target namespace to init namespace" (default `auto`); `-t/-u/-T/-U none` disable forwards; `--no-map-gw`, `--map-host-loopback none` stop the gateway-to-host-loopback mapping that pasta enables by default ("Default is to translate the guest's default gateway address" to host 127.0.0.1) — [pasta(1)](https://passt.top/builds/latest/web/passt.1.html)
- Pitfall in default (tap) mode: by default the namespace's gateway address maps to the host's loopback, i.e. a run could reach every host-loopback service unless `--no-map-gw`/`--map-host-loopback none` is set — [pasta(1)](https://passt.top/builds/latest/web/passt.1.html)
- pasta's tap mode gives general outbound connectivity; there is **no per-destination allowlist option** in pasta (options are interface/address/port-forward/DNS mapping only; none filter outbound by host) — [pasta(1) option list](https://passt.top/builds/latest/web/passt.1.html) (inference from the full option list read locally; no explicit "no filter" statement)
- pasta forwards TCP/UDP ports, not Unix sockets, between namespaces (`-t/-u/-T/-U` take port specs; `-F/--fd` passes one pre-connected socket to passt, which "implies --one-off") — [pasta(1)](https://passt.top/builds/latest/web/passt.1.html)
- Local probe (`probes/probe.sh`, 2026-10-22), host listeners on 127.0.0.1:18080 and abstract `@sf-probe-abs`:
  - `bwrap --unshare-all --share-net` (today's shape): tcp 127.0.0.1:18080 → connected; abstract socket → connected.
  - `bwrap --unshare-all` (no net): 18080 ECONNREFUSED; abstract ECONNREFUSED; 1.1.1.1:443 ENETUNREACH.
  - `pasta -q --splice-only -t none -u none -T 18080 -U none -- bwrap --unshare-user --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup ...`: 18080 → connected to host; abstract ECONNREFUSED; internet ENETUNREACH.
  - `pasta -q --config-net -t none -u none -T none -U none -- bwrap ...`: host 18080 refused, abstract refused, outbound attempted (internet reachable in tap mode).
  - Timing (`time ... -- true`): bwrap alone 3 ms; pasta splice-only + bwrap 12 ms; pasta config-net + bwrap 26 ms.
- Local probe (`probes/probe2.sh`): two runs each with `-T 3128:18090` and `-T 3128:18091` see their own 127.0.0.1:3128 mapped to different host ports (so the host proxy can tell runs apart by listening port); neither can reach other host loopback ports (18082, 18090 refused); run A listening on 127.0.0.1:4000 is unreachable from run B and from the host. Inside `bwrap --unshare-all`, `/proc` shows only PIDs 1 and 2.
- bwrap: `--share-net` "Retain the network namespace (can only combine with --unshare-all)"; `--unshare-net` "Create new network namespace"; `--userns FD`, `--disable-userns`, `--seccomp FD`, `--add-seccomp-fd FD` available in 0.13.0 — [bwrap --help, local 0.13.0](https://github.com/containers/bubblewrap)
- Podman 5.0 made pasta the default rootless network tool; slirp4netns is deprecated and slated for removal in Podman 6 (planned); `default_rootless_network_cmd` in containers.conf selects either — [Podman blog: 5.0 breaking changes](https://blog.podman.io/2024/03/podman-5-0-breaking-changes-in-detail/); [RHEL 10 considerations](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10-beta/html/considerations_in_adopting_rhel_10/containers); [rootlesscontaine.rs Podman](https://rootlesscontaine.rs/getting-started/podman/)
- pasta does no NAT by default; the container shares the host's IP, which broke container-to-host via host IP until Podman 5.3 options — [Podman 5.0 blog](https://blog.podman.io/2024/03/podman-5-0-breaking-changes-in-detail/)
- Codex CLI's bwrap path uses `--unshare-net` and, in managed proxy mode, "an internal TCP->UDS->TCP routing bridge so tool traffic reaches only configured proxy endpoints" (the same pattern as pasta splice, built in-house) — [openai/codex linux-sandbox](https://github.com/openai/codex/tree/main/codex-rs/linux-sandbox)
- Anthropic srt removes the netns entirely and bridges with socat to bind-mounted Unix sockets — [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime)

### Inferences
- Two wiring orders work rootless: (1) pasta outer, bwrap inner without `--unshare-net` (probed; bwrap nests its own userns inside pasta's); (2) Podman-style: bwrap `--unshare-net` first, then `pasta --config-net <PID>` or `--netns /proc/<pid>/ns/net --userns /proc/<pid>/ns/user` attaches (not probed; needs the PID handed back, e.g. via bwrap `--info-fd`). Order (1) is a pure argv prefix and fits `wrapBwrap`.
- pasta outer process is a second long-lived process per run; it must live in the same systemd scope so `cgroup.kill` takes it too. pasta exits when its child namespace goes (default unless `--no-netns-quit`).
- For "provider API + broker only", splice-only + a host-side allowlisting CONNECT proxy is the best fit: pasta gives "one port, nothing else", the proxy gives "these hostnames only". Tap mode (`--config-net`) gives full egress and would need an extra filter that cannot be done rootless (see §4).
- Without tap mode there is no DNS inside the run; this is fine if the client sends `CONNECT host:443` and the proxy resolves. The current `/run/systemd/resolve` bind becomes unnecessary.
- pasta can forward to a host TCP port only; a Unix-socket broker needs either a host-side TCP listener per run or the bwrap bind-mount of the socket file (works across netns, see §3).

### Gaps
- No published startup benchmark for pasta found; the 10–25 ms figures are single local runs.
- slirp4netns not installed; its `--enable-sandbox`/`--disable-host-loopback` behaviour not probed (deprecated, so low priority).
- Whether pasta's own seccomp/sandboxing has had escapes: not researched.

## 2. Egress proxy: Unix socket or loopback port to an allowlisting HTTP CONNECT proxy

### Takeaway
This is what Anthropic's srt / Claude Code `/sandbox` and Codex's proxy mode do on Linux: no netns route, proxy env vars point at a local endpoint bridged to a host proxy that allowlists hostnames. Claude Code honours `HTTPS_PROXY` (HTTP proxies only, no SOCKS); pi 1.1.0 installs undici `EnvHttpProxyAgent` globally so it honours `HTTP(S)_PROXY`/`NO_PROXY`; plain Node 24 honours them only with `NODE_USE_ENV_PROXY=1`. No client accepts a `unix://` proxy URL, so an in-namespace TCP endpoint is needed (socat in srt; pasta splice is a zero-new-dependency alternative here).

### Cited Findings
- srt on Linux: "The network namespace of the sandboxed process is removed entirely, so all network traffic must go through the proxies running on the host (listening on Unix sockets that are bind-mounted into the sandbox)"; HTTP proxy for HTTP/HTTPS and SOCKS5 for other TCP; socat is the "Socket relay for proxy bridging"; env `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` direct traffic, which "may be ignored by programs that don't respect these variables" — [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime)
- srt config: `network.allowedDomains` (wildcards, optional `:port`), `deniedDomains` (wins), empty allowlist = no network, `allowLocalBinding` ignored on Linux; after allowing a name the proxy "resolves it once, drops any address in a denied set, and connects to a surviving address" (denies loopback, link-local, metadata, host's own addresses; private ranges only via `deniedResolvedAddresses`) — [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime)
- srt per-command allowlists are keyed by a proxy username the client presents; "attribution, not a security boundary between concurrent commands"; ids need ≥128 bits of randomness — [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime)
- srt two-stage startup: outer bwrap sets up fs/net/pid namespaces; socat starts inside and the wrapper waits for it to listen; `apply-seccomp` then creates a nested user+PID+mount namespace, applies the filter, and execs — [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime)
- Claude Code `/sandbox` on Linux needs `bubblewrap` and `socat`; commands run "in a separate network namespace that has no connection to your network"; proxy reached via `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`; tools ignoring the vars (ssh, DB drivers, UDP) cannot connect; `curl --noproxy '*'` fails with "Could not resolve host"; a sandboxed command's localhost is private on Linux — [Claude Code sandboxing docs](https://code.claude.com/docs/en/sandboxing)
- Claude Code docs security limitation: "Because the proxy makes its allow decision from the client-supplied hostname without inspecting TLS, code running inside the sandbox can potentially use domain fronting or similar techniques to reach hosts outside the allowlist"; allowing broad domains like github.com "can create paths for data exfiltration" — [Claude Code sandboxing docs](https://code.claude.com/docs/en/sandboxing)
- Note: Claude Code's sandbox wraps only its Bash/PowerShell/Monitor tools; the CLI process, file tools, MCP servers and hooks run outside it — [Claude Code sandboxing docs](https://code.claude.com/docs/en/sandboxing). In this project the whole CLI runs inside bwrap, so the CLI's own API traffic must also traverse the proxy.
- Claude Code "respects standard proxy environment variables" (`https_proxy`, `HTTPS_PROXY`, `http_proxy`, `HTTP_PROXY` in that order; `NO_PROXY`); "Claude Code does not support SOCKS proxies"; a proxy URL it cannot parse stops launch; `NODE_EXTRA_CA_CERTS` trusted; default trusts bundled Mozilla + OS store — [Claude Code network config](https://code.claude.com/docs/en/network-config)
- Claude Code required hosts: `api.anthropic.com` (API, feature flags, telemetry events), `platform.claude.com` ("OAuth token exchange, refresh, and revocation also go to this host for claude.ai accounts"), `claude.ai` (account auth); optional Datadog intake hosts disabled by `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` — [Claude Code network config](https://code.claude.com/docs/en/network-config); `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` also disables feature-flag fetching, auto-updates, telemetry — [Claude Code env vars](https://code.claude.com/docs/en/env-vars)
- Node 24: built-in env proxy support is opt-in via `NODE_USE_ENV_PROXY=1` or `--use-env-proxy`, added in Node 22.21.0 / 24.5.0, covering `fetch`, `node:http`, `node:https` — [Backstage corporate proxy docs](https://backstage.io/docs/tutorials/corporate-proxy); [humanwhocodes, 2026-03](https://humanwhocodes.com/blog/2026/03/proxying-fetch-requests-server-side-javascript); one runbook reported env vars alone did nothing on 24.14.0 — [databay runbook](https://databay.com/integration/node-fetch-proxy-integration)
- Local probe (`probes/proxytest.sh`, Node v24.13.0, stub proxy on 127.0.0.1:18081): `HTTPS_PROXY` alone → fetch went direct (status 404 from api.anthropic.com); with `NODE_USE_ENV_PROXY=1` → proxy saw `CONNECT api.anthropic.com:443 HTTP/1.1` for both `fetch` and `https.get`; `HTTPS_PROXY=unix:///tmp/x.sock` → undici throws "Invalid URL protocol: the URL must start with `http:` or `https:`".
- pi 1.1.0 (local install, `dist/core/http-dispatcher.js`): `configureHttpDispatcher()` does `undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent({... proxyTunnel: true ...}))` and installs undici's fetch globally; called from `main.js` and `rpc-entry.js`; `main.js` also imports `applyHttpProxySettings` — local source, `/home/riley/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js`. undici `EnvHttpProxyAgent` reads `http_proxy`/`https_proxy`/`no_proxy` — [undici EnvHttpProxyAgent](https://undici.nodejs.org/api/EnvHttpProxyAgent). Upstream history: pi-mono PR #939 "support http proxy configuration through environment variables" (merge state not confirmed) — [search result summary only](https://traces.com/s/29d80798-ecdb-4891-9bf6-c252263d29bb/full)
- Codex CLI (current main): bubblewrap is the default; restricted network → `--unshare-net`; seccomp "Restricted network policies block network syscalls"; all modes block `io_uring`; in proxy mode seccomp allows IP sockets inside the isolated netns and "blocks new standalone AF_UNIX sockets unless dangerously_allow_all_unix_sockets is granted"; the legacy Landlock path "is rejected for these policies because it cannot isolate app-server Unix sockets" — [openai/codex linux-sandbox](https://github.com/openai/codex/tree/main/codex-rs/linux-sandbox)

### Inferences
- Minimal zero-new-dependency shape for this project: host-side controller-owned CONNECT proxy (Node `net`/`http`, no deps) listening on a per-run loopback port; run wrapped as `pasta --splice-only -t none -u none -U none -T 3128:<runport> -- bwrap --unshare-user --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup ...` with `--setenv HTTPS_PROXY http://127.0.0.1:3128 --setenv HTTP_PROXY ... --setenv NODE_USE_ENV_PROXY 1 --setenv NO_PROXY ''`; the proxy allows `CONNECT api.anthropic.com:443` (+ `platform.claude.com:443` for OAuth refresh) for Claude runs, the pi provider host for pi runs, and the broker. Per-run host port = identity, so the proxy can apply per-run policy without trusting a client-sent username.
- The broker can be reached through the same spliced port (proxy routes a reserved hostname to the broker) or a second `-T` forward, or a bind-mounted Unix socket path (works without network, see §3).
- srt's socat approach needs `socat` installed (not present here); pasta splice replaces socat and the bind-mounted Unix socket in one tool already installed.
- Even with a perfect allowlist, the allowed provider host is itself an exfiltration channel (a run can send repository data in prompts); the allowlist stops arbitrary destinations, not data leaving to the provider.
- Hostname-only allow decisions without TLS termination are open to domain fronting for CDN-fronted hosts; api.anthropic.com fronting risk not assessed.

### Gaps
- Not probed: Claude Code 2.1.306 actually traversing a CONNECT proxy end-to-end from inside bwrap (docs say yes; bundled Bun runtime behaviour not tested).
- Exact srt socat argv and proxy env var set on Linux not visible in the README excerpt.
- Whether pi providers other than fetch-based ones (e.g. Google `gaxios`) honour the global dispatcher not checked.

## 3. Abstract Unix sockets, Landlock scoping and network rules

### Takeaway
Abstract Unix sockets are scoped to the network namespace (confirmed by man page and local probe), so dropping `--share-net` alone closes the abstract-socket path between runs. With a shared netns, Landlock ABI 6 `LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET` (kernel 6.12+) or a seccomp ban on `socket(AF_UNIX)` blocks it. Landlock TCP rules restrict by port only, not address, so "connect to 443 only" still lets a run reach any host's or peer's port 443 and does not stop localhost peers on that port. Pathname Unix sockets ignore netns; Landlock ABI 9 (`LANDLOCK_ACCESS_FS_RESOLVE_UNIX`, kernel 7.1) can scope them.

### Cited Findings
- "network namespaces isolate the UNIX domain abstract socket namespace (see unix(7))" — [network_namespaces(7)](https://man7.org/linux/man-pages/man7/network_namespaces.7.html)
- unix(7): abstract namespace is "a nonportable Linux extension"; "Socket permissions have no meaning for abstract sockets" — any process in the same netns can connect — [unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html)
- Local probe: with `--share-net`, a sandboxed run connected to a host abstract socket; without it, ECONNREFUSED (`probes/probe.sh`). Host currently has one listening abstract socket (`ss -xl`, name hex-only). A bind-mounted pathname socket (`--bind host.sock /tmp/broker.sock`) was reachable from a `--unshare-all` (no-net) sandbox.
- Landlock ABI ↔ kernel: v4 6.7 (`LANDLOCK_ACCESS_NET_BIND_TCP`, `LANDLOCK_ACCESS_NET_CONNECT_TCP`), v5 6.10 (`IOCTL_DEV`), v6 6.12 (`LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET`, `LANDLOCK_SCOPE_SIGNAL`), v7 6.15 (logging flags), v8 7.0 (`LANDLOCK_RESTRICT_SELF_TSYNC`), v9 7.1 (`LANDLOCK_ACCESS_FS_RESOLVE_UNIX`) — [landlock(7), local man-pages](https://man7.org/linux/man-pages/man7/landlock.7.html); a third-party table gives v7 at 6.13, contradicting landlock(7)'s 6.15 — [landlock-sharp ABI versions](https://docs.curiosity.ai/landlock-sharp/core-concepts/abi-versions). Kernel docs list ABI 10 = UDP rights `LANDLOCK_ACCESS_NET_BIND_UDP`, `LANDLOCK_ACCESS_NET_CONNECT_SEND_UDP`; ABI 11 = `LANDLOCK_RESTRICT_SELF_NO_NEW_PRIVS` — [kernel Landlock docs](https://docs.kernel.org/userspace-api/landlock.html). This kernel (7.2.9) reports ABI 10 (local probe).
- `LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET` "limits connecting to abstract UNIX sockets to those created in the same or a nested domain"; unconnected `sendto()` on datagram sockets counts as connect; sends on already-connected sockets are not restricted; "Scoping has no exceptions through landlock_add_rule()". `LANDLOCK_SCOPE_SIGNAL` limits signals to same or nested domain — [kernel Landlock docs](https://docs.kernel.org/userspace-api/landlock.html)
- Network rules "restrict TCP and UDP port numbers only"; no IP-address rule type — [kernel Landlock docs](https://docs.kernel.org/userspace-api/landlock.html)
- ABI 9 `LANDLOCK_ACCESS_FS_RESOLVE_UNIX` restricts `connect()` / addressed `sendmsg()` to pathname Unix server sockets created outside the new domain; same-domain servers stay reachable; denial = `EACCES` — [kernel Landlock docs](https://docs.kernel.org/userspace-api/landlock.html)
- Landlock limits: sockets/pipes reached via `/proc/<pid>/fd/*` cannot be explicitly restricted; max 16 stacked rulesets — [kernel Landlock docs](https://docs.kernel.org/userspace-api/landlock.html)
- srt's seccomp: static `apply-seccomp` binary, BPF filter returns `EPERM` for `socket(AF_UNIX)`, also blocks `io_uring_setup/enter/register` because `IORING_OP_SOCKET` (5.19+) would bypass it; x64/arm64 only; does not cover inherited or `SCM_RIGHTS`-received Unix fds; `allowUnixSockets` path list ignored on Linux "because seccomp can't filter by path" — [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime)
- Node has no Landlock binding; using Landlock from this project needs a helper binary (e.g. landrun) — [08-a findings, project doc](https://pkg.go.dev/github.com/zouuup/landrun@v0.1.10)

### Inferences
- A Landlock `CONNECT_TCP` allow on 443 does not stop a run connecting to a sibling's 127.0.0.1:443 listener (if a sibling could bind 443 — it cannot unprivileged in the host netns, but could bind any `BIND_TCP`-allowed port) nor to arbitrary internet hosts on 443; it is not a destination allowlist. Denying `BIND_TCP` entirely does stop runs from offering listeners to each other in a shared netns.
- In a shared netns, the combined stack "Landlock ABI 6 abstract scope + deny BIND_TCP + ABI 9 RESOLVE_UNIX with the broker path allowed" would stop run-to-run IPC over sockets, but egress filtering by host still needs the proxy; a per-run netns gets abstract/loopback separation for free and is simpler.
- The seccomp `socket(AF_UNIX)` ban breaks any tool that uses Unix sockets internally (including socketpair-free IPC like git's credential cache); srt still allows socketpairs.

### Gaps
- Landlock ABI 10/11 kernel version numbers not found in a primary table (local man page stops at v9).
- No LWN article fetched; scoping semantics taken from kernel docs.

## 4. systemd user-unit options and nftables cgroup filtering

### Takeaway
In a `systemd --user` manager, `IPAddressAllow/Deny` is silently not enforced ("unit configures an IP firewall, but not running as root"); `PrivateNetwork=yes` and `RestrictAddressFamilies=` work for user **services** but are rejected for **scopes** ("Unknown assignment"). nftables `socket cgroupv2` matching works per cgroup but needs root (CAP_NET_ADMIN in the init netns). None of these give a rootless hostname allowlist.

### Cited Findings
- Local probe (`probes/sd.sh`, systemd 262 user manager, transient units):
  - `systemd-run --user --scope -p IPAddressDeny=any` and `--wait --pipe` service with same: host 127.0.0.1:18080 still reachable; journal: "unit configures an IP firewall, but not running as root."
  - `-p PrivateNetwork=yes`: scope → "Unknown assignment"; service → loopback refused, abstract refused, ENETUNREACH (works).
  - `-p RestrictAddressFamilies=AF_INET AF_INET6`: scope → "Unknown assignment"; service → abstract socket `EAFNOSUPPORT`, TCP to host loopback still works.
  - `-p SocketBindDeny=any`: accepted on both; client-only test so enforcement not exercised.
- systemd docs: IPAddressAllow/Deny "might not be supported on some systems" e.g. when "eBPF control group support is not enabled"; filter "applies to all sockets created by processes of this unit"; `IPAccounting=` "only available for system services, not for per-user services"; `NFTSet=` "not supported for services running in per-user instances"; `SocketBindAllow/Deny` use `cgroup/bind4`/`bind6` BPF hooks — [systemd.resource-control(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)
- `kernel.unprivileged_bpf_disabled=2` on this machine (local), so an unprivileged user manager cannot load cgroup-skb programs itself.
- nft(8): `socket cgroupv2 level NUM` matches "the socket cgroupv2 at a given ancestor level"; the `cgroupv2` attribute is a "path from /sys/fs/cgroup"; the `meta cgroup` key reads zero on cgroupv2-only hosts — [nft(8), local man page](https://wiki.nftables.org/wiki-nftables/index.php/Main_Page). `nft list tables` as the owner: "Operation not permitted (perhaps you must be root?)" (local).

### Inferences
- The current `systemd-run --user --scope` wrapper cannot carry any of these network properties usefully: scopes reject the namespace/seccomp ones and the BPF ones are dropped without root. Switching to transient user services would gain `PrivateNetwork=` (equivalent to bwrap's own netns) and `RestrictAddressFamilies=` (seccomp; blocks abstract sockets by banning AF_UNIX), but nothing bwrap + pasta does not already give.
- A root-installed one-time nftables table (e.g. `meta skuid <owner> socket cgroupv2 level N "user.slice/user-1000.slice/user@1000.service/app.slice/sf-runs.slice" ip daddr != @allowed drop`) would work but violates "no root"; also nft resolves the cgroup path at rule load, so per-run cgroups would need a stable parent slice. (Inference from nft(8) semantics; not tested.)

### Gaps
- No official statement found that IPAddressDeny needs root in user managers beyond the journal message; behaviour with `Delegate=yes` + manual BPF attach not tested.

## 5. Credential handling: keep the OAuth token out of the sandbox

### Takeaway
Header injection by the proxy is supported by Claude Code's `/sandbox` (and srt) via `mask` credentials + `network.tlsTerminate`: the sandbox sees a sentinel, the proxy terminates TLS with its own CA and swaps in the real value for allowed hosts. Applying it to the CLI's *own* model traffic requires the proxy to MITM api.anthropic.com and the CLI to trust the proxy CA (`NODE_EXTRA_CA_CERTS`). With a subscription, the cleanest token for injection is a long-lived `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), since the refresh flow in `~/.claude` writes back and talks to `platform.claude.com`.

### Cited Findings
- srt `credentials.envVars` / `credentials.files` with `mode: "mask"` give the sandbox a sentinel; proxy swaps the real value on egress to `injectHosts` (default: `allowedDomains`); masking "requires network.tlsTerminate" unless `allowPlaintextInject`; masked files work on Linux only — [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime)
- srt TLS termination: CONNECT to allowed host → 200; if first bytes are a ClientHello, TLS terminates in the srt process with a leaf minted for the SNI; request then goes upstream over a separate verified TLS connection; CA delivered via `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `CURL_CA_BUNDLE`, `GIT_SSL_CAINFO`, `CARGO_HTTP_CAINFO` — [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime)
- Claude Code: "When you mask a credential, Claude Code shows sandboxed commands a per-session placeholder called the sentinel, and the sandbox proxy substitutes the real value on outbound requests to hosts you allow"; without `tlsTerminate` "the sentinel reaches the server unchanged and authentication fails"; mask/tlsTerminate honoured only from user, managed, or `--settings` scope, not repo settings; `tlsTerminate` is experimental and "does not add content filtering" — [Claude Code sandboxing docs](https://code.claude.com/docs/en/sandboxing)
- `CLAUDE_CODE_OAUTH_TOKEN`: "OAuth access token for claude.ai authentication. Alternative to /login for SDK and automated environments ... Generate one with claude setup-token ... To replace an expired token, generate a new one and restart"; `ANTHROPIC_API_KEY` sent as `X-Api-Key`; `ANTHROPIC_AUTH_TOKEN` sets `Authorization: Bearer`; `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` + `CLAUDE_CODE_OAUTH_SCOPES` for non-interactive login — [Claude Code env vars](https://code.claude.com/docs/en/env-vars)
- OAuth refresh for claude.ai accounts goes to `platform.claude.com` — [Claude Code network config](https://code.claude.com/docs/en/network-config)
- `ANTHROPIC_BASE_URL` routes requests "through a proxy or gateway" — [Claude Code env vars](https://code.claude.com/docs/en/env-vars)
- Project today: pi's `auth.json` is bound read-write over the overlay so a refreshed login outlives the run (`Policy.writeOver`, 08-g) — local `src/sandbox.ts`.

### Inferences
- Two injection shapes without MITM: (a) point `ANTHROPIC_BASE_URL` at a plain-HTTP controller gateway inside the splice (`http://127.0.0.1:3128`), give the CLI a dummy key/token, and have the gateway add the real `Authorization`/`x-api-key` and forward over TLS — no CA juggling, but whether Claude Code accepts subscription OAuth semantics through a custom base URL (and feature flags/fast-mode checks that still call api.anthropic.com) was not verified; (b) MITM CONNECT with a controller CA as srt does. (a) is simpler for API keys; (b) matches what Anthropic ships.
- With per-run proxy ports, the injector knows which run is calling and can meter or revoke per run.
- pi's auth.json refresh-writeback model conflicts with injection: the refresh must move to the controller side.

### Gaps
- No source found on Docker sandboxes' token injection (not fetched).
- Whether Anthropic terms permit a subscription OAuth token to be injected by a third-party proxy: not researched.

## 6. Known escapes and pitfalls

### Takeaway
Per-run netns + PID namespace + private /tmp + new session already closes most same-UID cross-run paths; the remaining ones are shared writable filesystem paths (files, FIFOs, pathname sockets), the shared proxy/broker itself, DNS/domain fronting through allowed hosts, and anything in the host netns while `--share-net` stays.

### Cited Findings
- TIOCSTI: `--new-session` is in `wrapBwrap` (local `src/sandbox.ts`); `dev.tty.legacy_tiocsti=0` on this kernel (local probe), which disables TIOCSTI for unprivileged users.
- ptrace: `kernel.yama.ptrace_scope=1` (local) limits ptrace to descendants; `bwrap --unshare-all` gives each run its own PID namespace (probe showed only PIDs 1, 2 inside), so siblings cannot name each other's PIDs for `kill`/`ptrace`/`/proc/<pid>` access. Landlock `LANDLOCK_SCOPE_SIGNAL` adds signal scoping — [kernel Landlock docs](https://docs.kernel.org/userspace-api/landlock.html)
- Abstract sockets and loopback TCP are shared under `--share-net` (probe); host listening abstract sockets right now: 1.
- Pathname Unix sockets work across netns when the file is reachable (probe: bind-mounted socket reachable with no network); any shared writable directory therefore permits run-to-run sockets, FIFOs and files. Landlock ABI 9 RESOLVE_UNIX scopes the socket part — [kernel Landlock docs](https://docs.kernel.org/userspace-api/landlock.html)
- `/proc/<pid>/fd/*` sockets/pipes not restrictable by Landlock — [kernel Landlock docs](https://docs.kernel.org/userspace-api/landlock.html)
- io_uring `IORING_OP_SOCKET` bypasses a `socket()`-only seccomp filter; srt and Codex block io_uring — [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime); [openai/codex linux-sandbox](https://github.com/openai/codex/tree/main/codex-rs/linux-sandbox)
- Nested user namespaces: srt's seccomp blocks `unshare`/`clone` namespace flags, `setns`, `mount`, `pivot_root`, and makes `clone3` return ENOSYS so the command stays in the namespace its denies were built in; bwrap offers `--disable-userns` / `--assert-userns-disabled` — [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime); bwrap 0.13.0 `--help` (local)
- Proxy pitfalls: hostname allow decisions without TLS inspection allow domain fronting; allowed hosts are exfiltration channels; DNS rebinding countered by resolve-once-and-check-address — [Claude Code sandboxing docs](https://code.claude.com/docs/en/sandboxing); [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime)
- Pasta default mode maps the gateway address to host loopback (exposes host-loopback services) unless `--no-map-gw` / `--map-host-loopback none`; splice-only has no tap and no gateway — [pasta(1)](https://passt.top/builds/latest/web/passt.1.html)
- D-Bus: `wrapBwrap` binds no `/run` or `$HOME`, so the session bus path socket `/run/user/<uid>/bus` is not reachable (local `src/sandbox.ts` reading); an abstract-address bus would be reachable under `--share-net`.
- Ubuntu 24.04+ `kernel.apparmor_restrict_unprivileged_userns` breaks bwrap — not relevant to Arch, which has no AppArmor in the LSM list here — [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime); local `/sys/kernel/security/lsm`

### Inferences
- SysV IPC / POSIX mqueues are separated by `--unshare-ipc` (part of `--unshare-all`); `/dev` and `/tmp` are fresh tmpfs per run in `wrapBwrap`, so `/dev/shm` is not shared (inferred from bwrap `--dev`; `findmnt /dev/shm` inside showed no separate mount, meaning it lives on the per-run `/dev` tmpfs).
- The broker becomes the one shared channel: it must authenticate runs (per-run port or per-run socket path) and not relay arbitrary bytes between runs, or it reintroduces run-to-run messaging.
- Same-UID host processes outside any sandbox (the controller, the owner's shell) can still ptrace or signal a run's processes; the isolation is one-directional.

### Gaps
- No search for public CVEs in bwrap 0.13 / pasta 2026 releases.
- Cgroup-level kill of the pasta helper when the scope ends not probed.
