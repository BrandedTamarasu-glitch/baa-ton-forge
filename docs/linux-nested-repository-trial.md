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

### Issue coverage at the preflight milestone

- [Issue #1](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/issues/1):
  explicit `repoCwd` support and the Linux nested-repository writer/review path
  are demonstrated above. The reported Windows layout remains unqualified.
- [Issue #5](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/issues/5):
  preflight now detects absent source binding before submission, but does not
  automatically create it. Idempotent native binding from the existing controller
  and a Windows end-to-end regression reaching `herdr_plan` remain outstanding.
  The separately authorized source-workspace creation above does not satisfy the
  issue's requirement to avoid manual setup.

## Automatic source-workspace qualification

Recorded 2026-09-18 after
[Forge PR #8](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/pull/8)
was merged and the owning Pi session restarted. This section summarizes the
root's reported native qualification; it is not a new test run by the report
author. The earlier preflight-only milestone above remains historical evidence.

The initial request selected an unavailable `implementation` profile and stopped
without creating resources. The user then explicitly authorized the configured
`quick` profile. Project configuration remained unchanged; no silent substitution
occurred.

| Evidence | Recorded result |
| --- | --- |
| Owning root | `w18:p1` / `w18`, original owning Pi session |
| Brief / task | `.pi/auto-source-trial/brief.json` / `auto-source-writer` |
| Exact quick profile | `pi / openai-codex / gpt-5.6-luna / low / subscription` |
| No-creation check | `createSourceWorkspace: false` rejected missing `source_workspace_id`; native inventory unchanged |
| Automatic setup | Exactly one shell-only source workspace, `w1C`, matching saved `nativeReadiness` |
| Repeat preparation | Reused `w1C`; one creation attempt, with unchanged audit hash |
| Creation attempt | `e09ddbea-ece7-4ad0-9381-67ad901add8a` |
| Actual native workflow | `herdr-3fc3faf2`, mapped to `auto-source-writer` |
| Planning record | `8f6ec1a8`, containing `manifestSnapshot` |
| Mapping record | `093b2ac5` |
| Application / writer HEAD | Clean at `f86dd5aec53ea9746dd8c95c2e0ea5b71fe1b5bf` |
| Controller / existing trials | Unchanged and clean |

Unlike the earlier source-workspace repair, this trial required no manual Herdr
workspace creation. Forge established the source during preparation and reused
it on retry, then passed the actual Baa-ton planning handoff. The run stopped
after planning: no dispatch, completion receipt, implementation, push, merge,
resource closure, or cleanup occurred. Selection of the exact profile is not
runtime model qualification or evidence of included billing.

The brief, creation audit, session records, and workflow manifest remain local
and outside versioned application files. The report records identifiers and
reported outcomes only; it does not copy those runtime files into this repository.

## Single-dispatch and independent verification

Recorded 2026-09-18 after Forge PRs
[10](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/pull/10)
(next-action status),
[11](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/pull/11)
(continuation preview),
[12](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/pull/12)
(read-only readiness), and
[13](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/pull/13)
(single-dispatch handoff). This is the continuation of `herdr-3fc3faf2` above,
not a replacement workflow. Evidence is the owning root's reports and pasted
native output; the documentation update did not rerun the trial.

Status first detected a newly opened Pi session and directed the user to resume
the owner. In the original `w18:p1` / `w18` session, status found the existing
mapping. Continuation preview proposed checking authorization/readiness, and the
read-only readiness command passed checkout, dependency, profile, native root,
source binding and target availability checks without dispatch.

| Evidence | Recorded result |
| --- | --- |
| Workflow / task | `herdr-3fc3faf2` / `auto-source-writer` |
| Owning session ID | `01a0b0c8-d5a4-725b-8d92-f0d581dbe4fc` |
| Brief SHA-256 | `a66607b3ce6772da7bc0d65989bb36d35cb440ed78231afbb1fda1cbe6a06e02` |
| Dispatch intent | `d85304d3-b603-416c-8807-a8dace8baacd`, native UI confirmation |
| Intent / attempt / result times (UTC) | `16:34:58.059` / `16:35:04.146` / `16:35:14.344` |
| Native call | `herdr_dispatch`, `workflowId: herdr-3fc3faf2`, `execute: true`; no restart or confirm override |
| Recorded outcome | `dispatch-reported`, `isError: false`; root stopped afterward |
| Completion notification ID | `herdr-rel-a3a84ef7-2a2b-41e7-abf2-5526054068f1` |
| Manifest receipt reported on inspection | `incarnation-18e08f54-bd5`, delivered |
| Writer checkout / branch | `.pi/auto-source-trial/writer` / `trial/auto-writer` |
| Observed launch profile | `pi / openai-codex / gpt-5.6-luna / low / subscription`; nonce/session matched; worker session confirmed model and thinking |
| Initial inspection | HEAD remained `f86dd5aec53ea9746dd8c95c2e0ea5b71fe1b5bf`; only `status.txt` had unstaged edits |
| Final verified commit | `fcdb053323c444002fc4641e4919c2628ccef1a8` |
| Final result | Native verification saved; Forge status `verified`, no further lane action |

The delivered receipt was initially treated as an unverified claim. Independent
inspection found exact working bytes `ready\n`, while HEAD still held
`pending\n`. Scope and diff checks passed, but commit, clean checkout and
application integration prerequisites were missing. The worker did **not**
complete those steps.

After separate explicit authorization, the root committed only `status.txt`
using normal hooks and performed a guarded application fast-forward. It then
independently confirmed exact `ready\n` bytes, the scoped diff, passing diff
checks and clean application/writer checkouts before saving native verification.
Controller HEAD remained unchanged. One worker was dispatched; its receipt's
"No workers launched" claim was retained as a claim of no nested workers, not a
description of the overall trial.

No redispatch, push, resource closure, cleanup or other-lane progression occurred.
This qualifies the reported Linux handoff and exact observed profile, not every
provider, Windows live dispatch, automatic verification or included subscription
billing. The trial did not exercise live cancellation, crash recovery or failed
audit writes; automated regressions cover those guard paths. Runtime state stays
local and Git-excluded. The adapter suite at PR #13 passed 86 tests locally;
Linux/Windows CI passed the selected cross-platform regression suite.

## Dirty-controller native regression

Recorded 2026-09-18 after [PR #15](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/pull/15).
This summarizes the owning root's supplied report; the documentation author did
not rerun the live trial. The separate central controller was `w1E:p1` / `w1E`
at `/home/corye/Baa-ton`. Doctor warnings concerned older roots/lane bridges;
the root reported no trial-specific blocker.

| Check | Reported result |
| --- | --- |
| Fixture | `.forge-issue5-46c6a9b8e2/`, Git-excluded application, linked writer and trial state |
| Deliberate controller dirt | Untracked `forge-issue5-46c6a9b8e2-journal.txt` |
| No-creation preparation | Rejected missing `source_workspace_id`, not controller dirt; no workspace created |
| Automatic preparation | Created shell-only source workspace `w1F` |
| Repeat after journal edit | Passed; reused `w1F`, exactly one creation attempt |
| Planning after another edit | Exact saved arguments accepted; `herdr-58cc1e63` mapped |
| Native readiness | Prerequisites passed despite dirty controller |
| Exact configured quick profile | `claude / claude-code / claude-haiku-4-5 / low / subscription` |
| Git integrity | Application/writer clean with `pending\n`; all HEADs and controller index unchanged; final journal contents preserved |

Existing workflows, profiles and roots were preserved. Resources remain open;
there was no dispatch or cleanup. This qualifies Linux's actual prepare-to-plan
path with unrelated controller edits and idempotent source binding. It does not
qualify the configured Haiku profile at runtime or establish included billing.
Staged and unstaged controller-edit cases have automated coverage; the live
trial deliberately left the controller index untouched.

## Native verification guidance

The owning root subsequently reported completing `herdr-58cc1e63`, task `status`,
in the same disposable fixture. This records the supplied native Pi results;
the documentation author did not rerun the workflow.

- Before dispatch, the corrected guidance explicitly blocked on `0/1` durable
  receipts and said not to begin completion verification.
- After completion, the receipt was saved with delivery pending. Guidance read
  the durable state and blocked on uncommitted `status.txt` changes; both HEADs
  were unchanged. Notification delivery was not a prerequisite for inspection.
- Under separate authorization, the root committed only `status.txt` using
  normal hooks: `e23d8ceb032af9bca91451824311136d7bf866a3`.
- Pre-integration guidance blocked on the missing integration. After a guarded
  application fast-forward, it returned `awaiting-independent-validation`.
- The root independently confirmed exact `ready\n`, scope and ancestry, and clean
  application/writer checkouts, then saved native verification. Final status was
  `verified`.

The controller journal and unrelated untracked `pnpm-lock.yaml` and
`pnpm-workspace.yaml` were preserved. No push, redispatch, closure or cleanup was
reported. This qualifies the Linux guidance sequence, not automatic content
review, included billing, or the new `.baa-ton` manifest layout on native Windows.

## Current issue coverage

- [Issue #1](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/issues/1):
  nested-repository support is demonstrated by the Linux writer/review trial.
  The project owner also reports Zach confirmed resolution after Windows
  testing. Detailed Windows workflow IDs and command output were not supplied
  for this report; no broader Windows qualification is inferred.
- [Issue #5](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/issues/5):
  automatic creation, reuse, and actual native planning are now qualified on
  Linux. Portable regression tests pass in both Linux and Windows CI, but use
  fixture Herdr transport. Keep this issue open until the separate
  [native Windows automatic-binding regression](windows-source-workspace-trial.md)
  reaches actual `herdr_plan` without manual source-workspace setup.
