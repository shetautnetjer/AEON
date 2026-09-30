# AEON Bible navigation

**Dated current-status correction:** this navigation retains its initial preparation snapshot. The later [finite synthetic lifecycle](../docs/tempo-lifecycle-synthetic-result-2026-09-30.md) passed and stopped its owned resources; [current STATUS](../STATUS.md) governs latest evidence. Older “planned/unactivated/no pilot” wording below is historical for that snapshot; real AYA capture/integration remains unqualified. No component definitions, index paths or generated artifacts are replaced.

Purpose: give agents a small source-linked route to existing memory and observability owners. Read this Markdown for operating boundaries, then [index.json](index.json) for machine navigation. Definitions remain with their existing source and JSON Schemas. [HTML](index.html) and [SVG](relationships.svg) are generated views, not semantic authorities.

- [Memory purpose and examples](memory/README.md).
- [Observability purpose and examples](observability/README.md).
- [Local source inventory](../docs/stack-inventory-2026-09-30.md).
- [Dated worktree path map](../docs/worktree-relocation-2026-09-30.md).
- [Unactivated observability plan](../docs/local-observability-plan-2026-09-30.md).

## Rules

1. This is navigation, not a new runtime, shared-ID taxonomy, admission policy or replacement Dictionary. Existing project instructions, contracts and qualified source evidence govern. The [local Machine Bible source](/home/aya-hmw/aya/projects/developmental-lab/machine-bible/README.md) and [dated hand-authored HTML/JSON correction](/home/aya-hmw/aya/projects/developmental-lab/machine-bible/scripture/2026-09-28-conversation-first-html-json.md) remain retained owners; no Cloud Dictionary read or migration occurred here.
2. Treat availability, deployment/configuration and qualification separately. A package, source reference, running container or passing navigation test does not establish useful memory. Planned Tempo/Grafana and proposed links remain explicitly unactivated.
3. `verified_on` dates the source reconciliation. Generator path checks only establish that referenced local paths exist; they do not refresh process state or prove the truth of a receipt. Reopen relevant source before an implementation claim.
4. Every component has a local navigation ID, owner path/role, existing file references, three status descriptions and notes. Every relationship names existing IDs, its kind/state and source. A file with role `schema` references an existing project contract; a source-context schema is not applied as a binding.
5. Read source/contract owners before editing. Preserve dirty work, historical outcomes and original receipt paths. The Firecrawl stores are present to make their separation visible; they are not AYA memory stores. No private transcript, credential, database or raw trace body belongs in this Git index.
6. Maintain authored JSON/Markdown, then regenerate. The renderer only validates local navigation and writes two derived files. It reads no source bodies, contacts no service and changes no runtime configuration.
7. Keep relationships source-backed and uncertainty explicit. Do not invent a parent session, recall, decision, deployment or qualified outcome because a diagram connects two boxes.

## Local index shape

`format_version=1`, `verified_on`, `scope`, `components`, `relationships` are the entire top-level shape. Components contain `id`, `label`, `area`, `status` (`availability`, `deployment`, `qualification`), `owner` (`path`, `role`), `files` (`path`, `role`, optional positive `line`), and `notes`. Relationships contain `from`, `to`, `kind`, `state`, and `source` (`path`, optional `line`). IDs are unique within this navigation file only. The two `area` values route folders; they introduce no global semantic categories.

Validation checks shape/types, unique IDs/edges, dangling references, absolute existing owner/file paths and positive source-line metadata. It does not validate the contents or adoption of another project's schema. No global index schema or code compiler was introduced.

## Examples and verification

An agent looking for memory comparison uses `brainstem-offline-evaluator`, opens its existing v1 selector schema and source pins, then follows the source owner's acceptance gate. An agent investigating traces uses `hermes-otel-plugin` and follows the separate source/privacy/deployment plan; OpenLLMetry and a diagram do not imply native AYA session propagation.

From AEON:

```sh
python3 -B tools/render_bible.py
python3 -B tools/render_bible.py --check
python3 -B -m unittest discover -s tests -v
```

Generation is deterministic from the JSON index and contains no external resources or executable scripts. `--check` detects missing/stale derived outputs without writing. Tests cover shape, path/graph errors, duplicate JSON keys, deterministic ordering, escaping and drift. Their passes qualify this navigation/codegen only.
