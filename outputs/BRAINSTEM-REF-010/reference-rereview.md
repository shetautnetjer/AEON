# Independent reference slice re-review

Verdict: **approved for the bounded offline candidate slice**. No remaining material correctness findings identified in the reviewed functions. The original findings and receipt remain preserved in `reference-review.md`.

Re-read the final reference admission, interpretation, history, resolution and candidate association functions after repairs. Both prior findings are resolved: full history now requires `allow_content=True`, and an existing metadata database without reference tables returns `reference_missing` on an authorized history read. Resolution propagates its authorization to history. Missing candidate tables now produce `reference_link_mismatch` and roll back the transaction.

Verification: `python3 -m unittest discover -s tests -p test_reference_admission.py -v` in `brainstem-slice`: **10 tests passed**, 0.034 seconds. Separately reproduced these outcomes using temporary synthetic fixtures:

```text
empty history False content_not_authorized
empty history True reference_missing
populated history without optin content_not_authorized
missing candidate reference_link_mismatch
retained payload {'claim': 'amber'}
```

The focused tests also confirm that a replacement source generation with identical bytes yields `changed_source`, while retained verified artifact content remains available. Retry/reopen, occurrence distinctions, additive correction history and existing candidate association remain covered. No implementation edits, network, model calls, service changes or full-suite execution were performed in this review.

Exact reviewed SHA256s:

```text
aa16647e0f6db4443407fdcfa6736ce3bf933fc97c26a87627d40099d7f07e9c  brainstem-slice/memory_v0.py
7a8247417aec5d91ddeaced784634f6fa97941cc31ad9701bff443e9a43d07fb  brainstem-slice/tests/test_reference_admission.py
11c11abb82366def9b149af4f05138f1a41c4ab4dbaa940a0f656dcf6642b565  brainstem-slice/docs/plans/2026-10-09-reference-first-slice.md
```

Approval does not establish production Observer writer authority, complete canonical schema validation, adapter provenance, governed artifact custody, PostgreSQL persistence, or semantic truth. Those remain the plan's explicit deferred boundaries.

## Final test and documentation refresh

The implementation hash remains unchanged. Reviewed the added native-time and AYA_UTC component-coordinate roundtrip test and the appended README and architecture candidate boundaries. The documentation accurately limits the executable binding to Hermes rows and explicitly defers the AYA_UTC resolver; retention of caller-supplied coordinates does not claim adapter qualification. No new findings; approval remains limited to this offline slice.

Reran the same focused command: **11 tests passed**, 0.036 seconds. The added case verifies exact native time and component-coordinate retention without introducing stream/global order. The parent's full suite remains outside this review.

Current exact SHA256s (superseding the test hash above):

```text
aa16647e0f6db4443407fdcfa6736ce3bf933fc97c26a87627d40099d7f07e9c  brainstem-slice/memory_v0.py
51069611a6fad702d498c11aaf3ac963e5bd0fe1ecafd77ffe3d77bcc482f276  brainstem-slice/tests/test_reference_admission.py
11c11abb82366def9b149af4f05138f1a41c4ab4dbaa940a0f656dcf6642b565  brainstem-slice/docs/plans/2026-10-09-reference-first-slice.md
c86e14720e280f468ec24a131b47c72ea60f2ab7231a1eaa3bd2ae43844e91e8  brainstem-slice/README.md
6cc2bb8db3fff2a858d9e9b7bd0881a1ca69e066d1346f416d762232a013fde2  brainstem-slice/architecture.html
```
