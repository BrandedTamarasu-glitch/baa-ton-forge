# Native Linux guided setup qualification

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
Those remain separate from this result. Continue with the existing mapped
writer under separate dispatch authorization; do not recreate or replan it.

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
its live execution and writer completion have not yet been demonstrated.
