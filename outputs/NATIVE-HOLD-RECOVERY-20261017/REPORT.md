# Native hold recovery — bounded qualification

As of 2026-10-17 UTC. Task `aeon/t_25397a23`. **Synthetic qualification delivered; not deployed; AYA acceptance pending. No production patch proposed.**

## Finding

The repeated-block escalation is documented native behavior, not an established upstream defect. A same-kind second block after an unblock reaches `triage`; the real auto-decomposer tick can specify that task back to `ready`, and the real dispatcher can launch it. A prose “no retry” instruction is not a lifecycle gate. This applies to `capability` as well as `needs_input`: the current Finance capability block is containment only while nobody unblocks/reblocks it. Do not cycle reason kinds.

For a genuinely finished, explicitly bounded delivery contract, native `complete_task` is a supported terminal return, including directly from `blocked`; it does not require an unblock or a reviewer launch. It clears recurrence counters and can promote dependent `todo` cards. It must therefore never be used to falsely finish an unfinished phase. Native `request_review` refuses blocked cards, preserves block recurrence, and can dispatch an assigned reviewer with `sdlc-review`. Review is active work, not a passive acknowledgement bucket.

Native completion alone does **not** enforce an AYA-only acceptance policy. The fixture demonstrates a separate procedural controller gate over board/task/run/event identity and exact result, with notifications treated as hints requiring current-state reconciliation. This gate exists only in the fixture. A string identifying AYA is not authentication; no new authorization system or deployed event consumer is claimed.

## Scope and evidence custody

Authority: [CODER-BRIEF.md](CODER-BRIEF.md) and [existing task owner](../../work/active/NATIVE-HOLD-RECOVERY-20261017.md). AEON, source root/CLI/gateway/cron/tests instructions and implementer HERMES guide were read. This Codex invocation is the delegated coder, not a new manager or reviewer. No further model was invoked.

Source checkout: `/home/aya-hmw/.hermes/hermes-agent`, branch `aya/hindsight-lifecycle-v0.22.2`, exact HEAD `a1f2370dd579dc72d27737bc3c3448fc8d7596b3`. [Before HEAD](source-before.head), [after HEAD](source-after.head), [before status](source-before.status), [after status](source-after.status), and matching empty diff-stat files show the tracked source remained clean. [Source pins](source-pins.sha256) cover seven relevant native modules and the Finance disposition; [verification](source-pin-verification.stdout), [stderr](source-pin-verification.stderr), [exit](source-pin-verification.exit) record eight matches, exit 0. Final preservation recheck was at 17:47:27 UTC; [all four exits](preservation-checks.txt) are zero. This is selected-source preservation plus Git cleanliness, not a host-wide integrity audit.

Preservation commands used `git -C /home/aya-hmw/.hermes/hermes-agent status --porcelain=v1`, `rev-parse HEAD`, and `diff --stat`, each redirected to the corresponding before/after file. Verification used `sha256sum -c source-pins.sha256`, `cmp source-before.status source-after.status`, `cmp source-before.head source-after.head`, and `cmp source-before.diff source-after.diff`. [Output pins](output-pins.sha256) identify the final authored fixture, report and final test receipts.

AEON is on `master` at `d73b249` with pre-existing dirty navigation and untracked work. No shared root, task brief, Finance source, live board, service, cron, profile, trust setting, credential, private transcript, Cloud note, or installed component was changed. All authored output is here. Disposable synthetic DBs/workspaces were removed by `TemporaryDirectory` cleanup. No Git staging, commit, or push was performed. Durable continuation for this bounded local-only unit is this report and its fixtures, for the manager to link into the existing owner.

## Executable result

[Runnable fixture](test_handoff_contract.py), stdlib unittest, uses the existing interpreter:

`/home/aya-hmw/.hermes/installs/97d05de94d92cbdc/environments/a249a67fd87f402fba48c17b77824f84/venv/bin/python`

From this output directory, exact final test command:

```bash
timeout 45s python -B -m unittest -v test_handoff_contract > fixture-final.stdout 2> fixture-final.stderr
fixture_exit=$?
printf '%s\n' "$fixture_exit" > fixture-final.exit
cat fixture-final.stderr
exit "$fixture_exit"
```

**Final: 7 tests passed, 0 failed, 0 skipped, exit 0.** [Raw stdout](fixture-final.stdout), [raw stderr](fixture-final.stderr), [exit](fixture-final.exit). Unittest writes its result to stderr; an empty stdout is expected. Native scratch-lifetime warnings refer only to fake dispatched tasks.

