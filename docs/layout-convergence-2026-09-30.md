# AEON layout convergence — navigation only

The creator requested a reusable layout. A read-only inventory found existing root README, `docs/`, `bibles/`, `observability/`, `worktrees/`, `tools/`, `tests/`, ignored state/artifacts and `.trigger-tree/` metadata; root AGENTS/PROJECT/STATUS/DECISIONS and inbox/resources/work/outputs/archive indexes were absent. This change fills those navigation gaps while preserving existing content and ownership.

| Requested role | Actual owner / action |
|---|---|
| Operating rules | Add root [AGENTS.md](../AGENTS.md); no nested rulebooks needed |
| Purpose + HLD/PRD/LLD/SDD routes | Add [PROJECT.md](../PROJECT.md), linking existing Brainstem architecture, Guide and bounded schemas instead of copying/replacing them |
| Current evidence | Add [STATUS.md](../STATUS.md), dated receipts and exact compact-gate commit; retain original failed and synthetic-success evidence |
| Choices | Add [DECISIONS.md](../DECISIONS.md), organization/memory-role/event direction and remaining scope gates |
| inbox | Add [triage index](../inbox/README.md); no watcher |
| Bible/domain sections | Keep [bibles/](../bibles/README.md), authored index/domain Markdown and generated HTML/SVG; no rename or new semantic taxonomy |
| resources | Add [source-route index](../resources/README.md); original resources remain owners |
| work/queued-active-completed | Add [one work index](../work/README.md) and folder navigation; link tasks without relocating/copying their plans/evidence |
| outputs/archive | Add [output routes](../outputs/README.md) and [history routes](../archive/README.md); existing docs, safe receipts and ignored state remain in place |

`docs/` continues owning AEON organization/plans/safe results; `observability/pilot/` owns its existing code/config/tests/evidence. The linked Brainstem checkout keeps its original repository owner and scoped `/worktrees/` exclusion. Private runtime, databases, installed artifacts, source repositories and session/credential stores remain untouched. A future physical relocation needs an exact dependency/reference/rollback proposal; this change authorizes none.

The physical Bible path remains lowercase `bibles/`. A capitalized rename provides no demonstrated benefit here and would touch renderer/tests, navigation links, generated views and external pinned references. No rename patch is proposed or executed. Current STATUS points to later evidence where initial inventory/Bible preparation language has been superseded by finite synthetic execution. Authored Bible index and generated source semantics are retained unchanged.

Event-based coordination is preferred. Task-ready, blocked, review-ready and completed require stable identities, one owner and duplicate-delivery handling; concurrent editors use separate worktrees. Current platform completion notifications are available, while local `.trigger-tree/` implementation/permissions/event delivery are not established by this inventory. Evaluate existing source before adding another dispatcher. No daemon/cron/orchestrator, deployment, autonomous model budget or new storage integration is installed.

Rollback is a scoped revert of these navigation additions/corrections, preserving original source/state owners and metadata. Validate local links, existing generated-Bible freshness and navigation tests; checks establish navigation consistency, not production qualification.

Verification: **123 local Markdown links**, all **15 Bible navigation tests**, and generated-view freshness for **20 components / 16 relationships** pass. Brainstem remains clean at `24e16e818085f9ae26d4a1858a01928f411f165d`; authored Bible JSON, derived HTML/SVG, code/config and original failed receipts are unchanged. Checks establish navigation consistency only.
