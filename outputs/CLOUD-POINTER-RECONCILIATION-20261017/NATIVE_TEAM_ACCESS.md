# Shared native Basic Memory Cloud access

## Current / authority — 2026-10-18 UTC

Khamani clarified in Telegram session `20261009_130319_a23158` that Source Analyst should also have access, that the team/everyone may use it when needed, and that the API credential is in 1Password. This explicitly expands the preceding writer-only setup. It does not widen any existing task's write targets, restart paused work, or change role/reviewer authority.

Native `basic_memory_cloud` access is installed and fresh-runtime read-qualified across all 11 existing profiles:

- default
- aeon-implementer
- aeon-reviewer
- finance-analyst
- finance-lead
- finance-risk
- knowledge-writer
- memoryd
- mercury
- research-scout
- source-analyst

The resident default conversation was also enabled through native `manage_connections`; its new tools actually read the Development Source Map and Operator Index and performed a scoped search. Other profiles were tested in separate installation-bound native processes, not merely by copying configuration or launching model canaries. Previously running sessions are not assumed to have reloaded.

## Connection and credential delivery

Endpoint: `https://cloud.basicmemory.com/mcp`. Each profile exposes the same seven knowledge tools: `list_memory_projects`, `list_directory`, `search_notes`, `build_context`, `read_note`, `edit_note`, and `write_note`, with native names beginning `mcp__basic_memory_cloud__`.

The existing Basic Memory API credential is resolved from 1Password by the already-qualified native command secret source. The header uses the service-specific environment reference `MCP_BASIC_MEMORY_CLOUD_API_KEY`, not a literal key. No unrelated provider credentials are added to that source. Existing legacy Basic Memory registrations are preserved; use the hosted route for revision-conditioned writes rather than an older unguarded local edit surface.

Per-server trust covers this selected native knowledge surface. Sampling, resource/prompt wrappers and parallel calls remain disabled. General command approvals, models, effort/tier/budgets, memory providers, other MCP registrations, identities and paused schedules are not changed by this expansion. The tool list is not a project/path sandbox: each agent's assignment and role still govern effects.

## Use and write discipline

Relevant shared project-context reads are normal authorized preparation for assigned work. Do not ask for a new connector grant each time. Choose the relevant explicit project UUID and exact path; Aya Working is operational context, Aya Development is shared engineering knowledge, and Investing owns finance knowledge. Retrieved notes are source-linked context, not runtime or action authority.

Search/read before creating or editing. Existing notes require a fresh raw-Markdown read (`output_format=json`, `include_frontmatter=true`, `review_mode=raw`, `view=markdown`), the returned server `revision_checksum` supplied as `expected_checksum`, a precise edit, and exact readback preserving unrelated history. `write_note` is for genuinely new authorized notes only, with `overwrite=false` explicitly. Keep one writer per owner, resolve conflicts/unknown outcomes before retry, and preserve read-only review assignments. No bulk import, transcript export, automatic promotion, project deletion or resumed curation is implied.

The ten worker HERMES guides now carry this routing and credential-use guidance. Their stale no-connector/read-permission wording was reconciled where present. Protected identity text was not edited. Profile-home guides still require the established explicit read when working from another repository; installed instructions are not proof of model consumption.

## Verification and limits

Private evidence: `/home/aya-hmw/.local/state/aya-task-supervisor/cloud-team-access-8pv3_4uc/`.

- `profiles.json` and private preimages bind the discovered target set; no profiles were created. Sanitized guide diffs are retained in [NATIVE_TEAM_GUIDES.patch](NATIVE_TEAM_GUIDES.patch), with before/after hashes in [NATIVE_TEAM_PINS.json](NATIVE_TEAM_PINS.json); private configuration bodies are not exported into Git.
- `configuration-results.jsonl` records each native setter and exact semantic readback.
- `runtime-results.jsonl` and `verification/<profile>/summary.json` record each separate native process, exact seven-tool surface, actual single-query context and authenticated exact Working-note read.
- Source Analyst additionally read `Guides/AYA Development Wiki — Start Here.md` from the Development UUID and performed a real scoped search.
- Every runtime exposed `expected_checksum` on edit and `overwrite` on new-note creation; administrative delete/move/project-management tools were absent. The probes made no note mutations or model calls. These are not fresh write-canary results; the prior bounded conditional-write canary remains separately retained evidence.
- `final-verification.json` reconciles 11 expected/verified profiles, ten exact guide updates and 13 native read-only probe calls. Every unrelated configuration field and non-guide protected endpoint matched except the live default cron jobs file. The initial whole-file preservation assertion failed there during scheduled activity; only a digest had been captured, so whole-window scheduler-file preservation is explicitly unverified. No scheduler write or rollback was issued. Raw notes, credential-bearing configuration backups and logs stay outside Git.
- One separate checksum-protected update of Development `Guides/AYA Operator Index.md` was read back exactly at the Markdown-body level, with one inserted block and all prior prose preserved. The server also changed its managed `updated_by` frontmatter stamp; whole-document byte equality is therefore false, not silently normalized into a pass. `operator-update-verification.json` retains both the conditional revision and this metadata delta. No mutation retry or new note was created.

This dated expansion supersedes the writer-only configuration baseline in [NATIVE_SETUP.md](NATIVE_SETUP.md) prospectively; that earlier successful setup and its original receipts remain historical evidence, not a rollback target. The original `aeon/t_d1739707` still owns only its three-note reconciliation. No new task/graph, worker dispatch, scheduler or Finance execution was created by team setup.

Shared durable routing owner: Aya Development `Guides/AYA Operator Index.md`. The separate bounded owner-note update/readback is recorded privately; it is not completion of the three-note worker task.
