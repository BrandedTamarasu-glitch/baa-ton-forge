# Native Windows source-workspace regression

Tracking: [issue #5](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/issues/5).
Status: on September 21, 2026, the project owner reported that Zach confirmed a
successful native Windows run. Issue #5 was closed as completed on that basis.
Detailed command output and workflow IDs were not supplied. The procedure below
remains the reproducible regression specification; the confirmation does not
claim broader Windows dispatch or verification qualification. The CI matrix
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
   In the disposable controller only, stage an unrelated instruction edit,
   make a further unstaged edit, and create an untracked journal. Record their
   contents and index diff. Keep the application and writer clean; do not commit
   these controller edits. This exercises the shared-controller requirement.
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
   tolerate a further unrelated controller journal edit made after preparation.
   It must
   pass Forge's submission recheck and Baa-ton's real source-workspace validation.
   Record the resulting workflow/task mapping, native repository-parent binding,
   and the saved pre-submission manifest fingerprint. A simulated tool result or
   preview/prepare alone does not pass this step.
8. Stop after planning. Independently check unchanged Git HEADs, clean application
   and writer checkouts, preserved controller edits/index, no dispatch/receipt,
   and preservation of historical root mappings.
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
- Preserved staged/unstaged/untracked controller edits across preparation and
  native planning; no adapter-written Git changes or historical mapping edits.
- No second root, model substitution, manual source-workspace setup or dispatch.

Record a qualified result only after the owning root has independently checked
these facts. The reported successful run is attributed above; no detailed live
transcript has been attached to this document.

## Manifest and session ownership regression

This covers the two Windows follow-ups after PR #19: historical ledgers for
different roots, and the live-agent session path versus the native Pi session.
Linux/Windows fixture tests are not live Windows qualification.

For UUID metadata, install the Baa-ton build containing
[native identity PR #10](https://github.com/zachristmas/baa-ton/pull/10) and the
Forge consumer update. Load both updated extensions in the same owning pane and
session. A restart without the code update does not repair this issue. Before
any new preparation:

1. Read the unique current pane/workspace registration and its
   `program.parent_manifest_path`. Record the canonical checkout and selected
   path. If both supported manifests already exist, record their hashes and root
   ownership. Preserve both; do not restore a previously deleted ledger just to
   run this test. Fixture CI covers that dual-layout case without altering live
   history.
2. Capture the actual parsed `herdr agent get` response's `agent_session.kind`
   and `.value`, the session path from Pi's native session manager, and
   `PI_SESSION_FILE` if present. Render each through `JSON.stringify`, not a
   terminal interpretation of backslashes or control characters. Do not paste
   credentials or unrelated environment variables.
3. For `kind: "path"`, differing spellings must resolve to the same existing
   session file. For `kind: "id"`, invoke the registered, read-only
   `herdr_root_identity`. Require `source: "baa-ton-native-pi"`, version 1,
   matching registration/pane/workspace/checkout, the native UUID and a canonical
   session path. The native extension must prove this from its own live runtime
   and file header, not the filename suffix. `PI_SESSION_FILE` may be absent.
   If the native tool/bridge is unavailable or rejects proof, stop. Record the
   exact error; do not manufacture proof, reset roots, or change ledger history.
4. Continue the authorized preparation/planning steps above. When two layouts
   exist, expect `nativeReadiness.root.manifestPath`, the planning snapshot, and
   status to select the registered ledger. Confirm the alternate historical file
   is byte-for-byte unchanged. No replacement workflow or ledger migration is
   authorized by this procedure.

If session ownership is blocked:

- Different real session files: stop and resume the actual owning Pi transcript
  in its owning Herdr pane. Do not adopt another session's workflow records.
- Invalid/control-byte native path: stop and retain the escaped diagnostic.
  `\u0007` or `\u0002` are data corruption, not separator aliases. Do not guess
  the intended characters or strip them. The native Baa-ton/Herdr path producer
  needs repair before Forge can accept that identity.
- A missing/conflicting UUID proof requires the native identity fix, not
  `herdr_reconcile_root`. Reconcile only separately demonstrated registration
  drift in the affected live root under existing authorization. Do not repeat
  reconciliation or restart as a workaround for rejected session evidence.
- If doctor still reports `root-identity=fail`, retain its complete per-root
  diagnostic. It may name a different root or a separate native identity problem.
  Report that evidence to Baa-ton and stop; Forge path equivalence does not make
  a failed native identity check healthy.

Do not manually edit registrations, delete ledgers, manufacture session paths,
or dispatch to test a blocked identity. Existing submission snapshots and saved
verification remain historical evidence and are not rewritten by these fixes.
