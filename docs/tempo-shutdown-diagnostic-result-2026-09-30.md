# Synthetic Tempo shutdown diagnostic result

The one approved diagnostic completed with a **failed qualification** and a verified physical shutdown. Initial traces and metrics passed. Tempo emitted its completion milestone after approximately 30 seconds under the 90-second allowance, but terminal exit classification and OOM evidence were unavailable. The strict gate prevented restart; durability was not tested. Missing evidence is not proof that OOM occurred.

The creator's approval `Sentinel_f23a24e183788191a0eeb9be9c42144c` at 21:13:15 UTC covered packet `9a1165df6d2fbb0fc1793f2d14a23505b98d5b82`. The actual executed source was `d701340f840a59eece5cee532bf240b671de85de`, containing the independently reviewed [pre-start corrections](tempo-diagnostic-prestart-correction-2026-09-30.md). Those corrections passed 170 sealed tests and 142 independent guarded tests. No download or install was needed.

The single runtime window opened **2026-09-30 21:30:50.056435 UTC**, with a hard deadline of **21:45:50.056435 UTC** including shutdown. The runner finished at approximately **21:32:46.123758 UTC**, elapsed **116.067323 seconds**. It used fresh state `AEON/var/tempo-shutdown-check/tempoDiag20260930A/`; no original pilot state was reused. All services, the emitter and all retained PIDs were confirmed stopped on the host before the deadline, with empty control groups and no pilot listeners. Runtime unit registrations and synthetic state remain for review; nothing is boot-enabled.

| Check | Result | Evidence |
|---|---|---|
| Source/artifact ownership and fresh preflight | Passed | 36 current source pins; pinned artifacts, installed binaries, maintained source and sealed dependencies verified |
| Inert prerequisites/start/configuration/limits | Passed | Six validators; four isolated services; nine TCP loopback listeners; 2,176 MiB / 2.25 CPU combined ceiling; Tempo stop allowance 90 seconds |
| Single synthetic emission | Passed | 25 spans / six traces / five API calls; one provider; mocked model transport; content sentinel absent |
| Initial exact readback | Passed | 12 direct/viewer trace responses checked against the same batch, including IDs, parents, names, statuses and metadata; metrics 5 calls / 2 errors / 5 duration observations |
| First qualified graceful stop | Failed | `Result=success`, completion milestone and unchanged peers; no live PIDs/listeners; `ExecMainCode=0` provides no verified exit classification, and final `memory.events` counter was unavailable |
| Conditional restart and durability | Not run | First-stop gate failed; no restart or second emission |
| Qualified cleanup | Failed | Adapter returned `FileNotFoundError`; its conservative fallback forced the three peers down. Their retained state shows `Result=signal`, SIGKILL 9 |
| Physical shutdown and finite lifetime | Passed | Independent host unit readback agrees with root's exact PID/listener check; all stopped before deadline |
| Original evidence/configuration and collector preservation | Passed | All 74 original snapshot files unchanged, 63 original receipts, 11 original configs and five protected files verified; old Tempo `Result=timeout` remains; collector ownership unchanged |

The [safe result receipt](../observability/pilot/evidence/tempo-shutdown-diagnostic-result-2026-09-30.json) pins each retained local evidence file. Raw synthetic readback responses and state stay in the ignored run namespace rather than being copied into Git. Both `utility_qualified` and `release_evaluated` remain false. No real sessions, model requests, external telemetry destination, memory admission or Respan binding was introduced.

The 30-second backend-worker completion observed in this trial is consistent with the selected effective `finish_on_shutdown_timeout=30s` and explains why a 25-second allowance can be inadequate. It supports that hypothesis for the original timeout but does not establish causality for the earlier run. The recorded cleanup exception lacks a traceback; the source's attempt to read an already removed Tempo cgroup is the supported failure path to reproduce offline, not a reason to treat empty placeholder fields as cleanup proof.

The smallest next step is an offline regression fix for missing stopped-cgroup counters that still requests normal shutdown of owned peers, plus a supported way to retain terminal exit/OOM evidence. Preserve both runs and keep unavailable evidence unverified. Any subsequent live run or acceptance change requires a new proposal and creator approval; this diagnostic's conditional restart was not taken and does not authorize a fresh retry.
