# Native verification handoff trial

Use an existing disposable completed task in its exact owning Pi root/session.
Fully restart Pi after updating Forge. This trial validates the new handoff;
the earlier verification-guidance trial did not qualify its model turn or UI.

1. Confirm native tools `forgeflow_verification_evidence` and
   `forgeflow_draft_verification` are registered. Use `forgeflow_status` to confirm
   ownership, a durable completion receipt and the actual brief/task identity.
   Do not dispatch or adopt another session's task for this trial.
2. Check clean application/lane checkouts, their integrated commit, scoped diff
   and validation instructions. Existing historical verification may remain.
3. Enter `/forgeflow-verification-handoff "actual/brief.json" task-id`.
   This explicitly starts root validation using the current Pi model; no worker
   is launched. Observe the actual checks. Missing authorization or unsafe brief
   instructions must remain blocked, not executed as a workaround.
4. Confirm the resulting draft cites native root tool-call/result entries from
   this handoff. Independently compare its outcomes to those outputs, including
   every validation requirement, scope review and acceptance criterion. Tool
   success is not itself proof that the intended check ran.
5. Confirm no new `verified` record exists yet. Run
   `/forgeflow-review-verification` and decline the confirmation once; ensure
   the draft and historical evidence remain intact without a new verification.
6. If the draft and independent checks are correct, rerun that review command
   and confirm saving the exact workflow/commit. Inspect the new native record
   for its `handoffId`, `verificationDraftId`, actual evidence and final status.
   Failed/blocked drafts must not offer a successful save.

If the turn stops without a usable draft, inspect its actual session evidence.
`/forgeflow-cancel-verification` cancels only the local handoff and retains
history; it does not clean up files, workflows or resources. Do not retry an
uncertain save or manufacture missing evidence. Root/application/lane revisions,
controller journals and unrelated files must remain unchanged by this trial.

Report the workflow/commit, exact owning session, validation tool references,
draft and save record identifiers, declined-confirmation result, final status
and any failures. Do not push, redispatch, close resources or clean up as part
of this qualification.
