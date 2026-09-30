# Local stack inventory — 2026-09-30

Local source, package, binary, Docker and service metadata only. Storage snapshot: **2026-09-30T15:32:55Z–15:38:33Z**; learning and observability checks on the same date. No backend/model calls, database queries, installs, pulls, starts/stops, configuration changes or data moves occurred. Container version commands executed only version binaries. Secret/environment dumps and raw trace/session contents were excluded.

**Available** means a local artifact/package exists. **Deployed** means a process/container is observed. **Wired** means current source/config names a route; it does not prove delivery. **Qualified** means an attributable retained receipt passed its stated scope. None alone qualifies AYA learning utility.

## Storage

| Component | Availability / deployed state | Wiring and qualification |
|---|---|---|
| Redis | Running Firecrawl `fe8fd6f5c49b`, **8.10.2**, image `redis:alpine`; internal 6379, no host publication or persistence mount. Separate `redis:7-alpine` image is cached. | [Firecrawl API wiring](/home/aya-hmw/aya/projects/firecrawl/docker-compose.yaml:25). No fresh connectivity test or AYA memory/cache-loss qualification. Caura's separate [Redis 7 append-only configuration](/home/aya-hmw/aya/projects/caura/docker-compose.yml:33) is source configuration; no current Caura storage container found. |
| PostgreSQL | Running Firecrawl `4541e4670f09`, **17.11**; three stopped Brainstem synthetic **16.15** containers listed below. `pgvector/pgvector:pg16` image cached. | [Firecrawl PG owner](/home/aya-hmw/aya/projects/firecrawl/docker-compose.yaml:160), [PG17 build source](/home/aya-hmw/aya/projects/firecrawl/apps/nuq-postgres/Dockerfile:3). Brainstem's [independent post-fix SCOPED_PASS](/home/aya-hmw/aya/projects/developmental-lab/brainstem/docs/review-packets/2026-09-29-m0-postfix-review/REPORT.md:19) qualifies the synthetic M0 binding, not Firecrawl data or broad memory utility. Fair baseline/recall outcomes tied. |
| Qdrant | No matching server container/image, PATH binary, installed dpkg package or named service found in scoped checks. Client installation was **not established**. | Existing [HLD Guide](/home/aya-hmw/aya/projects/developmental-lab/brainstem/docs/review-packets/2026-09-29-hld-convergence/Guide.md:86) assigns rebuildable projections with PostgreSQL eligibility/hydration. The [proposed binding](/home/aya-hmw/aya/projects/developmental-lab/brainstem/docs/review-packets/2026-09-29-hld-convergence/storage-hld.proposed-1.json:41) is not deployment authorization. |

Actual Docker engine is local `unix:///var/run/docker.sock`: client/server **29.8.1**, Compose **5.5.1**. Running storage owner: project `firecrawl`, `/home/aya-hmw/aya/projects/firecrawl`, ordered `docker-compose.yaml,docker-compose.override.yaml`; source HEAD `7666c1f9ae8720a6bba271e0f60b6a217f8a5210`. These are Firecrawl stores, not an accepted AYA memory deployment.

| PostgreSQL container | Observed state, UTC | Actual data binding / owner |
|---|---|---|
| Firecrawl `4541e4670f09` | Running; created/started **2026-09-26T18:55:44Z** | Anonymous Docker volume `5bede0eaa512c8fa6c473784b618781c0ff6bc93098ac33beb74ccd6d30b2d6c` at `/var/lib/docker/volumes/<name>/_data` → `/var/lib/postgresql/data`; container UID/GID 999:999, mode 0700. |
| M0 `2a5a38e928b3` | Stopped, exit 0, **2026-09-30T03:56:40Z** | `/home/aya-hmw/aya/projects/developmental-lab/brainstem/postgres-m0/runtime/pgdata`; UID/GID 65534:65534, mode 0700. [Runtime provenance](/home/aya-hmw/aya/projects/developmental-lab/brainstem/postgres-m0/receipts/runtime-provenance.json:2). |
| Validation `fddf2d134cf1` | Stopped, exit 0, **2026-09-30T04:15:06Z** | `/home/aya-hmw/aya/projects/developmental-lab/brainstem/postgres-m0-validation-v1/runtime/pgdata`; UID/GID 65534:1000, mode 0700. [Runtime provenance](/home/aya-hmw/aya/projects/developmental-lab/brainstem/postgres-m0-validation-v1/receipts/runtime-provenance.json:2). |
| Original reviewer `ec027ec4dd31` | Stopped, exit 0, **2026-09-30T04:04:17Z** | `/home/aya-hmw/.hermes/cache/scratch/postgres-m0-independent-review-01a0f075/binding/runtime/pgdata`; UID/GID 65534:1000, mode 0700. [Runtime provenance](/home/aya-hmw/.hermes/cache/scratch/postgres-m0-independent-review-01a0f075/binding/receipts/runtime-provenance.json:2). |

