# Offline telemetry preparation

This is an unactivated patch/config/test packet owned by AEON Git. [Install/startup approval](../../docs/observability-startup-approval-2026-09-30.md) is still required. The existing [source-grounded plan](../../docs/local-observability-plan-2026-09-30.md) and historical qualification remain intact.

The existing Hermes provider and plugin hook/span tracker remain the implementation owner. [Source custody](source-custody.json) identifies clean maintained Hermes core `ec5f44138afcdc3f367136b94e49fb09c061ddaf`, matching managed environment `0da83f1922664b0e9b7b2b82926b4cfd`, and installed plugin 1.17.0. Its install record names upstream revision `57e919cf5a70ca6c4c0b766bbf144f734c941dc2`; installed bytes are pinned separately because no maintained plugin checkout was found. This does not establish byte identity with upstream. Brian Caffey's Apache-2.0 plugin attribution remains unchanged; the local patch and new metadata module are Codex-authored continuation work.

AEON owns a small [patch series](patches/0001-isolated-metadata-and-execution-context.patch), [new payload](patches/payload/metadata_pilot.py), [40 source-byte pins](source-baseline.json) and synthetic tests. No copied plugin implementation is tracked. The patch changes only plugin registration/manifest, opt-in configuration, API-attempt metadata and its existing trace pipeline. It adds no core hook, second provider, service, tool or identity.

The native `pre_api_request` observer normally runs in a worker; it cannot bind the SDK caller's context. The existing inline `llm_execution` middleware is the supported seam. Attach only a live API span matching nonempty string session/task/request IDs; missing/stale/mismatched ancestry suppresses auto instrumentation and passes execution through. Detach in `finally`; provider exceptions and request objects retain their identity and execution runs once. Hermes's own copied context supplies worker/streaming propagation.

Before the existing batch processor sees an ended span, the opt-in boundary removes content-bearing names, unknown/value-unapproved attributes, status text, events, links, resource/scope tags and TraceState. Actual trace/span/parent IDs, timing/status and approved opaque correlation IDs remain. Resources and scope are fixed. Native API attempts remain the canonical metric source; selected SDK spans have a distinct category. This is an export boundary, not a promise that telemetry never exists temporarily in native hook memory. Preview/history/sender/live-store/log/metric capture and debug are explicitly off; arbitrary resource detectors and inherited transport credentials are bypassed. The HTTP exporter uses its own `trust_env=False` session and one-second request timeout.

[Alloy/Prometheus/Tempo/Grafana drafts](config/README.md) are inert. Four [unit drafts](units/) have no boot activation and clean environments. [Exact artifact and wheel metadata](artifact-pins.json) preserves OTel 1.39.1/conventions 0.60b1; [full wheel hash lock](instrumentor-full-wheel-lock.txt) and [constraints](instrumentor-constraints.txt) identify 26 packages, including four newly required distributions. Metadata resolution is not installation or instrumentor qualification.

The [verification receipt](evidence/offline-verification.json), [independent recheck](evidence/independent-review.json) and [inert config receipt](evidence/inert-config-verification.json) distinguish passed preparation from pending runtime acceptance.

Run the source-backed offline qualification from AEON:

```sh
python3 -B observability/pilot/run_offline.py
python3 -B -m unittest discover -s tests -v
python3 -B tools/render_bible.py --check
```

The runner verifies installed-source and core-custody hashes, applies the patch to an exclusively created temporary Python/manifest fixture, imports the actual core middleware/registration classes, and tests the existing SDK with in-memory export. Socket creation, connect/bind/DNS/UDP operations are denied. The test child receives a clean environment and temporary Hermes home; no active profile, credential, session, database or collector is loaded. Fixture source is removed on exit.

Retained acceptance is exposed-development synthetic telemetry behavior only: `utility_qualified=false`, `release_evaluated=false`. No model consumer or memory-utility experiment ran. Tests establish export/caller-context contracts for the installed SDK and native plugin hooks; simulated child SDK spans do not prove the uninstalled OpenAI instrumentor's content flags, suppression, streaming or deduplication behavior. Those require approved isolated acquisition and actual SDK calls backed exclusively by a mock transport. No private reasoning is accessible. Native AYA/Codex correlation and actual Jev/Brainstem memory-operation bridges remain separate source-owned work; no supplied IDs or decisions are fabricated here.
