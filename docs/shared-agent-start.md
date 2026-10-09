# Shared agent starting point

AEON remains the organizing home; linked projects retain source and state ownership. This is a scoped private Git projection from the existing AEON repository, not a new memory store. Start with the host's canonical AEON `AGENTS.md`, `PROJECT.md`, `STATUS.md`, `DECISIONS.md` and `work/README.md` under `/home/aya-hmw/Documents/ChatGPT/AEON`; remote-only readers must obtain that owner context before acting. This branch does not grant account, runtime, provider, memory or deployment authority.

Current reviewed task: [BRAINSTEM-REF-010](../work/active/BRAINSTEM-REF-010.md). Read its exact packet hashes and evidence before resuming; use [packet](../outputs/BRAINSTEM-REF-010/README.md). “Many subs” is interpreted as multiple subagents; no memory-store migration is inferred.

## One task, one writer

Before work, inspect HEAD, dirty files, staging, applicable rules, current work index and worktree/lock state. Claim a disjoint task scope with one named writer and reviewer; use an isolated worktree for overlapping paths. The shared files are navigation, not a transactional lock. The coordinator serializes shared STATUS/DECISIONS/work-index reconciliation; a worker must not overwrite another owner's changes.

Each handoff records stable task label, named source owner/branch/base revision, changed paths and hashes, approval/scope, decisions with rationale, exact commands and receipt paths, failures/not-run checks, reviewer findings, current blockers and one next action. Producer claims remain distinct from independent review. On completion, reopen current shared files and reconcile only owned changes; preserve both accounts of conflict and dated supersession, then commit a scoped diff. No blanket staging, history rewrite or automatic merge. Native source IDs remain source IDs; reused canonical Observer UUIDv7 identity does not become a task/global sequence.

Subagents receive the same task pointer plus their explicit distinct scope. Report back through existing platform completion events. Summaries are fallible navigation to immutable evidence; they do not replace custody or qualify memory promotion. No dispatcher, auto-loader, runtime memory binding or scheduler is installed by these documents.