The three synthetic containers have network `none`, no published ports and no Compose owner labels. All 18 validation-successor source hashes/lengths matched at **15:34:58Z**, manifest `0509073936a7ea0c86ac778bfde3bdd768d346fe4f8959d13b341b234dca3b3d`. Original failures and corrected receipts remain distinct. No PGDATA contents were opened or copied.

Exact image pins:

| Image | Local identity |
|---|---|
| Running Redis | `sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0` |
| Cached Redis 7 | `sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499` |
| Firecrawl PG17 | `sha256:2a8b50fe54145d8332433080f0a3c58fdcea7212af44e5faf0709d336322b969` |
| Synthetic pgvector PG16 | `sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b` |

Caura's [PG/pgvector configuration](/home/aya-hmw/aya/projects/caura/docker-compose.yml:7) owns separate `pgdata`/`redis_data` volumes. MemoryD's [override](/home/aya-hmw/aya/projects/developmental-lab/memoryd-harness/integration/caura/compose.override.yml:2) names 18981/18982/18980; its [September 23 continuity qualification](/home/aya-hmw/aya/projects/developmental-lab/memoryd-harness/integration/continuity-20260923/qualification.json:2) is historical. MemoryD's source uses a SQLite outbox and Caura REST, not a direct PostgreSQL writer. No current health/backfill claim is made.

## Learning and execution

| Component | Available owner / version | Actual integration and qualification |
|---|---|---|
| Monty | **Pydantic Monty**, bounded Python execution. `pydantic-monty`, client and runtime **1.0.0** cached in uv; isolated Python3.13 archives `P7MG9SET8I4bU1Ro` and `q-o0Zyd4efcuyzzr` retain native `bin/monty`. [Package metadata](/home/aya-hmw/.cache/uv/archive-v0/ocl0xIEt1ye3gA1r/pydantic_monty-1.0.0.dist-info/METADATA). | Jev [probe owner](/home/aya-hmw/aya/projects/jev-cli/integrations/monty/README.md:3), [retained qualification](/home/aya-hmw/aya/projects/jev-cli/integrations/monty/qualification.json): offline mock/catalog feasibility, snapshot restoration and receipt reuse. No live Jev/Decide/Hermes or memory binding. Monty is absent from normal Jev `.venv` distribution metadata/dependencies. |
| DSPy | Creator/HLD design references; no runtime distribution/version or downloaded checkout found in bounded named source/package searches. | [Guide:234](/home/aya-hmw/aya/projects/developmental-lab/brainstem/docs/review-packets/2026-09-29-hld-convergence/Guide.md:234) places calibration after independently labeled outcomes and compatible task APIs. No fit/utility receipt found. |
| ReAnchor | Exact local spelling is **ReAnchor**, experimental DSPy threshold/weight calibration; no separate installed implementation/owner found. | [Creator source](</home/aya-hmw/aya/projects/developmental-lab/machine-bible/sources/Adi bible.md:609>), [HLD appendix](/home/aya-hmw/aya/projects/developmental-lab/brainstem/docs/review-packets/2026-09-29-hld-convergence/AYA-HLD-review-technical-appendix-2026-09-29.md:263), [local research owner](</home/aya-hmw/aya/basic-memory-mirror/engineering/Brainstem memory integration research — 2026-09-29.md:26>). No substitute project or optimization result is inferred. |
| Brainstem Observer | `brainstem-observer-probe` **0.2.0**, Rust source, Python host binding and built debug binary. [Owner](/home/aya-hmw/aya/projects/developmental-lab/brainstem/observer-probe/README.md:1). | Explicit selected-session metadata capture, passive synthetic effect verification/replay and retained bounded native receipt. No continuous deployed Observer hook or accepted memory pipeline. [Native-effect review failures](/home/aya-hmw/aya/projects/developmental-lab/brainstem/docs/reports/native-hermes-one-effect-report.md:13) include unresolved same-UID post-open relocation. |