| Executable case | Expected and observed |
|---|---|
| Repeated needs_input and capability | Same-kind block/unblock sequence reaches recurrence limit 2 and triage despite no-retry prose; actual auto-decomposer tick with fake auxiliary response yields ready; actual dispatch reaches fake launcher. Both kinds pass. |
| Completed bounded unit | done, recurrence 0, block kind cleared; repeated completion/block calls refuse; two auto-decompose/dispatch ticks produce no work. Delivery notice leaves acceptance pending; producer, mismatched result and mismatched run fail the fixture controller gate; exact AYA disposition passes. |
| Unfinished full phase and B/R/A | Capability hold plus three explicitly blocked dependents remains blocked across two ticks. Native edit/comment can record bounded delivery without changing status/kind/recurrences. Request-review from blocked refuses. |
| Narrowed completed blocked unit | Native edit explicitly narrows a contrived synthetic contract; native complete goes directly blocked→done without unblock; no auto-decomposition or dispatch follows. This is a control, not permission to narrow Finance M. |
| Authorized work/review positive control | Real dispatch claims producer work; real request-review names a different reviewer and preserves recurrence; real dispatch claims reviewer and adds sdlc-review. Old producer run cannot complete/block the new reviewer run; current reviewer can complete. |
| Duplicate/stale notices | Native cursor claim returns a block once, subsequent claim empty. Newer completion protects cursor against an older rewind; permitted current rewind replays the same event. Fixture reconciliation rejects wrong board, deduplicates replay, treats old block after completion and old completion after reopening as stale. No notice releases work. |
| Downstream release hazard | Completion promotes a dependent todo card and fake-dispatches it; an explicitly blocked dependent remains blocked. This is why full-phase completion cannot stand in for returning a read-only subunit. |

Real imports cover `create_task`, `claim_task`, `block_task`, `unblock_task`, `edit_task`, `add_comment`, `request_review`, `complete_task`, readiness propagation, notification cursor claim/rewind, `_KanbanDispatcher.tick_once_for_board`, `auto_decompose_tick`, native `decompose_task`/single-task application, and `dispatch_once`. No lifecycle implementation was copied into the fixture.

Fakes: worker launcher (returns no PID), auxiliary model response/routing, profile existence, lifecycle/worker/task-updated hooks, secret-scope context, memory-pressure input, and other-board running count. Version-discovery Git calls return no version data. All DBs are newly created under this directory with the native schema/migrations. Audit guards reject outside DB opens/writes, private Hermes reads outside source/interpreter, sockets, subprocesses and process signals. The stale-completion test seeds a reopened synthetic row with SQL; **native reopen semantics are not qualified**. ControllerGate is in-memory fixture logic; transport send/wake and durable controller reconciliation are not exercised.

## Retained failures and not-run denominator

The manager's earlier combined mkdir/Python baseline command was rejected by automatic approval review as script execution, before fixture/coder launch, per the brief. That refusal remains inherited evidence; its raw receipt was not supplied here. It was not rerun or repackaged. The later ordinary read-only Git/hash checks and task-authorized synthetic test authoring are separate actions, not execution of that rejected baseline script.

Fixture construction retained two failed setup runs: [attempt 1 stderr](fixture-attempt1.stderr), [exit 1](fixture-attempt1.exit), [source](fixture-attempt1.py); [attempt 2 stderr](fixture-attempt2.stderr), [exit 1](fixture-attempt2.exit), [source](fixture-attempt2.py). Each reported six setup errors, so no behavioral pass is credited to either. First, the fixture's own private-path guard mistakenly rejected the interpreter's standard library; its exact `sys.base_prefix` was added to permitted code reads. Second, source version discovery attempted Git during imports; the fixture intercepted that nonessential version seam with a fake, retaining the subprocess prohibition. Neither failure was an external approval rejection, and no rejected process was launched. Source-grounded import diagnosis replaced blind reruns. [Attempt 3](fixture-attempt3.stderr) then passed the original six tests, exit 0; the final seven-test run followed the added blocked-contract migration assertions. All raw stdout/stderr/exit receipts are retained.

Existing native tests were read for contracts (`test_kanban_block_kinds.py`, `test_kanban_complete_live_claim_guard.py`, `test_kanban_auto_decompose_live.py`) but **not executed**. The required upstream runner precompiles the checkout and can provision a stale/missing test environment; this read-only/no-install bounded unit instead uses the brief's explicitly preferred stdlib route. No broad native-suite pass is claimed.

