# Approved worktree relocation — 2026-09-30

## Current and dated path map

The creator approved moving only the active development worktree into AEON, preserving Git history and leaving services/database storage in place. The scoped move completed at **2026-09-30T16:18:20.605519Z**, using the existing repository's `git worktree move`.

| Locator | Path / owner |
|---|---|
| Former continuation location | `/home/aya-hmw/Documents/Codex/2026-09-30/task-3/brainstem-continuation` — historical locator; no longer a checkout |
| Current continuation location | `/home/aya-hmw/Documents/ChatGPT/AEON/worktrees/brainstem-continuation` — existing linked checkout, no repository copy |
| Original Git/source owner | `/home/aya-hmw/aya/projects/developmental-lab/brainstem` — unchanged branch `candidate/observer-b-v0.2`, HEAD `26e5de877ac3a703e2b4e0c7faab9d43598c68be`, 63 pre-existing status entries |
| Continuation branch / pre-move HEAD | `codex/aya-local-continuation-20260930` / `8c9fd270685f113c2d6222e3d0d1cc833e6d5077` — preserved by move; later commits contain only scoped navigation updates |
| Parent navigation owner | AEON's existing Git repository; scoped `/worktrees/` exclusion prevents it from absorbing Brainstem code |

Current navigation links resolve the new checkout. Historical reports, source ledgers, native receipt roots, rejected freezes, prior commands and original path literals remain retained; use the table to resolve historical continuation locators. No symlinks, duplicate repositories, source copies, credential moves, database relocation or runtime binding were created.

## Verification and rollback

- Preflight: clean continuation/index; no Git lock; destination absent; process cwd/open-FD snapshot found no checkout use. This snapshot does not prove every app/editor/future-job reference absent. The selected task cwd remains outside the moved checkout.
- Immediate readback: **116/116 tracked file hashes preserved**, branch/HEAD unchanged, both linked Git pointers correct, original **19/19 source baseline hashes** and **63/63 status entries** preserved, original/AEON Git configs unchanged. AEON dispatcher metadata is preserved.
- Post-move tests: branch Python **33**, Jev qualification **5**, Observer Python **7**, Observer Rust **44**, unchanged original v0 comparator/batch **16**: **105 passed**, including the **19 focused evaluator tests**.
- First Rust run reused `/tmp/aya-offline-adapter-cargo`; cached test binaries retained the old compile-time `CARGO_MANIFEST_DIR` and could not find fixtures. [Compile-time fixture path](/home/aya-hmw/Documents/ChatGPT/AEON/worktrees/brainstem-continuation/observer-probe/tests/effect_verification.rs:33). A fresh `/tmp/aya-aeon-relocation-cargo-20260930` offline target rebuilt successfully and passed all 44. No source change was needed. The failed and corrected logs remain separate in the task evidence directory.
- Python bytecode disabled; Rust used `--locked --offline` and a `/tmp` target. No PostgreSQL container, model consumer, service or job was started. Original v0 source/schemas and freeze evidence remain byte-identical.

The move's approved rollback is the reverse `git worktree move`, after quiescence and confirming the old destination is free, followed by restored current navigation and pointer/hash/status checks. It was not needed. Future source/service/state moves require their own reviewed plan; this approval does not extend to persistent state or telemetry deployment.

## Firecrawl PostgreSQL separation

No explicit **AYA memory → Firecrawl PostgreSQL** connection was found in the inspected native config, qualified local adapter, Brainstem routes or Firecrawl source. The filesystem move did not add a connection or alter DB access.

