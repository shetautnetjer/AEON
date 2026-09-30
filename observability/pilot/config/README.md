# Inert synthetic observability configuration

These drafts were prepared and checked on 2026-09-30. They do not activate a
service, exporter, profile or collector. No binary was acquired or installed.
The existing local observability proposal remains historical source context;
the later install/startup packet must name approved artifacts and operations.

## Pipeline and data

Alloy receives **only traces** on `127.0.0.1:14317` / `14318`. It refuses unknown
span categories, removes span events/status messages, replaces resource/scope
metadata with fixed synthetic values, and keeps selected attribute keys. The
source-side strict privacy normalizer remains required: collector key filtering
alone cannot qualify arbitrary attribute values, links or schema URLs.

The retained trace keys match the prepared Hermes patch: supplied session/tool/API IDs,
turn/retry/token counts, explicitly approved provider/model/tool values and bounded
operation/outcome/error/lookup/verification codes. No contract/run/step fields
are invented for unmapped memory owners.

Only normalized `api` spans feed spanmetrics. Operation/outcome values are
bounded enums, with a 256-tuple cardinality ceiling; missing values remain missing, with no fabricated successful
outcome. Metrics have only those dimensions and OTel's bounded status code.
Service/span-name/span-kind defaults, collector UUIDs, resource labels, target
info, scope labels and exemplars are disabled. No token sum is inferred from
spanmetrics. Logs and native metrics are not routed by this pilot receiver.

Trace export goes to local Tempo `127.0.0.1:24317`. Metrics go by remote write
to local Prometheus `http://127.0.0.1:19090/api/v1/write`; Prometheus separately
scrapes an allowlist of Alloy health/process metrics at `127.0.0.1:12346`.
Grafana uses built-in Tempo and Prometheus data sources only.

## Ports, paths and access

| Process | Proposed listeners |
|---|---|
| Alloy | OTLP `127.0.0.1:14317`, `14318`; HTTP health/UI `127.0.0.1:12346` |
| Tempo 3.1.0 | HTTP `127.0.0.1:13200`; native internal gRPC `127.0.0.1:19095`; OTLP `127.0.0.1:24317`, `24318` |
| Prometheus 3.15.0 | HTTP/UI/remote-write `127.0.0.1:19090` |
| Grafana OSS 13.2.3 | HTTP viewer `127.0.0.1:13000` |

Tempo's additional internal HTTP listener is explicitly disabled (configured
loopback `13101` if later enabled). Memberlist is defensively configured for
loopback `17946` with no peers; monolithic in-memory rings should not need it.
Verify actual listeners after approved startup; inert checks cannot prove the
runtime bind set. Existing collector ports and routes remain unchanged.

Proposed authored config owner is
`/home/aya-hmw/Documents/ChatGPT/AEON/observability/pilot/config`.
Proposed excluded/private state owner is
`/home/aya-hmw/Documents/ChatGPT/AEON/var/observability-pilot/{alloy,tempo,prometheus,grafana}`.
Alloy's bounded remote-write WAL requires its own state directory too. Tempo
3.1's live-store WAL, shutdown marker and scheduler work cache are explicitly
redirected into this owner; no `/var/tempo` state is requested.

Proposed new unpacked artifacts belong to
`AEON/artifacts/observability/{tempo-3.1.0,grafana-13.2.3}`; artifact acquisition,
extraction layout/validation and startup still require approval. Reuse current
Alloy/Prometheus binaries without changing their links or bundled samples.
No state directory or service unit has been installed.

Grafana uses a separate SQLite database, anonymous **Viewer** access on loopback,
no signup/login form/initial admin and no credentials in this draft. Any local
user able to reach this port can view synthetic metadata. Real/private capture
requires a separate access decision. Reporting, update/plugin/public-key/news
requests, plugin preinstallation, public dashboards, external snapshots and
cloud migration are disabled. Alloy reporting is disabled by its unit flag;
Tempo reporting is disabled in YAML. No external destination is configured.

## Resource/retention proposal

| Service | MemoryMax / MemoryHigh | CPUQuota | Go soft heap limit |
|---|---|---|---|
| Alloy | 384 / 320 MiB | 50% | 300 MiB |
| Tempo | 768 / 640 MiB | 75% | 600 MiB |
| Prometheus | 384 / 320 MiB | 50% | 300 MiB |
| Grafana | 384 / 320 MiB | 25% | none |

