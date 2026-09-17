# Linux nested-repository trial

Completed 2026-09-17. Related: [issue #1](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/issues/1).

The controller held the brief and root session in one Git repository. An
independent nested application repository supplied separate linked smoke,
writer, and review worktrees. Task-level `repoCwd` selected the application;
`worktreeCwd` selected each lane checkout.

## Recorded result

| Check | Result |
| --- | --- |
| Smoke | `herdr-3e40093b`, read-only, durable receipt independently verified |
| Writer | `herdr-15de2469`, native root verification saved |
| Review | `herdr-7f1c7684`, receipt delivered and native root verification saved |
| Application/review commit | `d78f5f44b27ffd979abc5fb9d5b815cc6cd9e70e` |
| Application change | Only `status.txt`: `pending\n` → `ready\n` |
| Controller commit | Unchanged at `e6310c24d4ff101aaec58224e9a3b95e33554c36` |
| Final checkouts | Application, review, and controller clean |

The root confirmed that review preparation rejected the stale baseline review
worktree. After a guarded fast-forward, fresh preparation and read-only review
succeeded. Worker receipts were independently checked before native verification.
The writer used Pi/OpenAI Codex; the review used native Claude Code. Exact launch
profiles and runtime qualification remain Baa-ton's responsibility.

## Recovery exercised and qualifications

- Claude startup paused for folder trust. A local Baa-ton fix requalified and
  reused the same agent after user interaction; no automated trust approval or
  replacement launch was used.
- The smoke completed with a durable receipt while notification delivery stayed
  pending. The root inspected and verified durable state without redispatching.
- The application's earlier fast-forward was visible in Git reflogs, but its
  executor and confirmation were not established. The user accepted the verified
  current state; the writer and final review records retain this provenance gap.
  Acceptance does not establish retroactive approval.
- A local Baa-ton guard fix allowed the root to confirm the later review-worktree
  fast-forward. Ordinary merges remained blocked.
- The application source workspace disappeared. Review planning rejected missing
  `source_workspace_id` before persistence. Forge recovered the exact failed
  submission using saved native call/result evidence and matching pre-submission
  workflow observations. Historical records and old workspace bindings remained
  intact. After source-workspace repair, the root freshly prepared the review.

This report summarizes the owning root's recorded trial results; it is not a new
test run. Runtime manifests, session transcripts and briefs remain local and
Git-excluded. The trial did not push or clean up its resources.

This establishes the tested Linux layout, not Windows qualification, arbitrary
provider compatibility, included subscription billing, or cross-application live
dependency handling. Local Baa-ton patches used by this trial must be reviewed
and installed separately; updating Forge alone does not install them.
