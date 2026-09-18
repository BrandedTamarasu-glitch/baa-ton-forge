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

## Native preparation and submission preflight follow-up

Recorded 2026-09-18 against the update merged in
[Forge PR #6](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/pull/6).
These results summarize the owning Pi root's reported native evidence, not a
fresh test run by the report author.

The first preparation after reload used older extension code: its saved record
lacked `nativeReadiness` and used the previous handoff message. After a full Pi
restart in the same owning pane/session, fresh preview succeeded and preparation
rejected the missing prerequisite:

```text
Application source workspace is unavailable: missing source_workspace_id; inspect native Herdr metadata before preparing
```

No Baa-ton planning or dispatch occurred on this rejected preparation. With
explicit user authorization, the root then created an agent-free application
source workspace through Herdr. This was a separate setup step, not automatic
binding by Forge.

| Evidence | Recorded result |
| --- | --- |
| Owning root | `w18:p1` / `w18`, original owning Pi session |
| Source workspace | `w1B`, independently found in native inventory |
| Repository / target | `apps/sample` / `.worktrees/smoke` |
| Native preparation record | `5873b021`, saved root/session/source `nativeReadiness` |
| Prepared commit | `2c8abd6549be37ae5bd8876e52c38f29d9c73aa0` |
| Exact profile | Read-only; `claude / claude-code / claude-sonnet-5 / high / subscription` |
| Planning / mapping records | `141cd84f` / `9dbb7d61` |
| Mapped workflow / task | `herdr-004a739a` / `readme-preparation-check` |
| Manifest snapshot captured | `2026-09-18T14:23:44.741Z` |

The saved planning snapshot contains these SHA-256 fingerprints:

```text
raw:   35b640cccef0ff3c122527d9b5d09ce3fac4af2c1c7a29d5fec9eb0ac57cf7a1
state: f82d3de6fa412f13ea4c7bbd8db917f401f8083471626b5d2ff22fc86caa4cfc
```

The root reported readiness rechecked before submission and successful mapping
after `herdr_plan`. It stopped after planning: this follow-up has no dispatch,
completion receipt, or lane verification. Existing roots, workflows, receipts,
and historical bindings were preserved; no cleanup was performed. Recovery using
the new snapshot has automated coverage but was not exercised by a live failed
submission in this follow-up.

### Remaining issue coverage

- [Issue #1](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/issues/1):
  explicit `repoCwd` support and the Linux nested-repository writer/review path
  are demonstrated above. The reported Windows layout remains unqualified.
- [Issue #5](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/issues/5):
  preflight now detects absent source binding before submission, but does not
  automatically create it. Idempotent native binding from the existing controller
  and a Windows end-to-end regression reaching `herdr_plan` remain outstanding.
  The separately authorized source-workspace creation above does not satisfy the
  issue's requirement to avoid manual setup.