Jev HEAD `55dbf5193465445028245408265cfcbdcc2df5a4`, branch `codex/catalog-mcp-execution`, has 30 pre-existing entries and one remote (not contacted). **All four Monty integration files are untracked**; HEAD does not pin them. Current probe SHA256 `7459ebc60f1b1dcc445db8ad52602f1269ae5cb8c1fa7e7621c906333aa8e68e` matches its retained qualification. Cache binary presence does not qualify host callbacks or procedure utility.

Original Brainstem HEAD `26e5de877ac3a703e2b4e0c7faab9d43598c68be` retains 63 pre-existing entries; Observer Cargo/live/main source is dirty and host-binding/native report files are untracked. Built debug binary SHA256 `3ce09a89a250ead31a77f1bb97128d0f35896688133053a1eb0c1bdfc2b15a48`, size 23,864,584 bytes, is build presence rather than reproducible-build attestation. [Milestone A](/home/aya-hmw/aya/projects/developmental-lab/brainstem/observer-probe/evidence/milestone-a-report.md) and [Milestone B](/home/aya-hmw/aya/projects/developmental-lab/brainstem/observer-probe/evidence/milestone-b-report.md) retain their bounded passes, inconclusive cases and failed cleanup.

Distinct retained Observer areas: `/home/aya-hmw/aya/projects/observer-index-lab` is a non-Git legacy Python/SQLite prototype with live WAL/SHM artifacts. Its [build script](/home/aya-hmw/aya/projects/observer-index-lab/build_index.py:6) names discarded/private intake paths and deletes/rebuilds its DB; it was not executed. `/home/aya-hmw/aya/projects/developmental-lab/observer-goal-loop` is a separate non-Git preflight-test area, not a runtime. No DB/hidden checkpoint contents were opened. Observer source-generation identity includes canonical `state.db` path plus device/inode; relocating that database changes identity.

## Observability

| Component | Available / deployed | Wiring and retained qualification |
|---|---|---|
| OpenTelemetry SDK | Hermes managed Python3.14 environments: API/SDK/OTLP HTTP/common exporters **1.39.1**, semantic conventions **0.60b1**. [Metadata](/home/aya-hmw/.hermes/installs/97d05de94d92cbdc/environments/0da83f1922664b0e9b7b2b82926b4cfd/venv/lib/python3.14/site-packages/opentelemetry_sdk-1.39.1.dist-info/METADATA). Separate Basic Memory environment has **1.44.0**. | Installed `hermes_otel` **1.17.0** is enabled in default profile; gateway observed active. [Config](/home/aya-hmw/.hermes/hermes_otel.yaml:3): content capture off; logs/metrics/history/sender off; traces to loopback4320. Retained Sept26 real harmless-turn route/readback; no fresh delivery test in this inventory. |
| OpenLLMetry | No `traceloop-sdk` distribution, source checkout or configured deployment found in bounded ignore-inclusive owner/package searches. | LiteLLM's [optional adapter](/home/aya-hmw/.local/share/uv/tools/basic-memory/lib/python3.12/site-packages/litellm/integrations/traceloop.py:14) handles absent `traceloop.sdk`. A `traceloop.span.kind` attribute is not package/install proof. Do not equate the installed OTel SDK with OpenLLMetry. |
| Grafana Alloy | Downloaded **1.20.1**, revision `95e12cf`, build2026-09-28T16:30:40Z, Go1.26.7. Existing `~/.local/bin/alloy` resolves to `~/.local/opt/observability/alloy-1.20.1/alloy-linux-amd64`. | No matching process/service/container/image observed. SHA256 `4d73d544c8c2baa779bf7efbe8c3906b655416684ff503adfbb5e18c94dbb58d` matches retained [local tooling qualification](</home/aya-hmw/aya/basic-memory-mirror/engineering/Alloy Prometheus and Paperclip — local tooling qualification.md:18>): checksum and inert validation, explicitly installed/not wired. |
| Prometheus | Downloaded **3.15.0**, revision `5241a27fe3c6983549fccc32f6e65917408c63cd`, build20260925-07:33:45, Go1.27.1. `prometheus` and `promtool` links resolve under `~/.local/opt/observability/prometheus-3.15.0/`. | No matching process/service/container/image observed. Only bundled [localhost9090 self-scrape sample](/home/aya-hmw/.local/opt/observability/prometheus-3.15.0/prometheus-3.15.0.linux-amd64/prometheus.yml:23) found in these owners. Binary SHA256 `dac83d1d1007961de3b9ba624942c9af0c192ee3df262ac47ef390bcade71c65` matches retained tooling qualification; no AEON TSDB owner or live scrape proof. |

