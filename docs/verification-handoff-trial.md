# Native verification handoff trial

The [reported Linux run](linux-nested-repository-trial.md#native-verification-handoff)
demonstrated fresh root validation, evidence-linked drafting, a separate review
display and a subsequent saved verification on 2026-09-18. That report identifies
the confirmation/provenance details and negative paths not shown in the supplied
transcript; it does not claim every step below has been live-qualified.

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
7. Run `/forgeflow-verification-audit actual-workflow-id` and the equivalent
   native `forgeflow_verification_audit` tool. Expect the same read-only report:
   handoff/draft IDs, actual tool-call/result references and hashes, declined then
   confirmed decisions, one save attempt and the linked verification entry. No
   validation command, new confirmation or verification save should occur. The
   slash command displays a report with no model turn; workflow records stay
   unchanged. Older handoffs may label confirmation as inferred from a legacy
   save attempt; do not claim an explicit decision record where none exists.

If the turn stops without a usable draft, inspect its actual session evidence.
`/forgeflow-cancel-verification` cancels only the local handoff and retains
history; it does not clean up files, workflows or resources. Do not retry an
uncertain save or manufacture missing evidence. Root/application/lane revisions,
controller journals and unrelated files must remain unchanged by this trial.

Report the workflow/commit, exact owning session, validation tool references,
draft and save record identifiers, declined-confirmation result, final status
and any failures. Do not push, redispatch, close resources or clean up as part
of this qualification.

For an existing completed trial, step 7 can run independently in its owning
session without repeating validation. Report any missing provenance as a gap;
do not create another verification merely to make the audit appear complete.
New-branch absence must be described as unavailable session history, not proof
that a workflow was never verified. Automated regressions cover incomplete and
contradictory evidence; do not corrupt live records to reproduce them.
