# Guided workflow diagnosis

Select a task from its original brief in the owning Pi session branch:

```text
/forgeflow-diagnose-lane "/absolute/path with spaces/brief.json" review-fresh
```

The default reads saved evidence only. To explicitly inspect native root identity,
the selected child and its source binding, append `--live` on the same line:

```text
/forgeflow-diagnose-lane "/absolute/path with spaces/brief.json" review-fresh --live
```

The tool equivalent is `forgeflow_diagnose_lane` with `filename`, `taskId` and
optional `inspectNative: true`. There is no execute option. Native inspection has
a 15-second overall deadline, cancellation, and a 256 KiB response limit. It
rechecks critical evidence before reporting startup eligibility. It never sends
input, runs acceptance tests, searches provider transcripts, writes workflow
records, starts model turns or creates resources. Pi retains normal displayed
tool history.

Inspect saved dispatch history for a specific workflow with
`/forgeflow-dispatch-audit herdr-example`. Omitting the ID retains the latest-intent
view; selecting an ID includes its linked attempts, including startup retries.

## Reading the result

The structured report has `version: 1`, `mode: workflow-diagnosis`, task/workflow
identity, observation time, brief and manifest hashes, `diagnosis`, `facts`,
`gaps`, `blockers`, `warnings`, pending requests and one `nextStep`. Facts include
provenance and explicit present, absent-in-inspected-source, conflicting or
not-inspected states. `executed` is always false and `authorization` is always
not-assessed. `nativeReadiness` distinguishes not-inspected, inspected and
incomplete; it is not permission to dispatch.

| Result | Meaning |
| --- | --- |
| ownership-or-evidence-blocked | Mapping, brief, manifest or ownership is insufficient; no child probe occurs. |
| conflicting-audit / stale-snapshot | Evidence conflicts or changed; inspect again before acting. |
| startup-before-assignment | Saved startup failure is a candidate for further inspection only. |
| assignment-unresolved | Submission may have had effects; missing output is not proof of non-delivery. |
| completion-awaiting-verification | Receipts exist; use independent verification even if notification delivery is pending. |
| verified-historical | Recorded root verification exists; no tests were rerun. |
| source-binding-changed | Live source inventory differs; no workspace was recreated. |
| parent-request-pending | A recorded question, approval or answer still needs attention. |
| no-recorded-attempt / execution-unresolved | Evidence is limited to the inspected branch; it does not establish safe replay. |

Only the shared startup-retry checker can produce `eligible-at-inspection`.
The displayed command still requires fresh execution guards and native user
confirmation. If the existing retry command would select a newer unrelated
intent, diagnosis suppresses that command. Missing agents and existing shell
panes are reported separately. Resume availability remains unproven without the
native session evidence. Native-only probes without a Forge brief mapping are
outside this interface.

## Native qualification handoff

Automated fixtures are not live Pi qualification. In the owning root, reload the
updated extension, confirm the command is registered, and record before/after
workflow, resource and custom-ledger state. Select a completed review from a retained brief, for example:

```text
/forgeflow-diagnose-lane "/absolute/path with spaces/completed-review.json" review-fresh
/forgeflow-diagnose-lane "/absolute/path with spaces/completed-review.json" review-fresh --live
```

Confirm the report selects the mapped workflow, identifies its stored receipt and
historical verification, and does not claim a fresh validation run. If the
original branch/mapping is unavailable, retain the blocker rather than recreating
it. Save both reports and before/after evidence. Stop after inspection: no retry,
resume, dispatch, integration or cleanup. Do not mark live qualification passed
until the owning root has recorded those observations.
