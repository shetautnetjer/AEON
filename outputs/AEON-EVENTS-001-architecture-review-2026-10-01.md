# AEON-EVENTS-001 — independent architecture review

**Verdict: REVISE. This exact plan is not accepted for implementation or activation.** The Paperclip direction is reasonable and preserves the right project boundaries. Close the five findings below, then submit the revised digest for independent acceptance. This is a targeted revision, not a request for another framework or a host-wide audit.

Reviewed plan: [AEON-EVENTS-001-plan-2026-10-01.md](../work/active/AEON-EVENTS-001-plan-2026-10-01.md).

```text
SHA256 0bc3115d327cab006fb19b5803c5c227ac71783360e7ea0f24205baeba1bd77f
```

Date: 2026-10-01. Reviewer task: `01a0f621-2449-724c-9d02-7413f344b038`, “Review agent workflow plan”; separate from planning task `01a0f609-1981-75e2-b172-08c671bf500f`. Requested reviewer setting: `gpt-6-astra/xhigh`. Task readback exposes task/turn identity, not effective model, effort or provider tier; retain the parent’s creation receipt for that provenance. This artifact is the independent plan verdict, not a claim of code review or runtime qualification.

**Next safe implementation:** after revised-plan acceptance, Sol/high can implement a fixture-only AEON projection/receipt-validation slice and have a fresh Sol/medium task review its exact bytes. No new creator confirmation is needed for routine source edits, relevant local model-free tests and fixes already within that scope. Paperclip startup, account/model use and authority cutover remain separate effect gates. The native AYA attempt remains **never launched after two denials**, with no retry through this plan.

**Severity-ranked findings**

**R1 — High: exact-artifact completion is required but has no specified enforcing boundary.**

Plan lines 95–103, 117–119 and 156 require immutable evidence and forbid completion against the wrong digest. Native execution policy enforces participant/stage routing, but its final reviewer transition accepts `done` with a nonempty comment; it does not compare an expected source manifest or criterion digest at that transition. See [issue-execution-policy.ts:786](/home/aya-hmw/aya/projects/paperclip/server/src/services/issue-execution-policy.ts:786). A work-product reference and metadata are also not an immutable verified receipt: [issue_work_products.ts:34](/home/aya-hmw/aya/projects/paperclip/packages/db/src/schema/issue_work_products.ts:34). The existing Brainstem helper explicitly does not authenticate reviewer identity or establish selection completeness: [automation contract:84](../worktrees/brainstem-snapshot-publication/automation/README.md:84).

**Required revision:** name the owner and actual supported transition path that verifies the tuple of task/attempt, producer run, criterion revision, selected manifest, independent reviewer identity/run and verdict before final completion. Specify how the final closure capability is restricted so an ordinary reviewer comment cannot bypass that check. A supported constrained final stage or separately contained review issue plus an authorized validator are candidates; do not invent an API feature or presume the existing stage supplies the digest gate. If strict native prevention is unsupported, state that limitation and revise the promised guarantee before acceptance.

Separate trusted task instructions and approval provenance from source bodies, tool output, reviewer prose and derived summaries. Those are evidence/data, not new authority. Replace “source/runtime win” in line 190 with a distinction between factual evidence and instruction authority. The minimum negative cases are a stale/wrong manifest, an unselected required input, producer-authored “review,” a review from the wrong attempt, and an evidence body purporting to grant permission. None may satisfy completion or enable an effect. Retain the already planned acceptance tests.

**R2 — High: the no-replacement and bounded-run contract conflicts with an inspected adapter path.**

Plan lines 46, 120, 158 and 182 leave recovery contingent on evidence and budget, but the selected Codex engine is unspecified. The source defaults to ACP and rejects its local filesystem/network confinement combination: [acp.ts:74](/home/aya-hmw/aya/projects/paperclip/packages/adapters/codex-local/src/server/acp.ts:74). The CLI path automatically calls `runAttempt(null)` when a resumed session is unknown: [execute.ts:1556](/home/aya-hmw/aya/projects/paperclip/packages/adapters/codex-local/src/server/execute.ts:1556). I also read the installed payload: [installed execute.js:1236](/home/aya-hmw/.paperclip/cli/installs/npm/2026.916.1/node_modules/@paperclipai/adapter-codex-local/dist/server/execute.js:1236) contains that fresh-session retry. Turning off periodic workers or an optional task watchdog does not remove an adapter-internal attempt.

**Required revision:** select and pin one engine/command and document its confinement, session and retry behavior. Include adapter-internal retries, startup/probes and server recovery in one attempt budget; one Paperclip run must not be counted as proof of one provider attempt. Give the actual supported prevention/control for automatic fresh replacement, or restrict the first model pilot to independently fresh, single-run sessions with no resumable session input and qualify the other admission/recovery controls. A missing session, unknown effect or exhausted allowance must take an owned stop/reconciliation path before another launch. Where the required control is unavailable, mark that lane unsupported and retain platform/manual coordination. Do not silently patch the installed adapter or assume ACP/CLI behavior is interchangeable.

**R3 — High: M1 still lacks an assigned code owner and a concrete synchronization/custody boundary.**

