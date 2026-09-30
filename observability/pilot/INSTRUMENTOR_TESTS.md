# Real instrumentor offline tests

The harness runs OpenAI instrumentation 0.61.0 and OpenAI 2.24.0 against
`httpx.MockTransport`. It registers the patched native Hermes middleware and
uses that plugin's existing provider. The exporter is replaced with an in-memory
exporter; the harness does not contact a model or a collector.

Run from this checkout after the approved isolated Python fixture is built:

```sh
python -B observability/pilot/run_instrumentor.py \
  --python /path/to/approved/python/bin/python \
  --native-pins /path/to/native-existing-dependencies.json \
  --pattern 'test*.py'
```

The runner verifies source custody, all 26 wheel-closure versions, and the pinned
files and versions of the nine existing native dependency distributions. It
appends the selected native site directory to `sys.path`; it does not activate
that site's `.pth` files. Each run uses a temporary patched plugin, empty Hermes
home, and absent profile config. The audit hook denies internet socket creation,
all connects, binds, DNS requests, `sendto`, and `sendmsg`. Private Unix stream
socket creation is allowed for `asyncio.run()`'s internal socket pair.

Seven tests cover success, HTTP error, complete streaming, the SDK's internal
retry, early stream cancellation, missing/wrong/ended ancestry, and simultaneous
sessions using copied worker contexts. They check canonical counts, exact SDK
parents, content exclusion, exception identity, context restoration, and flush.
The instrumentor tests produce 37 finished synthetic spans in total.

`InstrumentorHarness.run_case()` accepts `success`, `error`, `stream`, `retry`,
`cancel`, `missing`, `wrong`, `stale`, and `copied`. IDs can be supplied explicitly.
`run_parallel()` runs two overlapping copied-worker cases. `flush()` returns
sanitized `ReadableSpan` objects and rejects a result above 1,000 spans.

For a separately approved collector smoke test, use only the sanitized result of
`flush()`. The raw recorder and the case result's output/error objects exist for
test assertions and must not be written into receipts. OpenAI 0.61.0 marks its
early-cancelled stream SDK span `OK` during cleanup; the native API span records
`ERROR` with `error.type=CancelledError`. The harness preserves this observed
upstream behavior.
