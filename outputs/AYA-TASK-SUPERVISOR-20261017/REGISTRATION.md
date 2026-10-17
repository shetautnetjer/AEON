# AYA task supervisor — registration and first adoption

## Creator decision
On 2026-10-17 Khamani clarified that the Finance cron should be a general task cron: make sure work is happening and fix problems where needed. This supersedes the job's Finance-only scope, not any project's explicit financial/permission gates or paused schedules.

## Applied configuration
- Existing job: `e07ffb34ba62`; no additional job created.
- Name: **AYA task supervisor — progress and recovery**.
- Cadence: every 15 minutes, still enabled.
- Workdir: `/home/aya-hmw` rather than Finance docs.
- Contract: [AYA-TASK-SUPERVISOR-20261017.md](../../work/active/AYA-TASK-SUPERVISOR-20261017.md).
- Only `name`, `prompt` and `workdir` changed; native exact prompt readback passed at `2026-10-17T17:46:44.977185+00:00`.
- Prompt SHA256: `c1d42fdf721f6b086d63c406a5a76427134e69adf1b72288ab4cb012433d02b8`.
- Model/provider inheritance, delivery origin, continuity, attached skills and the ten other job registrations were preserved. Runtime counters/timestamps can advance independently.

## Observed execution
Native scheduler execution `5e09185458f24fe4a930e1271afe9520` started after the edit, at `2026-10-17T10:46:58.239375-07:00`, source `builtin`. Its actual session `cron_e07ffb34ba62_20261017_104658` persisted the complete new contract in its user prompt; a read-only comparison verified exact containment, not merely a name change. Tool messages were already present. No duplicate manual fire was submitted.

At the initial checkpoint this verified registration and first scheduled prompt adoption only. **Subsequent verified follow-through:** the same native execution completed at `2026-10-17T10:51:34.954609-07:00`, with suppressed duplicate delivery. Its checkpoint and retained captures document the default, aeon and finance-research boards plus enabled jobs. It independently checked the returned diagnostic, preserved paused/held work, and posted supplemental evidence to the already-active controller; AYA read that exact comment and receipt before disposition. No duplicate worker or new graph was created.

AYA separately reran the unchanged seven-case fixture, verified the pins and accepted only its native lifecycle characterization/tested handoff procedure. [Exact acceptance and exclusions](../NATIVE-HOLD-RECOVERY-20261017/AYA_DISPOSITION.md); native acceptance comments were read back on the existing support, M and NEXT-04 cards with state/runs/links unchanged. This closes the temporary disposition-in-progress marker. Unchanged verified receipts should be reused, not rerun on every sweep. The supervisor's checkpoint remains its own observed-time record; the next tick must reconcile this later native disposition.

The real completed sweep and consumed handoff are verified. Future recovery reliability, restart/concurrent-controller guarantees and full Finance completion are **not** established. No production patch was proposed or installed for the demonstrated lifecycle mismatch. A final native registration comparison still found only name/prompt/workdir changed and all ten other registrations preserved.

## Evidence, state and rollback
Owner-only original registration snapshot and machine readback: `/home/aya-hmw/.local/state/aya-task-supervisor/20261017/`. Per-job checkpoint path: `/home/aya-hmw/.local/state/aya-task-supervisor/checkpoint.json`; the supervisor writes actual observations, not fabricated setup output. Native scheduler/task/session records remain the execution owners.

For a creator-requested rollback, restore only this job's prior name/prompt/workdir from `jobs-before.json` through native cron editing, then compare exact fields and all other registrations. Do not restore the whole jobs file or reset runtime counters/paused jobs. This document does not order a rollback.

Cloud update remains proposed through the existing Finance `handoffs/CLOUD_UPDATE_PROPOSAL.md` to the existing Finance and Aya Working coordination owners; required conditional-write support is not yet qualified. No Cloud publication is claimed.