Plan line 129 says “existing AEON tool owner or existing Brainstem automation owner, as the accepted contract assigns,” while line 209 still leaves writer/lock binding and Mufasa transport open. The accepted contract therefore does not yet tell the implementer which repository/files to change or which existing participant will make native mutations. This risks either a second dispatcher in Brainstem or a new model-backed Mufasa substitute.

AEON owns navigation/projection: [AGENTS.md](../AGENTS.md), [PROJECT.md](../PROJECT.md). Brainstem’s [snapshot helper contract:76](../worktrees/brainstem-snapshot-publication/automation/README.md:76) offers explicit freeze/verify/publication APIs, not a Paperclip coordinator. Its legacy [event_handoff.py:227](../worktrees/brainstem-handoff-coverage/automation/event_handoff.py:227) invokes Hermes cron jobs.

**Required revision:** choose one M1 owner. Recommended: the existing AEON `tools/` and `tests/` owner for a small offline projection and receipt validator; reference the pinned Brainstem snapshot contract without modifying or invoking its dispatcher. Name the proposed files, fixture inputs and draft output path, the sole custodian writer, and the native observation fields used for reconciliation. Bind a stable cooperating-writer lock and compare-before-replace rule to the owned projection; divergent human edits must produce a conflict result, never overwrite. No real `STATUS.md` mutation is needed to prove this first slice.

Define the existing Mufasa thread as external custodian until an actual authorized transport is selected. Do not instantiate a replacement model under that name. Before live cutover, the packet must identify the exact mapped task, previous dispatch authority, quiescence evidence, new authority and rollback readback. An absent unit symlink does not prove legacy inactivity. Preserve legacy checkpoints and unknown obligations; do not reactivate or disable Hermes jobs by inference. Native Paperclip plan acceptance can start execution, so it must not be used merely to mirror this architectural verdict before the runtime gates are satisfied.

**R4 — Medium: the test phases do not establish the model/engine claims they gate.**

M2 is a ten-minute process/API fixture pilot; M3 requires verified exact settings, and line 67 asks for observed execution before model-bearing dispatch. Process fixtures cannot establish Codex engine confinement, model selection, effective tier or session recovery. Nor can a short quiet process run by itself qualify a 30-minute Codex inactivity threshold. Installed [output-inactivity-monitor.js:2](/home/aya-hmw/.paperclip/cli/installs/npm/2026.916.1/node_modules/@paperclipai/adapter-codex-local/dist/server/output-inactivity-monitor.js:2) confirms the 30-minute default and explicit-null branch; it is source evidence, not a runtime pass. [codex-args.ts:83](/home/aya-hmw/aya/projects/paperclip/packages/adapters/codex-local/src/server/codex-args.ts:83) shows why `fastMode=false` alone does not override an inherited fast tier. The [environment test:375](/home/aya-hmw/aya/projects/paperclip/packages/adapters/codex-local/src/server/test.ts:375) may perform a real hello probe.

**Required revision:** add a compact acceptance matrix with four separate columns: source/fake, process/API integration, selected-adapter model-free verification, and actual model observation. Use virtual time or a bounded fake executable/protocol to exercise the selected adapter’s quiet, missing-session, cancellation and cleanup behavior without account access. Keep M2 results limited to its actual lane. Before M3, verify configuration/provenance without generation; then reserve any necessary actual canary/hello invocation explicitly in the existing approved envelope. Name the metadata/receipt used for requested, accepted and observed model/effort/tier. If mandatory metadata is unobservable, the result stays unknown and cannot pass; do not substitute a model.