Current collectors are **OpenTelemetry Collector Contrib 0.160.0**, not Alloy or Prometheus servers; image pin `sha256:799dc6cf12c96192af37b5bdba804da8c10b3bc563b43cb90c3f3c58d9572ad6`.

| Collector | Actual owner / state | Bindings and integration |
|---|---|---|
| `341619cb6a70`, `aya-otel-qualification-collector-1` | Running since Sept26, restart `unless-stopped`; project `aya-otel-qualification`. Owner `/home/aya-hmw/.codex/.chatgpt-projects/g-p-6a82790181a88191870a073a144e3eca/aya-otel-bootstrap`. | Exact Compose order: base `compose.yaml`, `compose.grafana.yaml`, `compose.datadog.yaml`, `compose.hermes-respan.yaml`. Read-only config mounts; loopback4317/4318/4320/13133. Writable owner `state/` → `/var/lib/aya-otel`, UID/GID1000:1000, mode0700; active/rotated JSONL0644. [Owner](/home/aya-hmw/.codex/.chatgpt-projects/g-p-6a82790181a88191870a073a144e3eca/aya-otel-bootstrap/compose.yaml:4). |
| `01b21995ad3a`, `aya-nervous-bus-v0-model-metrics-1` | Running, restart `no`; owner `/home/aya-hmw/aya/projects/developmental-lab/nervous-system-bus-v0`. | [Compose](/home/aya-hmw/aya/projects/developmental-lab/nervous-system-bus-v0/compose.metrics.yaml:1), read-only config, external networks `aya-model-lab_default` and `aya-otel-qualification_default`, no host ports. [Receiver](/home/aya-hmw/aya/projects/developmental-lab/nervous-system-bus-v0/model-metrics-collector.yaml:2) scrapes `spark:8000/metrics` every5s → `collector:4317`. **Spark was absent from current source/container/network membership**, so running does not prove a current scrape. |

The primary collector's base routes fan out to local JSONL/Grafana/Datadog; the dedicated Hermes4320 route targets Respan only. [Retained HERMES_RESPAN_ROUTE](/home/aya-hmw/.codex/.chatgpt-projects/g-p-6a82790181a88191870a073a144e3eca/aya-otel-bootstrap/HERMES_RESPAN_ROUTE.md:9) records the Sept26 bounded real-turn/readback, not fresh delivery. Authorization header files remain external read-only mounts under `/home/aya-hmw/Confidential/`; their contents were not read and no values are recorded here. File exporter rotation is10MB/3 backups/3days. Older core-Collector digest/`restart:no` prose is historical; current source/container metadata governs this snapshot.

[AYA OTel identity lab](/home/aya-hmw/aya/projects/developmental-lab/aya-otel-identity-lab/README.md:3) remains a candidate. Synthetic Datadog probes do not qualify live workers, every exporter or cross-runtime correlation. Content-capture overrides and source/event identities remain with their current owners.

## Missing pieces and coverage

- Qdrant server not found; Qdrant client availability unknown.
- DSPy/ReAnchor and OpenLLMetry runtime/source/deployment not found in inspected scopes; no global absence claim.
- Alloy/Prometheus available, with retained inert qualification, but no deployed/wired AEON service or Prometheus TSDB owner established.
- Monty cached/probed, not normal Jev dependency or live memory procedure binding.
- Current metrics target Spark missing; fresh hook/export/scrape delivery untested.
- Storage services belong to Firecrawl; PG16 test data and Caura config/history are separate. No accepted unified memory stack was observed.
- Observer native-action review/isolation gaps and memory utility gates remain unresolved.

Named source/package checks covered relevant `aya`, `.aya`, `.hermes`, `.local`, uv caches, `/opt`, `/usr/local/lib`, Downloads and local ChatGPT owner directories with bounded depth and explicit metadata/config fields. Private session/scratch bodies were excluded; named retained receipts and public project sources were read locally. Remotes/backends were not contacted. [Consolidation proposal](stack-consolidation-2026-09-30.md) keeps these owners distinct and stages any later relocation/adoption.
