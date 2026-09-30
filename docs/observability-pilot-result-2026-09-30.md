# Synthetic observability pilot result — 2026-09-30

The approved isolated Hermes/OpenLLMetry → Alloy → Tempo/Grafana trace path and Alloy → Prometheus canonical API metrics passed synthetic readback. **All four pilot services are stopped.** This qualifies the bounded synthetic pipeline only: `utility_qualified=false`, `release_evaluated=false`. No active Hermes/AYA profile, real conversation, provider request, memory admission or Respan route was used.

Authority: [approved startup packet](observability-startup-approval-2026-09-30.md) at `242e3eae61ce848e61b2a22e21e536bcbebad1d0`; creator approval `Sentinel_7f947dcabb948191ac99ffefbf8bba4f`, 2026-09-30 18:02:19 UTC. Its earlier “not performed” statements remain preparation history. [Committed runtime receipt](../observability/pilot/evidence/synthetic-runtime-verification-2026-09-30.json) pins retained local evidence; [independent review](../observability/pilot/evidence/synthetic-runtime-independent-review-2026-09-30.json) records the separate result check. Raw runtime evidence remains Git-excluded in `AEON/var/observability-pilot/evidence/`.

## Delivery and complete denominators

| Phase | Generated / export-attempted spans | Accepted / verified in both Tempo and Grafana | Outcome |
|---|---:|---:|---|
| Normal | 25 | 25 | PASS; six traces, exact identities/parents/status/typed attributes |
| First intentional Alloy outage | 4 | 0 | Expected receiver refusal; exporter threw `ConnectionError` before writing its receipt. Adapter check FAILED, all pilot units stopped, then repaired. These four IDs were not retained. |
| Final intentional Alloy outage | 4 | 0 | PASS; four-span failed-export receipt, bounded `ConnectionError`, balanced context |
| Recovery | 25 | 25 | PASS; six new traces, same checks |
| Total | **58** | **50** | **8 intentional refusals; 0 unexpected missing/dropped successful spans** |

Successful batches contain 50 distinct span IDs across 12 distinct trace IDs with no overlap. Full emission receipts cover **54 spans**; the first refused four are counted from the executed four-span assertion and failure stage, with no claim of retained IDs. Dry-run/in-memory tests are excluded from runtime denominators. No other runtime payload was emitted; 58 is below the approved 1,000-span ceiling.

Each successful batch contains SDK 5, canonical API 5, LLM 5, agent 6, tool 1, lookup 1 and decision 2 spans. Mocked success/error/stream/retry/cancel exercise the existing provider once per case. SDK cancellation remains `OK` under pinned instrumentor 0.61.0; canonical API cancellation/error remains `ERROR`. The receiver preserves this distinction rather than inventing an upstream status.

Prometheus verifies **5 API calls, 2 errors and 5 duration observations per successful phase**; SDK/envelope spans add no API count. The normal query explicitly reads persisted samples at **18:44:16 UTC**, before the first shutdown. Recovery reads current samples after Alloy's connector reset. Current counters are consequently five, not a cumulative ten. Independent review crosschecked latency sums and all 18 histogram buckets against canonical API span durations for each phase. Dimensions remain bounded and contain no session/trace identifiers.

Readback checks include the actual anonymous Grafana datasource proxy, fixed resource/scope, metadata allowlists, source IDs and nesting, status/events/links/TraceState, and absence of content sentinels. Prompt/completion bodies and raw errors are absent from exported/read-back spans. Transport for model cases is `httpx.MockTransport`; the emitter's permitted real connection is loopback OTLP only. Configured destinations and owned-process socket snapshots were verified; this is not continuous host packet capture.

## Runtime, limits and shutdown

The original service window began **18:43:19.836753 UTC**, with deadline **19:13:19.836753 UTC**. Every retry used that original epoch/monotonic deadline and shortened owned runtime overrides; none granted a fresh 30 minutes. Final shutdown was verified at **19:08:54.186240 UTC**, 1,534.349487 seconds after first start. Four control groups were empty, 52 recorded owned PIDs were dead and no pilot listener remained. A fresh post-deadline preservation check at **19:14:10.597546 UTC** again found all services and emitter scopes stopped.

**Tempo ended with `Result=timeout` after the approved 25-second stop grace. This proves bounded forced termination, not graceful Tempo shutdown or durable state after a later restart.** The other three services stopped successfully. Do not restart the pilot to hide or reclassify this result. Graceful shutdown/durability is a prerequisite to discuss before any longer-lived deployment.

Read-only diagnosis of its bounded 19:08:20–19:09:00 unit journal confirms stopping began at **19:08:29.050576 UTC**; internal queues reported stopped; systemd timed out at **19:08:54.129936 UTC** and sent `SIGKILL`. No recorded OOM preceded termination. These warn-level messages do not identify the exact internal task delaying exit. The retained `tempo-bounded-shutdown-diagnostic.json` separates observed termination from that unresolved cause; no tuning or second live run was performed.

