Branch: feat/11-b2-shared-clones (stacked on feat/11-b-layout)

# Shared clones against a base-only mirror (ticket 11-b2)

## Problem

`develop` makes each cycle's clone with `git clone --no-hardlinks --no-checkout <repo>` (`src/developer.ts`, `clone`). That is a full copy of the repository's `.git` per cycle (110 MB measured on a 106 MB `.git`; the owner's own repository has 508 MB), and it copies every ref: private branches and every other cycle's `sf/*` reach the developer. A-126 decides that each clone is `git clone --shared` against a bare mirror the controller owns; A-121 (d) decides the clone holds only the base's history.

Facts the design must respect:
- `--shared` writes `objects/info/alternates` in the clone. If the source prunes objects, the clone is corrupt (git-clone). So the source is a mirror the controller never prunes, not the owner's repository.
- Three sandboxes read the clone's objects: the developer run (`cliAdapter`, cwd the clone), `cloneGit` (fix's branch checks) and `upload-pack` in `land`. Each must bind the mirror's objects read-only at the same path. Verify and review read the owner's repository and the verify checkout, not the clone.
- The developer may write anything in its clone, including `objects/info/alternates`. The controller must never read that file to decide what to bind: the bind comes from the layout, not from the clone.
- Clones made before this ticket have no alternates. `fix` on such a cycle must still work.
- `fetch.fsckObjects` in `land` checks objects that come from the clone. Objects already in the owner's repository are not sent.

## Interface

```ts
// src/layout.ts (from 11-b), one more path
/** <runsDir>/mirrors/<key>.git; key: first 16 hex of sha256 of the repository's real path. */
export function mirrorPath(runsDir: string | undefined, repo: string): string;

// src/adapter.ts
interface RunRequest { /* … */ read?: string[] }

// src/developer.ts
/** Fetch the base into the repository's mirror, making the mirror on first use. Controller git; the source is the owner's repository. */
function mirrorBase(repo: string, mirror: string, base: string): void;
```

- **Where.** One bare mirror per repository under `<runsDir>/mirrors/`, keyed by the repository's real path, so two job files on one repository share it and two repositories never do.
- **What it holds.** Only base commits: `develop` fetches the resolved base SHA into `refs/bases/<sha>`, nothing else. No `refs/heads/*`, no tags, no `sf/*`. The mirror's config sets `gc.auto=0` and `gc.pruneExpire=never`, so nothing it holds is ever pruned.
- **Who fetches, and when.** The controller, in `develop`, after `store.open` and just before the clone, outside any sandbox. A failed fetch cancels the cycle, as a failed clone does today (A-134). It reads the owner's repository, which the controller already trusts. Never a sandboxed process; nothing writes to the mirror after a run.
- **The clone.** `git clone --shared --no-checkout <mirror> <clone>`, then `checkout -b sf/<cycleId> <base>`. The clone sees no refs from the mirror, because the mirror has no `refs/heads/*` and no tags (`--no-tags` on the fetch). `--shared` copies and links no object, so `--no-hardlinks` has nothing left to do and is dropped; A-038's rule, no hardlink to a file the developer can write, still holds.
- **The bind (A-134).** `RunRequest` gains `read?: string[]`: absolute paths the controller asks the run's sandbox to bind read-only. `develop` and `fix` set it to `[<mirror>/objects]`; `cliAdapter` adds it to the policy's `read`. `cloneGit` and `land` add the same path to their policy's `read`. A missing mirror (a clone made before this ticket) is not bound. Extension runtimes receive the field in the request JSON and may ignore it. `CliSpec.bind` cannot carry it: adapters are built before `develop` knows the mirror, and `cliAdapter` refuses a `sandbox.read` path that does not exist yet.

## Alternatives

1. **`--shared` against the owner's repository directly.** Rejected: the owner's `gc` would corrupt every open clone, and every ref and object in the owner's repository, private branches included, would be readable by the developer.
2. **A mirror of the owner's branches by name (`refs/heads/*`, fetched whole).** Rejected: it brings in private branches and `sf/*`, which A-121 (d) excludes.
3. **One mirror per base SHA.** Rejected for now: no object from one base leaks to a cycle on another, but the saving shrinks to cycles that share a base. The pools row (A-126 item 2) keys its overlay by base SHA, and may revisit this.

## Threat model

- New state that sandboxes read: the mirror, bound read-only, written only by the controller from the owner's repository.
- What a developer can read grows by every base commit any earlier cycle on the same repository used, through alternates. Today's clone copies every ref, so this is still less than today. A cycle whose base is a private branch puts that branch's history in the mirror for later cycles on the repository.
- A developer that rewrites its clone's `alternates` can name only paths its sandbox binds.

## To probe before code

- `git fetch <repo> <sha>:refs/bases/<sha>` from a local path: whether it needs `uploadpack.allowAnySHA1InWant` on the owner's repository, or the base must be fetched by ref name, or pushed from the repository into the mirror instead. The owner's repository config is not changed.
- `upload-pack` in bwrap with the clone and `<mirror>/objects` read-only, serving a branch whose base objects live only in the mirror, into a repository with `fetch.fsckObjects`.
- claude and pi developers committing in a shared clone inside bwrap (one paid run each, with the owner's go).

## Not decided here

- Removing a mirror, or old `refs/bases/*` in it: Housekeeping row (A-111).
- An overlay checkout per base SHA: pools, row 13 (A-126 item 2).
- Resetting the clone's `.git/hooks` and `.git/config` after a run: Sandbox hardening row, A-121 (c).