Uncovered: concurrent processes/controllers, restart persistence, real notifier delivery/wake/authentication, actual gateway settings and profile routing, live worker PID/kill/timeout recovery, auto-decomposition fanout or arbitrary model output, live Finance graph/state, cron obeying the hold, artifact staging/retention, and full migration atomicity. No actual provider/transport integration or production qualification occurred. Native DB/component behavior was exercised locally with fake external effects only.

## Exact recommendation for current Finance M — no execution

Existing `finance-research/t_bd3a7ba8` still owns the **unfinished full M phase**. The smallest safe migration is to migrate its handoff/disposition semantics in place while **retaining `blocked`**, not convert that full-phase card to done. The completed diagnostic support card has its own bounded contract and can separately return completion to its manager.

AYA should first read the current M task/run, links and B/R/A holds through its authorized native controller route. Compare with the controller's disposition; run15 was administrative, not a new model session. If state/attempt identity has changed, stop and reconcile it before any write. This fixture did not read the live board and cannot supply current CAS tokens or claim atomic multi-card safety.

If the current M body already captures this disposition, no mutation is needed. Otherwise, use existing native comment/edit operations on **the same card** to record the following, retaining original phase criteria and historical evidence:

> Run11's sole authorized read-only authoring delivery was accepted with AYA's corrections. The allowance is spent. Full M remains unfinished and blocked. This is not acceptance of run10's rejected procedure, a clean measurement package, AG qualification, or a B recommendation. No unblock, re-block cycle, automatic review, new coder, measurement, or successor release is authorized. B/R/A and outer B/C/Part2 gates remain held. Controller source: NEXT01_M_RUN11_DISPOSITION_20261017.md.

Read back M and B/R/A after that administrative reconciliation; preserve status, links, assignee, recurrence and run history. Do not write a completed `result` on a blocked phase (`edit_task` refuses that); use body/comment provenance. Do not call unblock/promote/request-review/complete, reset counters, rotate block kinds, or remove dependencies. The fixture tests this precise status-preserving edit/comment path. Safety derives from the native blocked status plus controller discipline, **not the prose itself**. A cron/controller that unblocks the card can defeat this containment and remains separately unqualified.

For a future already-authorized, **pre-narrowed** unit, define its deliverable and acceptance boundary before dispatch; return through complete with artifacts and “not deployed; AYA acceptance pending.” Any proposal to retrospectively narrow M must first preserve an explicit existing owner for every unfinished phase criterion and verify that completion cannot release downstream work. Neither condition is established by this diagnostic, so **do not narrow or complete current M**. No replacement graph or task creation is recommended.

Preserve the Finance disposition's exclusions verbatim in substance: run10 is failed-attempt evidence, not accepted measurement; 68 total operation samples versus 26 step samples; 6.469 measured process seconds across worlds is separate from 45 charged seconds/17 tries in the main runtime; hypothetical actor turns are not provider usage/cost; expected `verify_ok=false` remains false; AG-1..4 are not established; cleanup deletion was inferred, not freshly observed. Full NEXT-01, B recommendation, Mercury review, outer B/C approvals and Part2 remain incomplete/held. These are inherited controller findings from the pinned public disposition, not freshly remeasured results.

## Native source anchors and smallest next action

- `hermes_cli/kanban_db.py:2660` completion, including dependency propagation and counter reset; `:3068` edit; `:3145` block; `:3239` recurrence routing; `:3283` request-review; `:3581` unblock; `:3756` specification.
- `gateway/kanban_watchers_dispatcher.py:176` board tick; `:246` auto-decompose; `hermes_cli/kanban_decompose.py:221` single-task application and `:303` native decomposer.
- `hermes_cli/kanban_db_dispatch.py:1791` review default; `:2030` lane dispatch; `:2325` real dispatch loop. `hermes_cli/kanban_db_notify.py` owns transactional cursor claim and CAS rewind; notifier delivery remains separately unqualified.
- Finance evidence: `/home/aya-hmw/aya/projects/finance/docs/quant-v3-1/evidence/NEXT01_M_RUN11_DISPOSITION_20261017.md` (pinned here; no private exports read).

**Next:** AYA reviews this exact fixture/report, verifies current native M/B/R/A state and the existing notifier subscription/delivery separately, then records a controller disposition without releasing Finance. No deployment, restart, installation, second coder, model retry, or production patch follows from these results.
