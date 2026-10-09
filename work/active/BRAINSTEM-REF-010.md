# BRAINSTEM-REF-010 — reference-first private delivery

Owner/writer: delegated Codex, coordinator in the current authorized session. Implementation owner: existing Brainstem repository. Independent reviewers: retained reference/cumulative review and fresh durable-admission review; exact hashes are in the packet. AEON owns navigation/export custody only. State: bounded offline implementation reviewed; private repository established; reviewed packet prepared for scoped publication; production integration remains pending.

## Authorized direction and acceptance

Khamani approved bounded reference-first implementation, then AEON custody and private Git history with shared subagent handoffs. This task records that existing approved direction; it does not reopen architecture or design a new memory engine. Current publication scope is the reviewed patch, hash manifests, synthetic receipts and minimal shared entry convention. No public release, unrelated historical upload, runtime/corpus/provider/service/database changes or automatic production merge.

Verifiable requirements: one canonical occurrence across retry/reopen/crash; distinct native generation/epoch/equal-content occurrences; immutable evidence resolution with missing/changed outcomes; late correlations without duplicate occurrence; corrected interpretations/history without duplicate promotion. Existing native ordering is retained. Postgres remains desired durable integration; Redis/Qdrant are projections; no stack migration. The narrowest uncertainties are production writer authority (unqualified), power-loss durability (process crashes tested only), and source-adapter coverage (Hermes acceptance subset plus AYA_UTC reference resolution).

Decision: Brainstem retains code ownership; AEON stores a reviewed delivery packet and links the implementation. Alternative bulk-copy/move was rejected because it would create competing source ownership and collide with active work. Existing AEON has no remote and contains 38 older commits across local branches; these are excluded from this scoped publication rather than assuming their privacy. A private `shetautnetjer/AEON` remote was verified through existing account access. “Many subs” provisionally means multiple subagents.

## Current / Next / Issues

Current: [reviewed packet](../../outputs/BRAINSTEM-REF-010/README.md), [exact paths](../../outputs/BRAINSTEM-REF-010/changed-paths.json). Final fresh hash-bound scratch reproduction passed Rust55/55, Clippy and25 focused Python checks; Python154 pass + one inherited plugin import error;25 focused reference/roundtrip checks passed. Independent durable review found row spelling aliases and confirmed the fix,9/9 focused Rust checks passed.

Next: verify exact private publication tree/commit, then hand off to the existing Brainstem owner for hash-bound integration when its active ownership is clear. No production integration occurs in this task.

Issues: production Observer authority/registration, Postgres transaction/custody integration, retention and broader adapters remain; the system Python lacks `hermes_constants` for existing plugin collection. Root AEON dirty Paperclip/current-status work remains with its other owner. [Shared start and reconciliation convention](../../docs/shared-agent-start.md).

## Evidence and boundaries

The [functional handoff](../../outputs/BRAINSTEM-REF-010/IMPLEMENTATION-HANDOFF.md) preserves exact source/test/failed-attempt references. The [packet manifest](../../outputs/BRAINSTEM-REF-010/packet-manifest.json) binds selected bytes; exported logs are synthetic tests, not private native transcripts. Local Git commit and remote publication commit/tree are recorded separately in publication receipts if different. [Fresh reproduction](../../outputs/BRAINSTEM-REF-010/reproduction-results.json) and [packet review](../../outputs/BRAINSTEM-REF-010/aeon-packet-review.md) are retained. This task uses manual/platform coordination; no memory admission or automatic dispatch is asserted.
