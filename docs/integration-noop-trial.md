# Native already-integrated preview qualification

Status: pending. This is a new qualification, not a reconstruction of the missing
`/tmp/forge-guided-integration-trial-pdyb7gs8/` trial. Its successful integration
audit and blocked no-op follow-up remain documented in [guided integration](guided-integration.md).

## Select intact evidence

Run in the owning Pi session with the registered Forge extension. Record the
loaded extension's identity, checkout commit, and current native ownership proof.
Do not infer ownership from a historical pane or session identifier.

Inspect that session's existing brief mappings for an intact completed writer
whose commit is already integrated into its clean application checkout. Require
the original brief, writer checkout, durable receipt and session records to be
available and unambiguous. The application destination must have a named branch.
Do not use the review destination: an already prepared reviewer is intentionally
rejected by the review-advancement guards.

Use a persistent evidence directory outside temporary storage and outside the
checkouts being inspected. Record its absolute path. Save complete structured
results as well as displayed output; do not copy unrelated session history.

If no intact candidate exists, stop the read-only qualification as BLOCKED.
The next setup preview should propose a separate durable application and task
directory, explicit acceptance checks, and the user's configured authorized
writer/reviewer profiles. Creating and running that new task is a separate
phase; do not invent receipts, verification records, mappings or profiles to
make a preview eligible. Do not restore the missing trial under its old path.

## Run one preview

Capture the selected brief hash, full workflow and receipts, relevant Forge
custom records, resource inventory, and application/writer checkout branch,
HEAD and status before inspection. Distinguish unavailable native facts from
confirmed absence.

Run the registered tool once with the selected original brief and writer task:

```text
forgeflow_integration_preview({filename: "<absolute original brief path>", taskId: "<writer task ID>"})
```

The equivalent slash command is:

```text
/forgeflow-integration-preview "<absolute original brief path>" <writer-task-id>
```

Use one interface, not both. Do not call integrate-once, final verification,
review preparation, dispatch, recovery or cleanup. Do not execute the returned
`next` suggestion as part of this inspection.

## Pass criteria and report

The full result must establish all of the following:

- The expected task, workflow, writer commit and application destination match.
- `state` is `already-integrated`, `command` is `null`, and `blockers` is empty.
- `executed` is `false` and `authorization` is `not-assessed`.
- The application HEAD contains the writer commit; record both full hashes.
- Before/after comparison shows unchanged workflows, receipts, Forge custom
  records, resources, checkout branches, HEADs and working-tree status.

Ordinary Pi tool/display history is expected and must be distinguished from
workflow mutations. Saving evidence outside the inspected checkouts is also
expected. No integration intent, attempt or result should be added by preview.

Write `RESULTS.md` in the persistent evidence directory with PASS, BLOCKED or
FAIL; exact code/runtime identity; selected mappings and hashes; evidence paths;
before/after differences; and any unavailable checks. A prerequisite error is
not a successful no-op. Report unexpected changes as a failure without repairing
them during qualification. Attribute reports relayed to another session to the
owning session rather than claiming independent native observation.


## Resuming the durable trial after phase scoping

The September 22 durable trial reached writer receipt `incarnation-4ba497ea-939`
for `herdr-e707a7c8`. Draft `6a1d25d8-45ed-4625-a0bd-9d6dcd00ecf3` passed scope,
all three checks and acceptance 1–2, but blocked on acceptance 3–4 because those
conditions require integration and reviewer advancement. That draft must remain
historical; it is not eligible for saving.

After loading the updated extension in owning session
`01a0c9fe-f335-7790-b3f4-37943ae9ca9a`, inspect current ownership and the original
brief before proceeding. Cancel the open blocked handoff, preserving its records.
Propose these assignments with `forgeflow_preview_acceptance_scope` for
`/home/corye/forgeflow-integration-noop-20260922/tasks/application-forge-integration-noop-qualification-20260922/brief.json`:

| Original criterion | Task(s) | Required phase |
| --- | --- | --- |
| acceptance-1: exact marker commit | writer, review | pre-integration and final |
| acceptance-2: independent root checks before integration | writer | pre-integration and final |
| acceptance-3: retained provenance and integrated application | writer | final |
| acceptance-4: separately advanced read-only reviewer checkout | review | final |

Use `phase: "pre-integration"` for the first two entries and `phase: "final"`
for the remaining entries. Review the exact original criterion text returned by
the tool and confirm the proposal with `/forgeflow-accept-acceptance-scope`.
This is a proposed continuation, not evidence of native confirmation or completion.

Start fresh writer pre-integration validation. After its separate acceptance,
preview integration and follow the native approval path. Final writer verification
must reassess criteria 1–3 before reviewer advancement. The reviewer must validate
criteria 1 and 4 after its separately authorized work. Retain both checkouts,
receipt and original brief for the already-integrated no-op preview. No live
scope adoption, validation, integration or reviewer dispatch was performed by the
implementation tests.
