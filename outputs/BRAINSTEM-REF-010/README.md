# BRAINSTEM-REF-010 reviewed delivery

This is an immutable review packet, not another source checkout or memory engine. AEON owns coordination and this export; Brainstem retains implementation ownership at `/home/aya-hmw/aya/projects/developmental-lab/brainstem`. The patch is against the exact dirty-source baseline hashes, not necessarily that repository's HEAD. Never apply it to live or installed runtime automatically.

[Shared starting point](../../docs/shared-agent-start.md) · [Task owner](../../work/active/BRAINSTEM-REF-010.md) · [Functional handoff](IMPLEMENTATION-HANDOFF.md) · [Reviewed paths](changed-paths.json) · [Packet checksums](packet-manifest.json).

## Reproduce locally

Run `python3 reproduce.py --source-owner /home/aya-hmw/aya/projects/developmental-lab/brainstem --scratch-root /tmp/aeon-reference-reproduction-UNIQUE`. The scratch path must not exist. All baseline hashes must match before any files are copied. No runtime, credentials, databases, networking or models are used. Cached Cargo dependencies are required. The script copies explicitly hash-bound source files only, applies the patch to scratch and runs 25 Python focused tests, the Rust suite and Clippy. Full Python discovery has a retained pre-existing plugin import blocker and is not silently called green.

The original review receipts and failures are retained byte-for-byte. They are offline synthetic test logs, not native session logs. `packet-manifest.json` binds the exact export. The broader workspace remains the historical receipt owner; no raw transcripts, credentials, runtime databases, binaries, targets or other project trees are exported.

Final fresh reproduction: [results](reproduction-results.json), [review](aeon-packet-review.md). All five commands passed with Cargo outputs confined to scratch and a minimal child environment.
