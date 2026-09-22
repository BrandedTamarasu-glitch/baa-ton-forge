# Guided integration

Inspect a completed writer before moving any checkout:

```text
/forgeflow-integration-preview "/absolute/path with spaces/brief.json" writer
```

The tool equivalent is `forgeflow_integration_preview({filename, taskId})`.
It reports the writer commit, application destination, branch/HEAD, validation
provenance, blockers and the proposed exact fast-forward command. It reads saved
ownership and current Git state; preview itself makes no native calls or writes.
A blocked preview is not permission to bypass its checks.

## Validate before integration

Final root verification already requires integration. A separate pre-integration
validation draft resolves that ordering without relaxing final verification:

```text
/forgeflow-verification-handoff "/absolute/path with spaces/brief.json" writer --before-integration
```

The existing validation turn inspects scope, runs the declared checks under the
root's normal permissions, and records assessments tied to actual tool results.
Review them with `/forgeflow-review-verification`. In this mode confirmation
accepts validation for the exact commit and closes that validation handoff. It
does not mark the task verified, satisfy dependent tasks or merge anything.
Changed brief, checkout or evidence invalidates the approval.

## Integrate one checkout

Rerun the preview, then request one native invocation:

```text
/forgeflow-integrate-once "/absolute/path with spaces/brief.json" writer
```

To avoid pasting a long path, an accepted pre-integration validation also permits:

```text
/forgeflow-integration-preview writer
/forgeflow-integrate-once writer
```

The short form resolves the brief from this session's accepted validation records.
It requires a single unambiguous brief/workflow for that writer task; otherwise
use the explicit path. It performs the same fresh evidence and ownership checks
and requires the same confirmations. It does not resume or retry an earlier intent.

Forge rechecks evidence and owning-root identity around confirmation, records an
intent, and requests one exact native `bash` call. Baa-ton's existing fast-forward
approval hook must approve that call and recheck Git state. Forge does not run
Git mutations through its own subprocess or bypass a denied native call.
The native approval extension must be installed; versions without that supported
path may block the call. Stop on that result rather than substituting a command.

Only `rtk proxy git -C "checkout" merge --ff-only FULL_COMMIT` is supported.
Paths outside the native parser's restricted grammar, divergent history, dirty
checkouts and detached destination HEADs block. No reset, rebase, squash, merge
commit, commit creation, push or resource cleanup is performed.

Forge records the attempt before the native call. After a successful native
result, it independently checks that the destination is clean, at the exact
commit and still on the expected branch/repository. It then stops. Missing,
failed or ambiguous results never trigger automatic retries. Inspect
`/forgeflow-integration-audit` in the owning session. Reload does not rearm an
unfinished handoff. These hooks govern Forge handoffs, not arbitrary manual Git.

## Verify, then advance review

After application integration, use the existing verification handoff without
`--before-integration`, rerun independent checks and explicitly save final
verification. Historical or pre-integration results are not substituted for
that final verification.

The same accepted-validation short form avoids repasting the brief path:

```text
/forgeflow-verification-handoff writer
```

This starts a new final verification handoff with fresh evidence; it only reuses
the unambiguous brief location. Review its new draft separately.

For an unprepared read-only task in the same brief that depends on this writer:

```text
/forgeflow-integration-preview "/absolute/path with spaces/brief.json" writer --review review
/forgeflow-integrate-once "/absolute/path with spaces/brief.json" writer --review review
```

The destination must be a distinct clean linked worktree in the same repository,
with no preparation/submission/mapping record and no durable workflow using it.
Other dependencies must be verified in the proposed commit. Native handoff also
checks source binding and rejects an already open target workspace without
creating resources. Already-integrated destinations return a no-op preview.

Afterward run the separately displayed `/forgeflow-prepare-lane` command. Existing
preparation rechecks all dependency and native source rules; planning and dispatch
remain separate. Advancing a review checkout does not start a reviewer.

## Qualification

Automated tests cover local Git histories and mocked native handoffs. Live
approval, integration, final verification and review preparation still need a
disposable trial in the owning Pi root. Preserve historical workflows. Use a
fresh Pi process resuming the same session after an update if `/reload` retains
old module behavior; a checkout hash alone does not prove loaded code.
