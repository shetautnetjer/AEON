# AEON staged consolidation proposal — 2026-09-30

**Dated completion:** the creator approved Stage 1 and the linked worktree moved at **2026-09-30T16:18:20.605519Z**. [Path map, verification and unchanged database boundary](worktree-relocation-2026-09-30.md). Stages 2–4 remain proposals. The sections below preserve the pre-move inventory and plan; old-path literals identify its source, while current navigation resolves the new path.

AEON is the creator's organizing home at `/home/aya-hmw/Documents/ChatGPT/AEON`. It already owns its navigation Git repository. The [local inventory](stack-inventory-2026-09-30.md) identifies existing source, runtime and evidence owners; grouping them here does not transfer ownership or qualify memory utility. This proposal records future gates. At the pre-move planning checkpoint, no relocation, deployment or state migration had been performed. Stage 1 is now complete as recorded above; deployment and state migration remain unperformed.

## One home, existing owners

| AEON navigation area | Components and current owners | Proposed treatment |
|---|---|---|
| Storage | Redis/PostgreSQL: Firecrawl deployed stores; Caura/MemoryD source and historical qualification; Brainstem synthetic M0/validation. Qdrant: proposed Brainstem projection role. | Link each existing owner and its data provenance separately. Do not adopt Firecrawl stores as AYA memory, merge PG17/PG16, or infer a Qdrant deployment. |
| Learning / execution | Monty probe: Jev. DSPy/ReAnchor: Brainstem HLD and creator sources. Observer: Brainstem; legacy index and preflight areas remain separately identified. | Keep source, decisions and acceptance evidence in those owners. Monty host callbacks and Observer native isolation retain their unresolved gates. |
| Observability | Running primary collector: `aya-otel-bootstrap`; metrics collector: `nervous-system-bus-v0`; instrumentation: Hermes and candidate identity lab. Alloy/Prometheus: existing local binary/tooling owner. OpenLLMetry: not found in checked scopes. | Map current routes, state and credential custody before proposing adoption. Downloaded binaries stay under `~/.local/opt/observability`; package caches stay caches. |

The eventual navigation layout may use `docs/` for AEON organization plans and inventory, `worktrees/` for separately owned linked checkouts, and `projects/` only for an existing source owner's separately reviewed relocation. Project-specific plans, decisions and evidence remain in their source project. Cross-cutting Brainstem code is not split into new storage/learning/observability repositories. The initial documentation phase created only navigation documents; it did not create checkout/project directories.

## Stage 0 — completed organization work

Source-linked inventory and this proposal are authored in AEON's existing repository, alongside the README. Existing `.git`, `.trigger-tree/`, repository identity/configuration and concurrent contents are preserved. Only the three assistant-authored navigation documents are eligible for the scoped commit. Historical receipts and private runtime state remain at their existing paths.

Rollback for this documentation stage is an ordinary scoped Git revert of the navigation commit. It does not touch implementation owners, dispatcher metadata or state. This inventory records a dated snapshot; later observations should be added with dates rather than silently rewriting original qualification outcomes.

## Stage 1 — approved move, completed; retained execution plan

Move only the already reviewed Brainstem continuation linked worktree:

- Pre-move location: `/home/aya-hmw/Documents/Codex/2026-09-30/task-3/brainstem-continuation`.
- Approved destination, now current: `/home/aya-hmw/Documents/ChatGPT/AEON/worktrees/brainstem-continuation`.
- Original Git/source owner remains `/home/aya-hmw/aya/projects/developmental-lab/brainstem`, including its 63 pre-existing changes, source paths and stopped qualification data.

Before execution: confirm no active editor/test/agent uses the checkout, clean branch/index and exact HEAD, destination absent, original Git/worktree metadata intact, and all app/task/navigation references mapped. Explicitly approve AEON's scoped `/worktrees/` Git exclusion so the navigation repository cannot stage another owner's checkout. Record a dated old→new locator map and update current navigation links; keep historical source paths as provenance, with the map resolving them.

Use the original repository's `git worktree move`, preserving the existing branch, commits and bytes; do not copy or initialize another repository. Verify both Git pointers, source pins, branch/HEAD/status, original dirty baseline, document links and the relevant offline evaluator suite from the new path. The checkout name remains `brainstem-continuation`, so the already documented test-only package alias remains necessary. No database, runtime, service, cron, credentials or installed plugin moves are included.

**Creator-approved scope, now completed:** the two paths above, scoped AEON `/worktrees/` exclusion, current-navigation/dated path-map edits, post-move offline verification, and reverse `git worktree move` if verification fails. If destination/concurrency/reference checks fail, stop before moving. The task's selected cwd remains outside the checkout. Rollback requires quiescence again, the old destination free, reverse Git move and restored current navigation, followed by the same pointer/hash/status checks. This exact move completed; see the dated receipt above.