Effective cgroup ceilings were unchanged: four services **1,920 MiB / 200% CPU**, emitter **256 MiB / 25% CPU**, combined **2,176 MiB / 2.25 cores**; swap zero, 128 tasks per service and 64 for the emitter. Recorded memory events show zero OOM/kill events. The recovery service snapshot used 338.20 MiB combined; recorded emitter peaks were below 89 MiB. Component peaks are not a simultaneous host high-water measurement.

Nine exact TCP listeners belonged to pilot control groups and bound only `127.0.0.1`: Alloy 14317/14318/12346; Tempo 13200/24317/24318/19095; Prometheus 19090; Grafana 13000. The original four collector listener rows and owners on 4317/4318/4320/13133 matched after shutdown. No persistent enablement, service restart policy or existing route changed.

Post-shutdown artifacts/state measured **2,204,827,648 allocated bytes (2.05 GiB)** and 2,154,756,774 logical file bytes, below the **10 GiB monitored budget**. This is not a hard quota and excludes the already-installed Python executable reached by the approved symlink. Configured 24-hour age retention applies while services run; stopped state does not delete itself. Artifacts, synthetic state and stopped runtime unit registrations remain for review.

## Acquisition, source changes and checks

All 28 admitted artifacts were verified again after shutdown: Tempo **3.1.0**, Grafana OSS **13.2.3**, and the exact 26-wheel fixture with OpenAI instrumentor **0.61.0**, Python **3.14.7**, OpenAI **2.24.0**, OTel API/SDK **1.39.1** and conventions **0.60b1**. Existing Alloy **1.20.1** and Prometheus **3.15.0** were reused. Official URLs, sizes and hashes remain in [artifact pins](../observability/pilot/artifact-pins.json) and [full wheel lock](../observability/pilot/instrumentor-full-wheel-lock.txt). No extra artifacts were acquired.

The sealed wheel fixture was built through existing Hermes PM. Native plugin/core closure additionally reused **15 already-installed distributions / 1,001 byte-pinned files**, read-only, appended after the sealed site without activating `.pth` files. This supplement is explicit in the retained `native-existing-dependencies.json`; the 26 wheels alone are not claimed to reconstruct the full native runtime. Actual imports were checked: **1,389 origins, zero undeclared imports**. The active managed environment and installed plugin were unchanged.

| Local scoped commit | Result |
|---|---|
| `0be99a4ab112e97923f8ae2d27cee6a46767c34e` | Actual pinned instrumentor harness, bounded runner/controller, readback and tests |
| `0d95fe914f6e4440d9979b1fac341d4d4cb731ea` | Exact approved 11-file configuration guard; first failed attempt started no services |
| `ac0a103a424d8e1085216c13b553ee5be7d9697b` | Resolve pinned runtime service symlinks on stopped retries |
| `1c2648add88d3b067bbc4975271d59a93e93445c` | Private owned runtime overrides preserve the original deadline; no unsupported systemd property mutation |
| `597c4bbd910dcb0467d5bb2182250d628f1a201a` | Pinned binary/config verification for intentionally masked Grafana health; explicit historical normal metric readback |
| `bea6a061d32659c0f1ce363c4377846ede6af0e9` | Narrow expected-refusal receipt adapter; other export exceptions still fail closed |

Repairs used RED→GREEN regression tests and independent reviews within the approved reversible scope. The first normal health/readback failure and first negative-export failure remain in retained historical receipts. Normal was emitted under the earlier startup code; final recovery used `bea6a06`; all original eleven runtime configuration pins stayed identical. No installation/configuration/profile cutover occurred in the maintained Hermes owner.

Latest relevant suites: **66 telemetry tests passed, 0 failures/errors/skips** (`prestart-tests-outagefix.log`, `instrumentor-imports-outagefix.json`), plus **15 navigation tests passed** (`navigation-prestart.log`). Files named `*-final` retain an earlier 53-test run and are not the 66-test authority. Six acquired-binary/inert-unit prerequisite commands passed; Grafana parser/health/anonymous datasource paths then passed actual runtime readback. Independent result review found no blocker, subject to the explicit qualifications above.

Preservation checks passed for **5 protected files, 40 installed-plugin pins, 28 core-custody pins, 1,001 existing dependency pins and 11 runtime config pins**. Maintained Hermes core stays clean at `ec5f44138afcdc3f367136b94e49fb09c061ddaf`; original Brainstem retains 63 dirty entries and its 19 pinned sources; relocated continuation stays clean at `db40961e5b0ab9fd184f996fffa91be9ecb3225f`. AEON's existing `.trigger-tree/` contents were not staged; no Git identity configuration or remote changed and nothing was pushed.

## Remaining boundary

The approved synthetic pilot is complete. No real-session capture, native AYA/Codex invocation bridge, actual Jev/Brainstem operation correlation, token metric export, model consumer, memory utility/release evaluation or Respan integration was run or qualified. The smallest next source task is an offline proposal/test fixture for the actual AYA invocation and memory-operation boundary, using existing owners; any active-profile binding or renewed service run still needs its exact activation scope. Synthetic artifact/state deletion also remains a separate creator choice. No further pilot service is running or required for this closeout.
