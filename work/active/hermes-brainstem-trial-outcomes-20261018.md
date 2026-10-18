# Brainstem revision 2: Hermes producer prerequisite

As of 2026-10-18. Producer owner: Codex, authorized by Khamani in this AEON
chat to build the Hermes prerequisite. State: source implemented and verified;
independent code review and trial deployment remain pending.

The implementation and full handoff have one owner:
[Hermes producer handoff](../../worktrees/hermes-brainstem-trial-outcomes-20261018/docs/brainstem-trial-producer-20261018.md),
branch `codex/brainstem-trial-outcomes-v0.22.2`, commit
`dd32866789d6b1a639281a0c6956c91a662a196f`.

Fresh verification: 112 affected Hermes tests, 144 native/PostgreSQL
compatibility tests, 12 repository checks, and isolated Desktop inspector
verification passed. The live Hermes checkout was not switched. The validation
container was returned to its stopped state.

Next owner: the Brainstem trial implementer must connect durable-outcome
discovery to inbox/PostgreSQL recovery and complete the revised grant/session
selection work before reviewed deployment. Real-session surface qualification,
including pre-submitted CLI/TUI user membership, remains necessary. This work
grants no new capture, budget, service activation or deployment authority.

Durable continuation was added with the server's expected-checksum condition
and read back in the existing aya-development Cloud checkpoint,
`Plans/Hermes-first Restart/Hermes-first Aya — Experience and Learning Plugin.md`
(note `119bb6f1-4c43-4e4c-9e7b-71b5fe89b744`). Prior prose and frontmatter were
preserved. Source/test evidence remains with the linked Hermes owner.
