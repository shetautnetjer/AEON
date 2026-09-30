# Observability Bible navigation

Purpose: inspect emitted traces, metrics, errors, timings, token counts and supplied session/tool/decision IDs. This is operational metadata, not access to hidden model reasoning. Use `area=observability` in [the shared machine index](../index.json), then the [source-grounded integration proposal](../../docs/local-observability-plan-2026-09-30.md).

## Operating boundaries

- Existing Hermes OTel/provider/hook code and two collectors have their own owners. Current external routes remain unchanged. Native AYA is a separate process; its session/provider propagation is unverified.
- Alloy/Prometheus are installed but unwired. Tempo/Grafana servers and selected OpenLLMetry instrumentors remain proposed/missing in checked scopes; no pilot was activated.
- Traces need a trace backend/viewer. The proposal uses Tempo/Grafana; Prometheus stores metrics. Session/trace/run/record IDs must not be metric labels.
- Reuse the existing Hermes provider. Selected instrumentors need a verified context bridge and canonical-span/deduplication choice, not default full-SDK initialization.
- Start with explicit native content/sender/dashboard-off and instrumentor content-off. Commands, paths, exceptions, approval span names, stop sequences and subagent summaries need source-specific omission/normalization plus sentinel readback tests; flags alone are insufficient.
- Preserve supplied ancestry, errors/abstention and outcome codes. Advisory catalog planning is distinct from actual memory recall or a verified decision. Do not infer intent or invent correlations.
- Respan remains optional future value/data scope, alongside the retained current route. No new external exporter, request gateway, real capture or text export is approved here.

## Agent examples

For missing nesting, follow `hermes-otel-plugin` to SpanTracker/custom-span code and the exact SDK-call owner; prove two-session and child/retry behavior in synthetic tests. For a metric, choose one canonical source and bounded dimensions; client/agent token rollups must not be added together. For deployment, use the proposal's separate artifact/startup/state/capture approvals and rollback; a generated arrow is not a deployed connection.

This folder and its generated view contain navigation only. No service, collector route, telemetry profile, package or credential was changed.
