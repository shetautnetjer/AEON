# AEON-EVENTS-001 — Brainstem plugin/profile/runtime addendum review

**Verdict: ACCEPTED as a planning addendum.** The separation of reusable Brainstem capabilities, separately bound agent profiles, reviewed team knowledge and private runtime state is sound. No blocking architecture revision is needed within this planning-only scope. This is not acceptance of a working multi-profile plugin, storage isolation, migration or activation.

Reviewed exact [addendum](../work/active/AEON-EVENTS-001-aya-runtime-plugin-addendum-2026-10-01.md):

```text
SHA256 8e5e095b5d2d1e5104cad12e630ad3e17019a4e2c5a98c7528fc8f38507aed84
```

Date: 2026-10-01. Independent reviewer task `01a0f621-2449-724c-9d02-7413f344b038`; requested architecture role Astra/xhigh. Effective model/effort provenance remains with the parent’s execution receipt. The [producer validation receipt](/home/aya-hmw/Documents/Codex/2026-09-30/task-6/AYA-plugin-runtime-addendum-validation.json) matches this document hash; its preservation/test claims remain producer evidence except where independently checked below.

**Smallest next safe step:** Mufasa assigns one exact Brainstem worktree and file allowlist for Sol/high to author a local, read-only synthetic package with a portable fixture adapter; fresh Sol/medium reviews its source and relevant tests. Preserve the Hermes binding and original dirty checkout. Use package-owned synthetic inputs, no native AYA home, no installer, real backend, account or model call. Selecting that bounded source task does not require reopening the whole architecture or obtaining repeated approval for ordinary tests/fixes.

Standalone Paperclip availability remains independently owned. The parent reports it running locally; I made no runtime query and do not re-gate or certify that startup. Brainstem packaging, adapter qualification, live integration and native AYA account authorization remain different outcomes.

**Concrete findings to carry into the next scoped tasks**

These are implementation/deployment holds already anticipated by the addendum, not reasons to introduce another framework.

1. **P2 — Portability must be demonstrated before calling the first package reusable.** Addendum lines 23 and 39 acknowledge the existing fixture dependency but do not select its replacement yet. [fixture_binding.py:8](../worktrees/brainstem-native-recall/tests/aya_recall_fixture/fixture_binding.py:8) names AYA’s installed private-workspace gate; [_isolated_perform:21](../worktrees/brainstem-native-recall/tests/aya_recall_fixture/fixture_binding.py:21) reads and compiles its pinned function. Constructing the current facade therefore depends on that host path even though imports do not start a server. Do not merely wrap this file in a generic manifest. Assign a small package-owned or explicitly injected synthetic adapter seam, with source provenance and the same fixed source/project allowlist. Preserve the original native fixture and its dated results. Acceptance: construction and recall/source/history tests work from a disposable checkout without reading `~/.aya`; missing bindings abstain; malformed input, source parity and correction-history controls remain. No general production/profile backend is needed for this step.

2. **P2 — Team-sharing proof needs a protected provenance boundary as well as audience checks.** The addendum correctly leaves authenticated principal/profile/team mapping and admission unresolved. [memory_v0.py](/home/aya-hmw/aya/projects/developmental-lab/brainstem/memory_v0.py) takes project/profile identifiers and retains candidate state; the [strict candidate schema](../worktrees/brainstem-native-recall/schemas/memory-record.v0.candidate.schema.json) supplies neither an ACL nor team authority. In the later two-profile synthetic binding task, include an admitted shared claim whose original evidence is private: an allowed shared reader must not traverse its source/history references into the other profile’s private body or protected metadata. Keep private provenance resolvable only by its authorized owner, with audience-safe references where needed. Test spoofed profile, missing/wrong audience, unauthorized promotion/correction, revoked membership and stale index/cache hydration. Real access remains blocked until a host-authenticated binding and storage enforcement exist; same-UID logical filters and a Codex `--profile` name are insufficient.

