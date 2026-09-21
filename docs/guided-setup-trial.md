# Native guided task setup trial

Status: procedure and fixture generator prepared; no live result recorded.
Automated tests use real Git and a fixture Herdr transport. This procedure
qualifies the new setup flow through native planning, separately from issue #5.

Generate a disposable application from the Forge checkout:

```sh
node scripts/create-guided-setup-trial.mjs /absolute/existing/controller
```

The generator reads the controller's configured `implementation` and `review`
profiles, seeds a clean application with a committed `pending` status, runs its
baseline check, and prints the temporary trial directory. It changes no
controller files, registrations, profiles or workflow ledgers. It creates no
task worktrees, brief, native source workspace or workflow. Each invocation uses
a fresh directory. Preserve that directory until qualification is recorded;
temporary files may disappear on reboot.

The generated `RUN.md`, `fixture.json`, `setup-request.json`, and `RESULTS.md`
contain the exact local paths and expected profiles. The JSON input is a test
fixture for Pi to pass to the tool, not a user-authored lane brief. In ordinary
use, Pi gathers the same fields from a plain-language request.

## Native run

Use the existing registered Pi root in the controller listed in `fixture.json`.
The user enters `/reload` directly in the Pi input UI; it is not a model tool or
a shell command. If the two setup tools are already exposed from the expected
updated extension, missing programmatic reload is not itself a trial failure.
If tools remain stale, restart Pi in
the same pane and resume the same session. Do not create or reset a root for this
trial. Authorization covers the reviewed fixture setup, one automatic source
workspace and one native writer plan; it does not cover dispatch or cleanup.

1. Read `fixture.json` and `setup-request.json`. Record actual Forge/Baa-ton
   revisions, platform/tool versions, root pane/workspace and native Pi session
   identity. Confirm `forgeflow_setup_preview` and `forgeflow_setup_apply` are
   loaded. Run `herdr_doctor` and inspect current-root failures before proceeding.
   Record controller HEAD, Git index hash/status, and application baseline HEAD.
   Inspect the full doctor's `details.checks`, not only the summary: the current
   pane's registered `program.id` must match the controller checkout. A workspace
   label or shell cwd does not change its registration. Stop on a foreign-project
   mapping; `/reload` cannot repair it. Keep the exact diagnostic and actual
   pane/workspace/session in the result sheet.
   Run version diagnostics separately. Baa-ton permits standalone `pi --version`
   but rejects it inside a compound shell command as a possible agent launch.
   Do not combine it with Git checks or bypass the guard with a wrapper.
   Keep unrelated controller changes intact. Run `node check.mjs baseline` in
   the application. Use native read-only inventory to confirm it has no source
   workspace; if already bound, report the unexpected state rather than remove it.
2. Call native `forgeflow_setup_preview` with the supplied request fields.
   Display the exact generated brief, branch, both worktree destinations and
   resolved worker profiles. Compare assignments to `fixture.json`; do not
   silently substitute providers/models. Confirm preview created no task
   directory, worktree, branch or source workspace. Record the returned draft ID.
3. Call native `forgeflow_setup_apply` once with that draft ID under the existing
   authorization. Confirm `brief.json`, a writer on `forge/native-trial`, and a
   separate detached review worktree. Both must share the application's common
   Git directory, be clean, and match the baseline HEAD. Confirm a complete
   `forgeflow-task-setup/native-trial.json` journal in the application's common
   Git directory and the normal `preview` plus `setup-complete` Pi entries.
   No shell import can substitute for native calls or their session entries.
4. Call native `forgeflow_prepare_lane` for `writer` and the returned brief path
   with `createSourceWorkspace: false`. With no source registered, expect the
   missing-source rejection and no preparation record or source creation. If
   it succeeds unexpectedly, retain the evidence and investigate prior state.
5. Call native `forgeflow_prepare_lane` for `writer` with automatic source setup
   enabled. Expect fresh native root/session proof, one shell-only source
   workspace, and saved exact planning arguments. Repeat preparation once
   before planning; confirm the same source ID and a single creation audit.
   This repeat is permitted only after the first preparation succeeded.
6. Call native preparation for `review`. Expect rejection because the writer
   lacks root verification. Confirm no review workflow or preparation was
   created. Do not bypass this gate or manufacture verification records.
7. Submit the latest writer preparation's exact arguments through native
   `herdr_plan` once. Require a successful workflow, repository-parent source
   binding, saved Forge mapping, and pre-submission manifest snapshot. Inspect
   `forgeflow_status` to confirm the writer is planned and review remains blocked.
   Preview-only or fabricated tool results do not qualify this step.
8. Stop before dispatch. Record native tool-call references, draft ID, source and
   workflow IDs, journal, manifest snapshot and final status in `RESULTS.md`.
   Independently check application/writer/review cleanliness and baseline HEADs,
   unchanged controller HEAD/index and preserved unrelated edits. The manifest
   may legitimately gain this workflow and root activity; historical mappings
   must remain intact. Confirm no startup attempt or completion receipt.

On any unexpected failure, stop and record the exact error and resources already
created. Preserve interrupted journals, branches, worktrees and ledgers. Do not
retry an uncertain apply/plan, reset roots, create a replacement workflow, or
delete resources to force a passing result.

## Separate later dispatch trial

The fixture has a future writer objective: change only `status.txt` from
`pending\n` to `ready\n`, preserving the README and checker. `node check.mjs ready`
validates it. No dependency installation is required. This first trial does not
run that writer or establish provider/runtime qualification.

After separate authorization for dispatch and integration, use the existing
mapped writer workflow rather than replanning it. Root validation must inspect
the diff, rerun the checker, commit if needed, integrate and save verification.
The detached review checkout starts at the baseline and must be fast-forwarded
to the integrated commit before review preparation. Preserve the writer's
workspace and checked commit. Review dispatch and verification are separate
actions with their own evidence; do not infer them from a successful setup run.
