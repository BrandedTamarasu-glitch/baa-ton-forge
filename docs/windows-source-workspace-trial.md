# Native Windows source-workspace regression

Tracking: [issue #5](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/issues/5).
Status: procedure prepared; no live Windows result recorded yet. The CI matrix
runs real Git with a fixture Herdr transport, not a live Baa-ton controller.

## Prerequisites

Use an already authorized, registered Pi controller root in native Windows Herdr,
with this adapter freshly loaded and the updated Baa-ton installation. Keep the
controller in a disposable parent Git checkout. Use an independent nested Git
repository and a clean, pre-existing linked writer worktree. Include spaces in
at least one checkout path. The user's authorization must cover creating that
disposable Git fixture, one shell-only source workspace, and one planned Baa-ton
workflow. No dispatch or cleanup is part of this regression.

Do not run `herdr workspace create`, `herdr worktree open`, a second controller,
or the standalone Baa-ton installer to satisfy the source prerequisite. Do not
reuse or alter an existing completed trial's brief. Keep the new brief excluded
from Git and preserve original roots and controller mappings.

## Native steps

1. Record actual `HERDR_ENV`, pane/workspace/session identity, Baa-ton and Forge
   commits, Windows/Herdr versions, controller/application/writer HEADs, and clean
   Git statuses. Run `herdr_doctor`. Report any failure without bypassing it.
2. Use native read-only worktree/workspace inventory to confirm the application
   has no source workspace. If already bound, use another authorized disposable
   repository rather than closing someone else's workspace.
3. Make a new one-task brief with explicit absolute Windows `repoCwd` and
   `worktreeCwd`, a README-only writer scope, and an exact authorized launch profile
   or project `taskProfile`. Do not substitute models or authentication.
4. Call native `forgeflow_plan_lanes`. Then call `forgeflow_prepare_lane` with
   `createSourceWorkspace: false`. Expect missing `source_workspace_id`, no saved
   preparation, and no workspace creation.
5. Call native `forgeflow_prepare_lane` with its default automatic setup enabled.
   Confirm a single shell-only source workspace appears and the saved
   `nativeReadiness.source.workspaceId` equals both native inventory results.
   Inspect the common-Git-directory audit: one `bound` attempt with the actual
   creator's root/session identity. There must be no new agent/controller root.
6. Prepare the same task again before planning. Confirm the source workspace ID
   is unchanged and the audit still has one creation attempt. Root cwd and HEADs
   remain unchanged; no manual native setup was required.
7. Submit the exact prepared arguments through native `herdr_plan`. This must
   pass Forge's submission recheck and Baa-ton's real source-workspace validation.
   Record the resulting workflow/task mapping, native repository-parent binding,
   and the saved pre-submission manifest fingerprint. A simulated tool result or
   preview/prepare alone does not pass this step.
8. Stop after planning. Independently check unchanged Git HEADs and clean
   checkouts, no dispatch/receipt, and preservation of historical root mappings.
   Report workspace/workflow IDs and any unresolved checks. Do not delete the
   source workspace, close resources, or edit audit records.

If a create response is uncertain, inspect the reported journal and native
inventory. Do not clear its journal/lock, repeatedly create workspaces, or use a
shell import to impersonate the native tool. Existing resources remain available
for diagnosis. Native preparation can reuse a binding that actually materialized;
absence after an unresolved request requires investigation.

## Evidence required to qualify Windows

- Exact platform, installed revisions, root/session and repository identities.
- Missing-source rejection with `createSourceWorkspace: false`.
- One automatic source creation and reuse on a repeated preparation.
- An actual successful native `herdr_plan` with matching source binding and Forge
  mapping, including manifest snapshot evidence.
- No second root, model substitution, manual source-workspace setup, dispatch,
  Git changes, or historical mapping edits.

Record a qualified result only after the owning root has independently checked
these facts. This document does not claim the trial has run.