3. **P2 — Installation and migration require version-pinned host evidence, not package shape alone.** Current [official packaging documentation](https://developers.openai.com/plugins/build/plugins) supports root `plugin.json`/`mcp.json` and the compatibility route; this does not prove the selected local host supports the chosen package. Independently observed `~/.local/bin/codex` now resolves to `0.159.3`, while accepted M1 retains its `0.159.2` pin. Select one host/package route and validate its schema/path/transport contract; preserve both dated version facts. Do not rename legacy `.mcp.json` mechanically into the portable format. Host discovery/installation stays a separately scoped later step. For migration, the [maintained launcher:18](/home/aya-hmw/Documents/Codex/2026-09-30/task/foundation_stage/aya_codex.py:18) fixes `CODEX_HOME`, and [its root/CWD checks:34](/home/aya-hmw/Documents/Codex/2026-09-30/task/foundation_stage/aya_codex.py:34) prevent a symlink or caller-environment shortcut. Change and review the maintained source and installation mapping together only within an authorized relocation packet.

**Boundaries accepted**

- **Source and authority:** Brainstem remains the reusable code, contract and memory/admission owner. AEON remains navigation/artifact custody; Paperclip owns live task execution only for an explicitly adopted mapping. A Paperclip assignee or team membership grants no private-memory capability.
- **Private versus shared memory:** Sharing is a separately reviewed record/reference with audience, attribution and revision lineage, not a relabeling or export of private episodes. Retrieval rechecks current scope and disposition; missing binding cannot default to AYA. No new team schema, IDs, stores or admission writer is accepted here.
- **Profiles and credentials:** Generic package instructions must contain no AYA identity/preferences, private data or credentials. Separate auth/session homes are required for real independent profiles, with actual isolation still to qualify. Managed-home login seeding and skills injection are not authorization to share credentials.
- **Runtime location:** `AEON/var/aya/` fits the existing convention as a future proposal. Both proposed runtime paths are absent, and current exclusions do not cover `var/aya/`. Verify the exact Git exclusion and private permissions before any private file is created; ignoring a path is not access control. Zero relocation is the right first package phase.
- **Continuity and rollback:** Treat the full home as config/auth plus durable session/database state, not disposable cache. The documented [state-location rules](https://learn.chatgpt.com/docs/config-file/environment-variables) support the addendum’s warning that partial SQLite/log redirection is not a complete home move. Require owned writer quiescence, a consistent database/WAL cohort, preserved native IDs and references, and recognized resume authority. Fence the new writer and reconcile post-cutover records before restoring the old home; retain both histories without hot-file merging. A fresh session is not continuity.
- **Approval discipline:** Routine assigned offline source/test work continues within its scope. Installation, private sharing, credential custody, relocation and account/model execution each need their concrete effects and existing authorization checked. Do not conflate those gates with basic Paperclip availability.

The later final-user approval or other coordination controls belong to the relevant integration plan; this addendum does not add a per-tool approval loop. Essential source/parity/privacy/recovery tests remain required despite model prompting guidance.

**Preserved gates and evidence**

The two native AYA authorization denials remain unresolved: zero native/model launches for that attempt, no retry or alternate route. Packaging, moving a directory or using Paperclip supplies no bypass. Plugin installation, real team isolation and supported session migration remain unqualified. The PG 12-read receipt and earlier zero-gain comparison retain their original limits.

Independent readback confirmed:

- Accepted M1 plan SHA256 `6b1ab38939cfd9b18edcfd0a4187f9b70360ef38847c439284cf5ed376aa7512`; its architectural acceptance and current source/result artifacts were pinned for preservation, not rereviewed or rerun.
- AEON HEAD `883df8318f19158400940f75dfbc7f8be47d2025`; original Brainstem HEAD `26e5de877ac3a703e2b4e0c7faab9d43598c68be`, 63 grouped dirty entries and status SHA256 `ea08bdb4367bb74c00a3b6d23612e1aa4e35393c7843831cf02a8957308ba72b`.
- Installed and maintained launcher source both hash to `62fdfa9e121a047c02f7508c3c35cb57c69d992a866b82cab21be9eff7ff9366`.

Relevant owners, fixture/facade/manifest source, candidate profile filtering/schema, launcher, exclusions and current official packaging/configuration references were read. Authentication, identity, session, database and raw-log bodies were not read. I did not reproduce the producer’s full 28-pin or 385-path audit and did not run tests, start a process server or inspect live services.

Only this new review artifact is authored. The addendum, accepted M1, prior reviews, runtime/configuration, credentials and original dirty source are unchanged by this review.