Preserve Sol/high implementation and fresh Sol/medium review, Astra/xhigh architecture/diagnosis, and unspecified Luna effort. Model documentation supports the requested Sol efforts, but does not certify this installation: [OpenAI model reference](https://developers.openai.com/api/docs/models/gpt-6.1-sol). Public [Codex adapter documentation](https://docs.paperclip.ing/reference/adapters/codex/) and installed behavior differ, which reinforces the need for the pinned-engine matrix.

**R5 — Medium: “measured benefit” lacks a frozen comparator and exit decision.**

Plan lines 13, 132 and 166 make benefit a condition of expansion without defining the baseline, denominators or minimum result. A single successful task may establish feasibility while adding coordinator work. An undefined benefit gate invites either indefinite pilots or a premature improvement claim.

**Required revision:** freeze one small representative handoff trace and evaluate the same accepted output/criteria through the current manual/platform path and the candidate path. Record coordinator interventions/time, expected and delivered stage handoffs, duplicate effects, unnecessary wakes, recovery outcome and retained unfinished work. Require zero lost handoffs, duplicate effects or healthy-task termination, plus a stated coordination improvement without weaker acceptance. With one trace, call the result a pilot observation, not general productivity qualification. A tie or excess overhead retains manual/platform coordination and names at most one bounded follow-up; it does not authorize roster growth or more model runs. This comparison can largely be scripted/offline and needs no large campaign.

**Concrete revision and implementation sequence**

1. Sol/max revises only the plan: map R1–R5 to decisions, proposed paths and observable acceptance. Preserve the native denial and historical zero-gain evidence. Submit a new digest for independent architecture review. Live compatibility results may remain explicitly not run behind their gates; this review does not require runtime activation to finish planning.
2. After acceptance, Sol/high implements M1 in the selected AEON owner: fixture-to-projection mapping, exact receipt validation, idempotent replay, conflict detection and recoverable draft publication. Reuse relevant existing contracts/tests; no API calls, listener, installed home, credentials, production stores or scheduler. Test wrong/stale evidence, claim conflict, duplicates/order, crash/readback, cancellation and denial-as-data at this slice’s actual boundary.
3. A fresh Sol/medium reviewer checks the exact commit/selected manifest and relevant behavior. Rejected code returns to the existing producer within the same authorized scope and remaining allowance; routine fixes need no repeated creator approval.
4. M2 needs a concrete, recognized startup envelope covering the finite foreground listener, isolated state, identities, process tree, effective telemetry suppression and owned cleanup. Reconcile the installed payload first; do not reinstall or mutate installed settings as a shortcut.
5. M3 needs recognized account/provider/bookkeeping authorization, exact settings and bounded preflight/attempt/recovery allowance. M4 and native memory/plugin work keep their separate owners and gates. Approval is once per meaningful scope/effect/budget envelope, with another decision only when it changes or a required gate remains unmet.

For cutover/rollback, keep one live authority per mapped task, reconcile unknown effects before replay or reassignment, stop only owned pilot resources and preserve artifacts/history. A projection failure should block that task’s synchronization/completion, not unrelated healthy work. Do not use inactivity alone to steal active ownership.

**What is already sound and should be retained**

- Reuse of the installed pinned Paperclip CLI/source; no parallel Redis bus, cron or new general task framework.
- AEON task/navigation custody; Brainstem memory/admission authority; `bibles/`, `resources/`, `work/`, `outputs/`, existing receipt owners and excluded worktrees retain their roles.
- Native checkout rather than status-only claims, distinct task/attempt/run/event IDs, independent reviewer ownership, durable checkpoints, unknown-effect reconciliation, and no takeover of a healthy owner.
- Explicit separation of source/fake checks, actual integration, deployment and production qualification; failed/not-run and four-tie/delta-zero evidence remain.
- Concise role prompts and proportional relevant tests. [Astra prompting guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) supports scoped context; it is not authority to remove explicit acceptance tests or independent review.

**Evidence scope and limits**

Independently read: the exact plan; AEON operating/project/status/decision/work/resource/output/Bible owners; Brainstem/Hermes/AYA routing instructions and relevant HLD/Guide sections; B4 handoff source and snapshot/publication contracts/reports; the two-denial native report; relevant Paperclip schemas, checkout, execution policy, execution semantics, Codex engine/arguments/retry/timeout/probe and telemetry source. Official model/adapter/review/watchdog/prompt pages were reopened on 2026-10-01. Separate original Luna packets and “Astra guide.md” were not supplied/read; their summaries are not used as independent acceptance receipts. This was not a full Paperclip security audit.

Fresh readback confirmed AEON HEAD `16039bd1b7d625a98a04e269c69fbf5bfa900c06`; clean Paperclip source `d554c4789ed3930f8a53ac9fdf6503b3187097da`; original Brainstem HEAD `26e5de877ac3a703e2b4e0c7faab9d43598c68be` with 63 porcelain entries; clean native worktree `69d7cdce7ae78a5c70f2dae5403be698d4ac7ef0`. Original Brainstem status SHA256: `ea08bdb4367bb74c00a3b6d23612e1aa4e35393c7843831cf02a8957308ba72b`. This status check is not a bytewise audit of all dirty contents.

Installed CLI and adapter package metadata both report `2026.916.1`; installation-record SHA256 matches `0ef71b9c382bd825aac03c52cbbd8c909321adec46c8285c1bcdcbcc7bcd7ed9`. Selected installed adapter bytes read:

| File under installed adapter `dist/server/` | SHA256 |
|---|---|
| `execute.js` | `b33a2b069ff44ec755cb75c7985e33e07cc7ca9f6c58cc0356d318f115553a93` |
| `acp.js` | `767c489a5ebbc7db54b3f80c167cea06af08ed78ce4e1afc7ac34f73b6539e72` |
| `codex-args.js` | `8a3bfb3262ca36677d123bd90f942d920416e65f52d242497f77e8c2e7bdbfe5` |
| `output-inactivity-monitor.js` | `975b59c6696f31e51b5121a5e7c265a2807f1f6e9dba10fba1a452b97ca0afaa` |

These targeted installed reads do not establish whole-release/source equivalence or current service state. No CLI/server/adapter/model test was launched; no runtime, service, account, credential, configuration, memory or original source was changed. Historical tests are inherited receipts, not rerun results. The only authored change is this review artifact; custodian index/status updates remain with Mufasa.

The two authorization denials are retained in the [native blocked report](../worktrees/brainstem-native-recall/docs/reports/2026-10-01-native-correction-blocked/README.md). Native preturn, retrieval and correction remain not run. Their recognition problem belongs to the parent/platform; neither this verdict nor a Paperclip task approval supplies a bypass.
