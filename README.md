# AEON

Local navigation home for AYA memory-related work. Start with [operating rules](AGENTS.md), [project routes](PROJECT.md), [current evidence](STATUS.md), [decisions](DECISIONS.md) and the [work index](work/README.md). Projects keep their existing source, Git history, plans, decisions and evidence; this index points to those owners.

## Current

Current Brainstem continuation is `codex/brainstem-exposed4-protocol-20260930`, commit `24e16e818085f9ae26d4a1858a01928f411f165d`: compact judge preparation, 10 focused/61 branch tests, no new live model calls. The prior exposed attempt stopped at judge timeout; all eight consumers remain not run and no primary delta exists. The finite synthetic telemetry lifecycle passed 14 checks and stopped its owned resources. [Dated current evidence and remaining gates](STATUS.md).

Historical foundation: offline evaluator `9043cc9a92aff59475fc329b189601afacd91b48` followed reconciliation `23bd0e06844199a160bda7680f0a27c72ac05597`, with 19 focused/105 relevant tests. These retained development results do not qualify learning or release.

This folder was already initialized as Git and contains existing dispatcher metadata. The navigation additions preserve that state. The approved development worktree moved into `worktrees/brainstem-continuation` on September 30; original source, runtime, database and evidence owners remain in place. [Dated path map and verification](docs/worktree-relocation-2026-09-30.md).

## Projects

| Subject | Existing owner |
|---|---|
| Brainstem implementation, primary HLD, schemas and tests | [Brainstem](/home/aya-hmw/aya/projects/developmental-lab/brainstem/README.md), [primary architecture](/home/aya-hmw/aya/projects/developmental-lab/brainstem/architecture.html) |
| Current reviewed continuation | [Source reconciliation](/home/aya-hmw/Documents/ChatGPT/AEON/worktrees/brainstem-continuation/docs/reports/2026-09-30-aya-continuation/README.md), [offline binding](/home/aya-hmw/Documents/ChatGPT/AEON/worktrees/brainstem-continuation/scripts/compare_candidate_artifacts.py) — linked worktree sharing Brainstem's Git owner |
| Jev contracts, catalog, decisions and receipts | [Jev owner instructions](/home/aya-hmw/aya/projects/jev-cli/HERMES.md) |
| AYA native workspace and runtime | [Workspace instructions](/home/aya-hmw/.aya/workspace/AGENTS.md), [persistence instructions](/home/aya-hmw/.aya/codex/INSTRUCTIONS.md) — existing private runtime directories remain in place |
| Local `aya-working` supporting memory projection | `/home/aya-hmw/aya/basic-memory-mirror`; [bounded qualification adapter](/home/aya-hmw/.aya/workspace/tools/aya_memory_gate.py) — source-backed qualification, not general admission or migration |

## Bible navigation

The [Bible operating rules and examples](bibles/README.md) lead to the [machine-readable source index](bibles/index.json), [generated HTML view](bibles/index.html) and [relationship SVG](bibles/relationships.svg). Memory and observability definitions remain with their existing source/schema owners; these views establish navigation only.

## Stack navigation

The [September 30 local inventory](docs/stack-inventory-2026-09-30.md) records versions, running/stopped state, source owners, data bindings and retained qualification. The [staged consolidation proposal](docs/stack-consolidation-2026-09-30.md) maps dependencies and rollback before any physical move or deployment.

| Area | Components / verified status |
|---|---|
| Storage | Redis 8.10.2 and PostgreSQL 17.11 run for Firecrawl; three Brainstem PG16.15 test containers are stopped. Caura/MemoryD configuration and historical receipts remain separate. Qdrant is a design target; server not found, client availability unknown. |
| Learning / execution | Pydantic Monty 1.0.0 is cached with an untracked Jev mock probe. DSPy/ReAnchor are design references; runtime/fitting evidence not found. Brainstem Observer has prototype source/build and partial receipts with unresolved native review failures. |
| Observability | Separate OTel SDK installations and two collectors exist. Hermes has a configured trace route with historical qualification. Initial inventory found Alloy 1.20.1/Prometheus 3.15.0 unwired and OpenLLMetry absent. The later [finite synthetic lifecycle](docs/tempo-lifecycle-synthetic-result-2026-09-30.md) verified isolated instrumentors/Alloy/Tempo/Grafana/Prometheus, then stopped the pilot. Real AYA integration remains unqualified. |

These findings support one navigation home while existing projects own implementation and state. Package availability and running containers do not establish accepted AYA memory utility. No installs, runtime/configuration changes, database reads/moves or remote operations occurred during this inventory.

## Plans

- [AYA continuation and remaining experiment boundary](/home/aya-hmw/Documents/ChatGPT/AEON/worktrees/brainstem-continuation/docs/plans/2026-09-30-aya-local-continuation.md).
- [Local observability integration proposal](docs/local-observability-plan-2026-09-30.md) — retained source/capture plan; subsequent finite synthetic execution is linked in STATUS, real capture/reroute remains separate.
- [Pinned offline telemetry preparation and startup approval](docs/observability-startup-approval-2026-09-30.md) — historical accepted artifact/startup packet; finite synthetic results are retained in STATUS. No ongoing activation follows.
- [AEON dependency map and exact relocation proposal](/home/aya-hmw/Documents/ChatGPT/AEON/worktrees/brainstem-continuation/docs/plans/2026-09-30-aeon-local-organization.md).
- [Retained HLD Guide](/home/aya-hmw/aya/projects/developmental-lab/brainstem/docs/review-packets/2026-09-29-hld-convergence/Guide.md) — design/review input alongside the primary architecture.

## Decisions

Project-specific decisions remain with their project and Jev owners. [Current decisions](DECISIONS.md) preserve the failed exposed attempt, compact-gate pending approval and event-based coordination direction.

The creator approved the continuation worktree move to `AEON/worktrees/brainstem-continuation`; it is complete. The scoped `/worktrees/` exclusion keeps Brainstem code under its original Git owner. Any further source, service or persistent-state relocation needs its own dependency plan. No database or provider connection changed.

## Evidence

- [Adapter contract, independent review and verification](/home/aya-hmw/Documents/ChatGPT/AEON/worktrees/brainstem-continuation/docs/reports/2026-09-30-aya-continuation/offline-evaluator-adapter.md).
- [Source-linked creator intent and receipt ledgers](/home/aya-hmw/Documents/ChatGPT/AEON/worktrees/brainstem-continuation/docs/reports/2026-09-30-aya-continuation/README.md).
- [Worktree move, database boundary and local RAM measurements](docs/worktree-relocation-2026-09-30.md).
- [Native terminal foundation acceptance](/home/aya-hmw/Documents/Codex/2026-09-30/task/evidence/foundation-acceptance.md).

Private sessions, credentials, databases, local memory stores and historical freeze evidence remain at their current owners. Evidence links preserve provenance; copied notes or file counts do not establish learning utility.
