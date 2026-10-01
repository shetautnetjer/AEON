# Work index

Index only: stable IDs route task/evidence owners. One owner per task; status events are the agreed future coordination vocabulary, not a running watcher. The parent coordinates current worker completions; queued items do not authorize execution or budget.

| ID | State / owner | Existing owner and evidence |
|---|---|---|
| AEON-LAYOUT-001 | completed documentation / delegated Codex | [Layout map](../docs/layout-convergence-2026-09-30.md); no physical relocation/runtime activation |
| AYA-EXPOSED4-PREP-002 | completed offline / delegated Codex | [Compact gate](../worktrees/brainstem-continuation/docs/plans/2026-09-30-exposed4-compact-judge-gate.md), commit `24e16e818085f9ae26d4a1858a01928f411f165d`, 10/61 tests |
| AYA-EXPOSED4-RUN-002 | completed attempt: aborted / parent Codex custody, delegated execution | [Approved compact retry result](../worktrees/brainstem-continuation/docs/reports/2026-09-30-aya-continuation/exposed4retry-20261001T000433Z-result.md), commit `8d7980afd4a3cc44e2c4483fe946011136829ed0`; 30 controls/14 screens passed, judge timed out without acceptance; eight consumers not run, no score, owned processes stopped |
| AYA-EXPOSED4-RUN-001 | completed attempt: aborted / parent Codex custody | [Failed judge receipt](../worktrees/brainstem-continuation/docs/reports/2026-09-30-aya-continuation/exposed4-20260930T233131Z-result.md); eight not run, no score |
| AYA-OBS-LIFECYCLE-001 | completed finite synthetic test / delegated Codex | [14/0/0 lifecycle result](../docs/tempo-lifecycle-synthetic-result-2026-09-30.md); owned resources stopped, real capture unqualified |
| AEON-EVENTS-001 | queued design/source review; no runtime owner assigned | [Coordination decision](../DECISIONS.md); evaluate existing dispatcher before a new implementation |

Folders [queued](queued/README.md), [active](active/README.md), [completed](completed/README.md) organize future task references. Existing tasks stay with their source owners; no copied HLD, contract, receipt or second implementation is introduced. Both exposed4 attempts are closed; no model run is active and no further live attempt is authorized. A bounded offline review may propose a changed read strategy/budget without weakening acceptance, before any separately approved execution.

For later event handling, identify task+attempt+event before dispatch, check current owner/state/source revision, and treat duplicate delivery as the same transition. Only the owner edits its evidence/status; review-ready goes to an independent reviewer when required; blocked preserves the reason and resumes only with actual authority. Concurrent code edits use separately owned scoped worktrees. These are operating requirements for a future evaluated dispatcher, not a deployed lease/event bus.