| Inspected route | Local evidence / limit |
|---|---|
| Native AYA | [Launcher](/home/aya-hmw/.aya/bin/aya-codex:21) enters `~/.aya/workspace` with `CODEX_HOME=~/.aya/codex`. Retained Node `~/.aya/bin/aya` is a separate legacy entrypoint. |
| Qualified local memory | [Adapter](/home/aya-hmw/.aya/workspace/tools/aya_memory_gate.py:5) selects local `aya-working`, disables cloud and calls `bm mcp`; [Basic Memory config](/home/aya-hmw/.basic-memory/config.json:147) selects SQLite, with no configured database URL. |
| Config distinction | [aya.config.toml](/home/aya-hmw/.aya/codex/aya.config.toml:4) disables MemoryD and selects local Basic Memory. [Base config](/home/aya-hmw/.aya/codex/config.toml:59) separately enables a loopback MemoryD transport. Which config an existing session loaded, inherited overrides and MemoryD's current downstream backend were not tested. |
| Brainstem PG16 tests | [Dedicated synthetic bootstrap](/home/aya-hmw/aya/projects/developmental-lab/brainstem/postgres-m0/bootstrap.py:19): own `runtime/pgdata`, network `none`, no published ports. All three retained test containers are stopped, PID 0; they are not production AYA memory. |
| Durable memory target | [Proposed binding](/home/aya-hmw/aya/projects/developmental-lab/brainstem/docs/review-packets/2026-09-29-hld-convergence/storage-hld.proposed-1.json:3) remains uninstalled; private ingestion and provider cutover are false. |
| Firecrawl PG17 | Separate running scrape/crawl queue store: [build owner](/home/aya-hmw/aya/projects/firecrawl/apps/nuq-postgres/Dockerfile:3), [queue selectors](/home/aya-hmw/aya/projects/firecrawl/apps/api/src/services/worker/nuq.ts:13). Its existing anonymous volume remains unchanged. |

This is source/config evidence, not a database-content audit, effective-session readback or proof of every possible physical access path. No credential or DSN values were recorded/exported, and no database contents were opened. Sharing a PostgreSQL instance does not automatically mix database contents, but databases in that instance share server resources, settings and administration. A standalone AYA instance with its own data directory gives a clearer operational and access boundary when separately approved and deployed. There is no need to attach it to Firecrawl solely to save RAM.

## Local memory snapshot and limits

| Measurement | UTC snapshot | Observed |
|---|---|---|
| Host `/proc/meminfo` | **2026-09-30T16:16:08Z** | Total **59.2053 GiB**; available **39.5212 GiB**; free **8.0389 GiB**. Available is the useful estimate of room for new workloads, not just free pages. |
| Firecrawl PostgreSQL Docker stats | **2026-09-30T16:15:41Z** | **139.5 MiB**, 0.23%; no explicit RAM limit. Displayed 59.21 GiB is the host-size ceiling, not allocated PG memory. Redis: 12 MiB. |
| Current container aggregate | Same stats snapshot | 12 running containers approximately **4.562 GiB**; five Firecrawl containers approximately **3.410 GiB**, including API **2.898 GiB**. Rounded Docker working-set figures. |
| Swap / brief pressure sample | **16:16:08Z**, **16:16:54–16:16:56Z** | 6.6264 GiB swap occupied out of 8 GiB; zero swap-in/out page change and memory PSI averages 0.00 during the brief sample. Occupancy alone does not show current pressure. |
| PG cgroup cross-check | **2026-09-30T16:17:37Z** | `memory.current=228585472` bytes, `inactive_file=81625088`; difference **146960384** bytes, consistent with Docker's cache-adjusted working set. `memory.max=max`. |

Docker Linux stats subtract inactive file cache. Figures describe current unknown workload/configuration, not PostgreSQL's fixed cost, peak forecast or a future AYA instance. Host cache fields overlap and should not be summed as unavailable RAM. This snapshot provides no RAM reason to combine AYA and Firecrawl; future limits should be based on an actual isolated workload. No settings were changed.

## Next

Continue from the moved checkout. Consumer experiment custody/judge/freeze/evidence-class gates remain unchanged; unit tests and relocation do not qualify useful learning. [Existing observability inventory](stack-inventory-2026-09-30.md) supplies the local owners for the separately requested telemetry plan. No collector activation, reroute, new package, outbound telemetry or content capture is authorized by this relocation.
