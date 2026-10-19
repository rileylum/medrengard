# 08-g findings — does the `.pi` overlay lose pi's refreshed login?

Date: 2026-10-19. Source read: the npm packages `@mariozechner/pi-ai` and `@mariozechner/pi-coding-agent` at 0.73.1 (published 2026-05-07, the latest on npm), unpacked under `/var/tmp/software_factory/08-g/`. No session read `~/.pi`.

## Answers

1. **pi writes refreshed tokens to `auth.json`: yes.** `AuthStorage.refreshOAuthTokenWithLock` in `pi-coding-agent/dist/core/auth-storage.js` refreshes only when the stored token has expired. It merges the new credentials and passes them to `withLockAsync`, which writes the file in place with `writeFileSync` and sets mode 0600. It holds a `proper-lockfile` lock (an `auth.json.lock` directory beside the file) while it does so.
2. **The refresh replaces the refresh token: yes.** `refreshAccessToken` in `pi-ai/dist/utils/oauth/openai-codex.js` refuses a token response that has no `refresh_token`, and stores the new one as `refresh`. pi 1.1.0 states that OpenAI rotates refresh tokens (below).
3. **A write under the overlay vanishes after the run: yes.** `tests/sandbox.test.ts` ("bwrap: an overlay directory takes writes inside and leaves the host directory unchanged") and `tests/cli-adapter.test.ts` ("sandboxed adapter: … overlay config is dropped") already show it.

Together: a sandboxed pi run that finds an expired token spends the stored refresh token, writes its replacement into the overlay, and loses it at exit. The next run presents the spent token and gets `invalid_grant`.

## The installed version: 1.1.0

The owner ran `pi --version`: `1.1.0`. pi moved from `badlogic/pi-mono` to `earendil-works/pi`, and npm stops at 0.73.1. The tag `v1.1.0` in `earendil-works/pi` has the live wording, so the answers were checked again there:

- `packages/ai/src/auth/oauth/openai-chatgpt.ts`: `refreshAccessToken` posts the stored refresh token. `credentialFromTokenResponse` refuses a response with no `refresh_token`, and stores the new one. The error "OpenAI OAuth token request failed (400)" comes from this file.
- `packages/ai/src/auth/resolve.ts`: `refreshStoredOAuthCredential` refreshes and saves under the store's lock, and wraps a failure as "OAuth refresh failed for <provider>". Its comment states the rotation outright: "the provider may already have rotated the refresh token … Otherwise a cancelled caller could discard the only valid refresh token."
- `packages/coding-agent/src/core/auth-storage.ts`: writes `auth.json` in place with `writeFileSync` (mode 0600), under a `proper-lockfile` lock, with no rename. A file bind therefore keeps the write.

The cause holds for 1.1.0. One more case follows from that comment: a run killed at the stage deadline in the middle of a refresh can also lose the new token. The fix does not cover that case.

## What the fix must handle

- **Mount order.** `wrap` mounts the binds before the overlays, so a writable bind of `~/.pi/agent/auth.json` would sit under the `.pi` overlay and be hidden. The fix needs a bind that `wrap` mounts after the overlays.
- **The lock** goes in the overlay and is dropped at exit. That is harmless for one run at a time.
- **Concurrent pi runs** each have their own overlay, so they cannot see each other's lock. Two runs that find the token expired at the same moment would both refresh, and one would get `invalid_grant`. The driver runs one stage at a time today, so this only matters once pools exist (row 13).

## Risk for the owner

- **A writable `auth.json` lets any pi run overwrite or delete the owner's pi login.** A developer run has unrestricted bash in the sandbox, so it could do this by mistake or on purpose. That is damage outside its remit (A-037).
- **Exposure is unchanged.** Runs can already read their CLI's credentials (D-021), so this change only adds the power to write.
- **Binding only reviewer runs does not fix it.** Whichever run first finds the token expired spends the refresh token. If that run is a developer run, the login is lost as before.

The real choices are therefore:

1. **Bind `auth.json` writable for every pi run, and accept the risk.** Worst case: the owner logs pi in again.
2. **Leave it as it is.** The owner logs pi in again whenever a refresh is lost.
3. **Refresh outside the sandbox before each pi run.** pi has no refresh-only command, so the controller would need its own copy of pi's OAuth refresh. That adds code and a second writer of `auth.json`.
