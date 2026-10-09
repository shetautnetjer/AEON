# Independent cumulative reference-first review

Outcome: approved after parent repair of the reproduced finding below. Reviewed the full additive delta against baseline-memory_v0.py; no implementation edits, network, providers, bootstrap or live stores were used. Final focused offline tests pass: 23 tests (11 reference admission and 12 capture wiring), receipt `cumulative-focused-review.log`.

## Reproduced and repaired finding: P2 — archive reopening ignored admitted message identity

Location: `brainstem-slice/memory_v0.py:1367` (`resolve_aya_utc_reference`); also `_aya_utc_row` and `resolve_aya_utc_source`.

Admission requires exactly one message and checks its `native_message_id`; it retains its existing `archive_key` as source_key. Reopening reads messages in `_aya_utc_row` but discards them from the returned reference. The bound resolver checks bytes, size, correlation and timestamp only. Thus the archive can lose or change the admitted message mapping while the bound canonical occurrence is still reported verified.

Reproduction, each against an independent temporary `CaptureWiringTest` fixture after `t.admit()`:

```sql
UPDATE messages SET native_message_id='different-native';
UPDATE messages SET archive_key='ayautc:different-key';
DELETE FROM messages;
```

For each independently executed mutation, the pre-repair `resolve_aya_utc_reference(t.db, project_id='fixture', profile_id='default', event_id=uid(101), archive_path=t.archive, allow_content=True)` returned `artifact_state='verified'`, `source_state='verified'` and content. This also reproduced after the late optional-correlation repair. Retained bytes remained intact, but verified reopening of the original archive/native identity had not occurred.

The parent repaired this during review. Final source compares the complete current archive message list against exactly one frozen archive_key/native_message_id pair. The new focused regression independently changes the native ID, changes the archive key and deletes the message projection; all now return changed_artifact without content. The 23-test final receipt is green. No remaining blocker was identified within this bounded review.

## Late-correlation repair

Read `late-correlation-red.log`: optional canonical fields omitted at initial admission previously caused `reference_source_mismatch`. Current admission checks required session plus only supplied non-null optional turn/trace/span fields. Current bound resolver likewise tolerates omitted optional fields. The added test preserves the original SourceEvent and adds late native correlation through EvidenceEvent; the focused rerun is green. This repair does not resolve the message-mapping finding above.

## Exact reviewed SHA-256 hashes

Review refreshed to cover all seven cumulative changed paths: implementation, both tests, copied schema fixture, README, primary architecture HTML and the dated plan. README and architecture additions were compared to the baseline copies; the plan was read in full. They accurately describe the native checkpoint/AYA_UTC wiring, upstream canonical-issuer decision, projection boundaries, optional native correlation, correction history and independent archive/current-source checks. No documentation concern required repeating the unchanged focused suite. Final broad suite remains parent-owned; this approval does not assert its outcome.

| File | SHA-256 |
| --- | --- |
| baseline-memory_v0.py | 57a9cff2804e3098fa046008fd4dba0b86ce50b95b66778adcf57053b1a80a2b |
| brainstem-slice/README.md | 6257550adfa5fdc4d48cf2b401d12d45837fcdac3a812d5b28e90aa5a9cf2ebc |
| brainstem-slice/architecture.html | 2c4fb4f20c7cd395e59aa886250b31b0f7617bcea71a49038cc9cf5a03bd6f69 |
| brainstem-slice/docs/plans/2026-10-09-reference-first-slice.md | adb372220ffc925998fa892e19fbdf090ccc4e0e42ad515d1a028edc83e7e1a1 |
| brainstem-slice/memory_v0.py | 37d409e2d9693246ebb96acee90d219cd1d7c99a9571e62eeaa404c8166962f7 |
| brainstem-slice/tests/test_reference_admission.py | 51069611a6fad702d498c11aaf3ac963e5bd0fe1ecafd77ffe3d77bcc482f276 |
| brainstem-slice/tests/test_capture_reference_wiring.py | 9bf48749b734b4871f188755aeb0699c99d24a8ac6b37da4a10b70841b96eb29 |
| brainstem-slice/fixtures/aya-utc-schema.v0.1.sql | 075b6c765808ab328c456c6ec2d92345d7902c7ed21bdf3f83292af7c3f3906d |
| late-correlation-red.log | b00a7cd125bb8ed4020f3d90842dd55d2ea3b1073ac7d6f2077e9b1a462ad58c |
| cumulative-focused-review.log | 3cb670a86e14082ce439738fcd049c3a3962ad0156b5484b09dfa888756e3da5 |

The copied archive schema has the same hash as the authorized canonical `ayautc/src/schema.sql`. Its `messages` rows are an existing rebuildable projection; this patch does not issue canonical Observer IDs. Identity separation, scoped replay immutability, generation-sensitive occurrences, additive correction lineage and unverified candidate association are covered by the passing focused tests. Broader integration validation remains with the parent worker.
