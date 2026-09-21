# Native Linux guided setup qualification

**Final result (September 21, 2026): PASS.** The later fresh fixture completed
writer execution, authorized integration and an independently root-verified fresh
review with a delivered receipt. See [completed trial](#completed-trial) below.
The initial milestone and intervening failures remain recorded here as history.

On September 21, 2026, the owning Pi root reported a successful guided setup
trial through native planning, stopped before dispatch. Local inspection of
the actual Pi session entries, durable manifest, setup/source journals and Git
checkouts independently corroborated the saved setup and planning results.

| Evidence | Observed value |
| --- | --- |
| Forge revision | `8f0ebf49e608bd7157851d4280d4117f35e957da` |
| Baa-ton revision | `1f1a126c848adb91e14826f44bb6e6091087892b` |
| Reported runtime | Linux CachyOS x86_64, Herdr 0.9.1, Pi 0.86.1 |
| Controller | `/home/corye/Baa-ton`, `w18:p1` / `w18` |
| Owning Pi session | `01a0c480-d42f-7047-abad-adbf96b81f4d` |
| Setup draft | `b482cf84cd6ee6c66a10336c56a72ff3486da1e6c37eedac8210f1f5a5a22e20` |
| Application/worker baseline | `db8216d0ba3b5a4cebd8b2f70b3d3dd2166e71a0` |
| Writer branch | `forge/native-trial` |
| Review checkout | Separate, detached, at baseline |
| Native source workspace | `w1G` |
| Source creation attempt | `c3c53702-21cc-4be5-9e2c-6bd0301a914d`, one `bound` attempt |
| Planned writer workflow | `herdr-d38f21e7` |
| Writer profile | `claude / claude-code / claude-sonnet-5 / high / subscription` |
| Review profile | `claude / claude-code / claude-opus-5 / high / subscription` |

## Results

- Native setup preview displayed the generated brief and exact assignments
  before apply. The root reported no task directory, writer branch or extra
  worktrees before apply. Apply ran once and the setup journal is `complete`.
- Read-only writer preparation rejected the missing source workspace. Automatic
  preparation established `w1G`; a second successful preparation reused it.
- Review preparation rejected the missing writer verification. It did not create
  a review workflow or bypass the dependency gate.
- Native `herdr_plan` succeeded for the prepared writer. The durable workflow
  is `planned` and binds the writer checkout to the application source `w1G`.
  It has no startup attempt, assigned lane pane or completion receipt.
- Local Git inspection confirmed the application and both worktrees clean at
  the baseline commit. The owning root reported unchanged controller HEAD/index
  and preservation of its unrelated untracked files.

The inspected session entries are `a574f3ba` (setup draft), `8048b027` (normal
preview), `10f20f1f` (setup complete), `a8a33793` and `c23c29f4` (writer
preparations, both `w1G`), `9c21dbad` (planning snapshot), and `9efc94a5`
(saved mapping). The planning snapshot recorded raw manifest SHA-256
`7941624d0b9a9bc9f266f7197488630d6954269ed6c9fef86d60457253f109f1`
and state SHA-256
`ee871872c87b3ccc5b844d1bac5aa7b4bd08652b430d77d3972ba8963aaacb4f`.

## Preflight recovery and limits

An earlier attempt correctly stopped because the live pane still held an old
test project's registration. The user authorized retiring that registration
while preserving its files and ledgers, then approved the exact native recovery
preview moving the Baa-ton root from the absent `w1E` workspace to `w18:p1`.
Native identity then passed. Doctor returned `ok: true`, with warnings for
unrelated stale roots and gone historical lanes that had completion receipts.
Historical workflow `herdr-58cc1e63` and its receipt remained preserved.

The original local report, including the failed preflight, is retained at
`/tmp/forge-guided-setup-trial-cskp77/RESULTS.md`. Temporary evidence can disappear
on reboot; this checked-in report preserves the milestone and identifiers.

This qualifies guided setup, source reuse, dependency blocking and native
planning in the tested Linux environment. It does not qualify dispatch with
these profiles, runtime entitlement, writer completion, integration, reviewer
execution, Windows guided setup or every interrupted-setup recovery case.
Those were outside this initial milestone. Later results follow below; the old
mapped writer and its failed startup history remain preserved.

See the [repeatable trial procedure](guided-setup-trial.md).

## Subsequent writer startup attempt

A separately authorized dispatch on September 21 reached child creation and
Claude startup in `w18:p7` (`child-d38f21e7-1`) but failed at `agent-start` with
native `agent_not_ready`. Forge recorded intent
`4b34683c-a839-45ef-b5ad-9ca856a35012` and its error result. Native observation
subsequently reported the same Claude child idle and interactively ready,
displaying Sonnet 5 with high effort. The durable workflow remained
`dispatch-failed`, with no task prompt attempt or completion receipt.

Local checks confirmed all three checkouts still clean at the baseline and the
writer baseline checker passing. A later dispatch request was correctly blocked
by the consumed one-shot guard; it did not launch another child. This exposed
the need for an explicit, audited recovery handoff for the existing unprompted
child. The new `/forgeflow-retry-startup` command implements that narrow case;
its live execution had not been demonstrated at this milestone. The later native
probe used Baa-ton recovery directly, not this brief-backed Forge wrapper.

## Completed trial

The fresh fixture at `/tmp/forge-guided-setup-trial-IMUEVx` reached PASS after
explicitly authorized recovery steps and a fresh reviewer. This is a successful
Linux trial with preserved failures, not an uninterrupted run or Windows
qualification. The final evidence was independently checked against the durable
manifest and the actual owning Pi session before this report was committed.

| Evidence | Observed value |
| --- | --- |
| Forge implementation revision | `f620012466e5425dabc4d3452179c1ceffca8cab` |
| Baa-ton trial base | `1f1a126c848adb91e14826f44bb6e6091087892b` plus local fixes |
| Baa-ton fixes committed after trial | `c1cb54a` |
| Runtime | Linux CachyOS x86_64, Herdr 0.9.1, Pi 0.86.1 |
| Application baseline | `8943a32e4631e3b54dc7e5c4215ba537c08c2513` |
| Integrated and reviewed commit | `d10a87c991b958aebdcb23740e076187f400d6ae` |
| Writer | `herdr-0330cbf7`, Sonnet 5 / high / subscription |
| Writer receipt | `incarnation-d687ec0b-b69` |
| Final reviewer | `herdr-fc507ba2`, Opus 5 / high / subscription, read-only |
| Final source workspace | `w1J` |
| Review receipt | `incarnation-00e409fe-8ea`, delivered |
| Review verdict | PASS; no findings or blockers; no reviewer edits |
| Native verification | `review-fresh`, entry `d23ec041`, `2026-09-21T18:58:36.859Z` |
| Owning Pi session | `01a0c480-d42f-7047-abad-adbf96b81f4d` |

The root independently checked all three checkouts (application, writer and
review): exact reviewed HEAD, clean working tree, `node check.mjs ready` success,
and exact six bytes `72 65 61 64 79 0a` in `status.txt`. The baseline-to-commit
diff changes only `status.txt`, from `pending` to `ready`; `README.md` and
`check.mjs` retain their baseline blobs. The full reviewer receipt agrees with
those checks. Native verification records the exact fresh review brief hash
`10e4d1459046333464af7ea482846e1837415dd7471bdb5606da6d8ec7c2956f`.

### Recovery history and limits

- The writer completed and was natively verified before review. Its commit was
  fast-forwarded into the application and detached review checkout under native
  approval. The approval helper needed detached-HEAD support; chained merge and
  validation commands remain outside its deliberately standalone command grammar.
- Source workspace `w1H` disappeared after reviewer `herdr-4578d1f3` was planned.
  Dispatch readiness rejected the missing binding before recording an intent.
  Authorized replacement preparation created `w1J`; the old plan was preserved.
- Replacement reviewer `herdr-400e1235` recorded assignment submission but showed
  no persisted conversation or receipt. Its pane later disappeared. A native
  resume failed with `agent_pane_busy`; shell creation and start rejection were
  about 22 ms apart. This supports a startup timing race, but does not prove the
  foreground state at rejection. The exact saved session could not be found.
  This reviewer remains unresolved; absence of a transcript does not prove that
  the assignment had no effect.
- Isolated native probe `herdr-7c2acfe4` initially failed with `agent_not_ready`
  before assignment. Separately approved native recovery reused its attested
  existing child and session, observed working activity, and persisted
  `FORGE_DELIVERY_PROBE_OK`. Receipt `incarnation-8c25b794-539` was stored;
  delivery was still pending at its last reported inspection. No later delivery
  result is claimed here.
- A separately authorized fresh review-only brief produced `herdr-fc507ba2`.
  It reused `w1J` and the clean review checkout. It did not rewrite the old
  reviewer or manufacture writer verification for a new brief.
- Doctor's historical global failure was retained under the user's narrowly
  scoped continuation exception. The missing historical portability lane and
  old failed writer startup were not relabeled healthy or cleared.

The Baa-ton fixes now support detached-checkout approval, require bounded observed
activity after assignment submission, and recheck shell readiness before up to
three starts following explicit pre-launch `agent_pane_busy` rejection. Timeouts,
`agent_not_ready`, and uncertain assignment submissions are not automatically
retried by that helper. Regression validation: smoke check and **215 extension
tests passed**, including the 43 targeted dispatch/resume tests. The delivered
fresh review supplies live end-to-end evidence; it does not establish that every
startup race or historical delivery failure is resolved.

The final root report remains at
`/tmp/forge-guided-setup-trial-IMUEVx/RESULTS.md`; related diagnostic and handoff
files share that directory. Those files are temporary; this report preserves the
outcome, evidence identifiers and material limitations in Git. No trial resources
were cleaned up, no historical ledger was rewritten, and no further dispatch was
performed as part of recording these results.