Total proposed service `MemoryMax` is **1920 MiB** and summed CPU quotas are two
cores. Each inactive unit has `MemorySwapMax=0`, `TasksMax=128`, `Restart=no`,
`RuntimeMaxSec=30min`, `TimeoutStopSec=25s` and a private umask. These are proposed
cgroup ceilings, not observed resource consumption or enforced current limits.
Verify CPU/memory controllers and effective limits before the smoke; abort if
unsupported rather than silently launch unbounded. No `[Install]` section means
no boot activation is proposed. `env -i` excludes inherited exporter/proxy/Grafana
overrides and credentials; only explicit PATH/Go sizing variables are supplied.

Limits are for a **finite synthetic smoke, at most 1,000 sanitized spans per
run**, not production sizing. Tempo's official Linux guide suggests materially
larger resources for general tests; acceptance under these lower ceilings is
unqualified until the bounded smoke succeeds. Failure/OOM is an acceptance
failure and does not authorize increasing limits automatically.

Tempo block retention and Prometheus time retention are 24 hours. Prometheus
also has a 512 MiB persisted-block size-retention threshold; that is **not** a
hard filesystem cap and excludes head/WAL overhead. Alloy's remote-write WAL
keepalive is bounded to 30 minutes. A **10 GiB aggregate disk budget is not a
hard cap**: no filesystem quota/fixed-size filesystem has been created. Strict
hard disk enforcement would require separately approved quota/mount work. Check
free space and measured usage before/during/after this finite smoke.

Age retention runs only while storage services are active. Stopped services do
not guarantee erasure at 24 hours. The startup packet should specify whether
synthetic state is removed after readback/evidence review or retained for manual
review; this draft creates no cleanup timer and deletes nothing.

## Inert verification and remaining checks

- Installed Alloy **1.20.1**: `alloy fmt --write` and `alloy validate` passed.
- Installed Promtool **3.15.0**: `promtool check config` passed.
- Grafana INI parsed with Python stdlib; local privacy settings checked. This
  does not replace validation by the not-yet-acquired Grafana binary.
- Read-only `systemd-analyze --user verify` passed for the four inactive unit
  drafts after sandbox socket restrictions required a scoped read-only escalation.
  The only remaining diagnostic concerns an unrelated existing `spice-vdagent`
  unit. Effective resource enforcement remains a startup check.
- Tempo/Grafana binaries are absent. YAML/INI are source-reviewed drafts, with
  no binary-config or deployment qualification claimed. After approved
  acquisition, perform those checks **before** startup and validate actual
  listener/state paths, parent traces, finite counts, no content and shutdown.
- Existing collector/profile configuration and services were not accessed or
  changed. No OTLP request, model call, backend query or real session occurred.

## Official configuration sources

- [Alloy spanmetrics](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.connector.spanmetrics/), [transform](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.processor.transform/), [filter](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.processor.filter/) and [Prometheus conversion](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.exporter.prometheus/); installed 1.20.1 inert validation governs accepted syntax.
- [Tempo 3.1 monolithic Linux guide](https://grafana.com/docs/tempo/latest/set-up-for-tracing/setup-tempo/deploy/locally/linux/); version-tagged [app configuration](https://github.com/grafana/tempo/blob/v3.1.0/cmd/tempo/app/config.go), [module wiring](https://github.com/grafana/tempo/blob/v3.1.0/cmd/tempo/app/modules.go), [live-store paths](https://github.com/grafana/tempo/blob/v3.1.0/modules/livestore/config.go), [backend worker](https://github.com/grafana/tempo/blob/v3.1.0/modules/backendworker/config.go), [scheduler cache](https://github.com/grafana/tempo/blob/v3.1.0/modules/backendscheduler/config.go) and [compaction retention](https://github.com/grafana/tempo/blob/v3.1.0/tempodb/config.go).
- [Grafana OSS 13.2.3 configuration defaults](https://github.com/grafana/grafana/blob/v13.2.3/conf/defaults.ini); built-in data sources avoid extra plugin acquisition.