The detailed existing [owner/dependency plan](/home/aya-hmw/Documents/ChatGPT/AEON/worktrees/brainstem-continuation/docs/plans/2026-09-30-aeon-local-organization.md) remains the source for this stage. Moving the original dirty Brainstem repository or Jev is a later, larger proposal.

## Stage 2 — source-owner consolidation, separately reviewed

For each proposed source relocation, first map Git/worktrees and untracked work, absolute interpreter/import paths, Compose project and ordered file paths, mounts, networks, installed plugins, jobs/service definitions and consumers. Agree one exact source→destination mapping and custody. Preserve the existing Git owner and receipt history; no second checkout/repository or new aggregate runtime is implied.

| Owner | Required dependency checks before a move | Rollback limit |
|---|---|---|
| Firecrawl / Caura / MemoryD | Keep distinct data roles. Preserve Compose project/file order, service routes, volume identities and binding UID/GID. MemoryD also depends on a SQLite outbox and Caura REST; historical health is not current health. | Returning source paths alone does not restore changed data or a recreated Compose deployment. No runtime recreation is authorized here. |
| Jev / Monty | Preserve 30 pre-existing entries and four untracked Monty files; pin them separately if adopted. Rebuild/verify the hardcoded `.venv` entrypoint only under an approved environment plan. | A cached Monty binary/mock receipt is insufficient for host callback or live procedure qualification. |
| Brainstem / Observer | Preserve original failures, corrected receipts, synthetic disks and source-generation identities. `state.db` canonical path/device/inode contribute to Observer identity. | Moving a source database changes identity; restoring a pathname may not restore its inode. Native boundary gaps remain. |
| Primary OTel / metrics collector | Preserve Compose owner and four-file order, loopback ports, external networks, collector image pin, `state/` bind, credential mounts and separate Hermes route. Inspect app/UI references to the current ChatGPT owner path. | A loaded Hermes hook requires restart to disable; existing route rollback is not a no-service-change operation. No live relocation/recreation is included. |

Separate candidate source destinations can later be proposed under `AEON/projects/`, after these mappings. Existing installed binaries, virtual environments, model caches, database state, secrets and original transcripts need not live beside source. No symlink workaround is assumed: protected AYA runtime directories require real UID-owned mode-700 directories.

## Stage 3 — adoption and wiring decisions, distinct from relocation

- **Storage:** decide the authoritative source/eligibility contract and intended Redis role before deployment. Qdrant remains a rebuildable projection design, not an authorization to install/provision. Firecrawl cache/store availability does not meet AYA memory acceptance.
- **Learning:** select the independently controlled task/evidence lane and freeze custody/judge, static material, treatment, budgets and metric before consumer experiments. The committed adapter only qualifies fixed exposed-development artifact checking; `utility_qualified=false` and `release_evaluated=false` remain. DSPy/ReAnchor fitting needs compatible typed APIs and independent labels. Monty needs bounded host authority review; Observer needs its native review gaps resolved.
- **Observability:** decide whether downloaded Alloy/Prometheus extend or replace any existing route; map occupied 4317/4318/4320/13133 ports first. Name scrape targets and a Prometheus TSDB owner, retention, permissions and shutdown/rollback procedure. Resolve the absent SPARK target before claiming metrics delivery. OpenLLMetry adoption is a new package/instrumentation choice, not implied by OTel installation.
- **Qualification:** define per-route local tests and evidence classes before running anything. Retained backend readback is historical; any new external read or exporter operation needs a separately authorized scope. Preserve current content-capture settings, route identities and credential custody.

No model consumer, install/pull, collector config, service restart, cron change, database admission or backend test is authorized by this organization proposal. The already completed offline adapter remains the next implementation foundation while the experiment decisions are reviewed.

## Stage 4 — persistent data migration, separate execution plan

Do not relocate or combine the anonymous Firecrawl PG17 volume, synthetic PG16 bind directories, Caura's configured stores, SQLite/WAL files, collector JSONL state or any future Prometheus TSDB under a source move. Each needs an exact storage owner, version/schema/extension compatibility checks, UID/GID/permissions, retention and privacy policy, validated backup/restore, cutover/downtime and rollback criteria. No existing backup has been verified by this inventory.

Redis's current Firecrawl instance has no persistence mount; Caura's separate configured Redis is append-only and has namespace/TTL/outage semantics. PostgreSQL major versions and synthetic/real scopes must stay separate. Caura migration 012 clears embeddings; a source return or downgrade is not data recovery. Its [rollback guide](/home/aya-hmw/aya/projects/caura/docs/upgrading-from-v1.md:126) prefers a pre-upgrade snapshot, whose existence is unverified; optional ANN pooling requires an independently established pgvector version. Qdrant projection rebuilds require accepted source/version provenance, not copy/merge assumptions.

Private `.aya`/`.hermes` runtime, identities, session databases, credentials, local working-memory stores and archived receipts remain retained. Physical consolidation can proceed incrementally only through the exact reviewed stage; AEON's home role does not grant a blanket migration.
