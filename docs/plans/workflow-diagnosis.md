# Plan: guided workflow diagnosis

Status: implementation and local automated qualification complete, September 21,
2026: 162 tests pass and `git diff --check` passes. Saved diagnosis, native
inspection and command registration implemented. Updated Ubuntu/Windows CI has
not yet run; live owning-Pi qualification remains pending. Baseline: Forge main `2f83acd`, 147 local tests passing and
Ubuntu/Windows PR CI passing after canonical-path fixture corrections.

## Decision and user outcome

Build a read-only diagnosis feature for an explicitly selected Forge task. One
report should answer: what happened, what evidence supports that conclusion,
what is still unknown, and what supported next step the owning root can take.

The successful guided setup trial established the writer/integration/review path,
but required repeated manual inspection and copied instructions between Codex and
Pi. The main opportunity is to make those decisions understandable within Forge.
Do not add another execution engine or relax existing recovery guards.

| Candidate | Priority and reason |
| --- | --- |
| Guided workflow diagnosis | First: directly addresses repeated trial troubleshooting and reuses saved evidence. |
| Baa-ton release coordination | Parallel prerequisite tracking, not a new Forge feature. |
| Guided integration | Later: existing verification guidance/handoff already covers much of the path; approval belongs to Baa-ton. |
| Replacement-workflow lineage | Later: useful, but a distinct persistence and lifecycle change. |
| Cleanup or automatic recovery | Defer: uncertain historical effects require a separate design. |

Success means a user can diagnose the recorded trial scenarios in one explicit
inspection request per selected task, rather than several rounds of bespoke
instructions. This is a validation target, not a measured reduction claim.

## Existing code and the gap

- `status.js` already joins brief mappings, current session history, durable
  receipts, delivery state, verification and dependencies.
- `next-action.js` routes most failed/unknown workflows to generic
  `inspect-workflow`. Keep its precedence for ownership and durable completion.
- `continuation.js` renders advice; `continuation-readiness.js` probes only
  prepare/plan/dispatch steps, not failed dispatch recovery.
- `dispatch-once.js` has useful intent/attempt/result records, but its audit
  command selects only the latest intent in the current branch.
- `dispatch-retry.js` already contains a strict, read-only `checkStartupRetry()`.
  Reuse that eligibility logic; do not duplicate it in a second policy engine.
- `preflight.js` combines root/source checks and throws on the first failure.
  Diagnosis needs independently reported facts without weakening those gates.

## Version-one interface and boundaries

Add `forgeflow_diagnose_lane({filename, taskId, inspectNative?: boolean})` and a
matching `/forgeflow-diagnose-lane "path/to/brief.json" task-id` command.
The command defaults to saved/local evidence. A documented `--live` option
explicitly requests bounded native inspection. Keep existing status/continue
commands free of newly implicit native calls.

Require an unambiguous current brief-backed task mapping. Never default to the
latest unrelated probe. Missing, foreign or multiple mappings produce an
explanation without recovery eligibility. Native-only probes without Forge
mapping are explicitly unsupported by this v1 interface; never invent a mapping.

Reports contain version, selected identity, observed time, brief/manifest
fingerprints, diagnosis code, facts with provenance, gaps, one next step, required
checks, and a stop reason. Include `executed: false` and
`authorization: not-assessed`. A fact distinguishes present, absent-in-inspected-
source, conflicting, unavailable and not-inspected evidence. File absence is not
proof of no execution or of provider-side session deletion.

Do not append custom workflow/audit/verification entries during diagnosis. Normal
tool-result/display history is expected. Do not invoke model turns, plan,
dispatch, resume, send input, create workspaces, rewrite ledgers or run checks
named in the task brief. Baa-ton retains execution and approval authority.

### Diagnostic cases

| Evidence | Report and next step |
| --- | --- |
| Wrong owner, ambiguous mapping or unreadable ledger | Ownership/evidence blocker; identify the required root or missing evidence. No live child probes or executable recovery command. |
| No dispatch attempt in inspected branch | Say exactly that; do not claim the workflow never ran. Use existing planned-readiness checks before any dispatch recommendation. |
| Saved `agent_not_ready`, no assignment markers | Startup recovery candidate. Live eligibility must use the existing strict checker and original consumed intent. |
| Same unprompted child/profile/root/attestation passes live checker | Display the existing startup-retry command as eligible-at-inspection, with fresh guards and native confirmation still required. |
| Assignment attempted/submitted, no durable receipt | Submission unresolved. Never recommend redispatch, startup retry or replacement automatically. |
| Agent absent but pane exists | Report pane existence and foreground shell separately; `agent_not_found` does not mean pane gone. |
| Pane gone and saved session not established available | Recovery evidence incomplete. Direct the root to supported native session inspection; do not claim resumability or issue execute=true. |
| Source binding missing or changed | Name the recorded and observed source IDs and effect on preparation/dispatch. Do not recreate or rebind automatically. |
| Durable receipt stored, delivery pending | Separate completion from notification. Route to existing independent verification guidance; no resend needed to verify. |
| Verification already recorded | Show historical verified commit/time, not freshly rerun validation. Preserve unrelated historical faults visibly. |
| Evidence changes during collection | Mark snapshot stale; suppress positive recovery eligibility and request a fresh inspection. |

## Implementation phases

### 1. Saved-evidence diagnosis (first reviewable PR)

Add a small pure `workflow-diagnosis.js` projection and renderer. Accept existing
status/mapping facts and filter all dispatch intents/results by selected
workflow, task, brief hash and owner. Cover the cases above that saved evidence
can establish; explicitly label unavailable live facts.

Add the native tool/command registration in `extension.js`. Add an optional
explicit workflow selector to `/forgeflow-dispatch-audit` while retaining its
current no-argument behavior. Let continuation/status point to diagnosis when
appropriate; do not silently change those commands into live inspections.

Deliverable: a useful local report for an uncertain submitted reviewer, a
receipt awaiting verification, and a known startup failure. Local classification
must not infer a currently missing source or live shell state from old records.

### 2. Bounded native inspection (second reviewable PR)

Add `workflow-diagnosis-inspection.js` with explicit read-only ports and one
overall deadline (proposed 15 seconds). Authenticate the current native root
before inspecting its selected child. Query only required facts: root identity,
selected agent/pane/process state, and source inventory when relevant. No polling
loop, arbitrary project scan, recursive Claude transcript search or automatic
doctor reconciliation.

Reuse root/session proof and source-binding helpers from preflight. Extract only
the small read-only collectors needed; keep preparation behavior and its failure
conditions unchanged. Represent structured errors at collection boundaries,
rather than classifying by broad matches against rendered error strings.

Expose `checkStartupRetry()` through this read-only path, choosing the original
consumed intent for the selected workflow. Share its predicates and preserve all
execution-time rechecks. If necessary, extract one inspection helper with typed
blockers; do not weaken or fork retry eligibility logic. A missing tool or
unsupported schema is a capability gap, never permission to use a shell import.

Recheck manifest/brief/mapping and critical proof identity after collection. Bound
all JSON/proof reads, honor cancellation and reject mismatched pane/session data.
Keep missing source, dirty checkout and partial probe results distinct from
ownership failure so the report explains observed facts even when action is
blocked. The ownership gate still controls whether live inspection is allowed.

Native resume guidance is limited to identifying missing availability evidence
and recommending the root's supported read-only preview. Exact resume execution
and provider transcript-discovery contracts are deferred.

### 3. Qualification and documentation (release gate)

Replay synthetic fixtures modeled on the recorded trial, then run one explicitly
authorized read-only walkthrough in the owning Pi root. Record the report and
before/after resource/ledger state. Do not mutate or retry historical failures
to demonstrate the feature. Document the difference between diagnosis,
eligibility-at-inspection, approval and execution.

Publish CLI examples as single-line commands with paths containing spaces. Add
schema and troubleshooting documentation and extend the existing Ubuntu/Windows
CI job. Keep plan/docs distinct from claims of completed qualification.

## Validation and acceptance

- Each diagnostic case above has a table-driven fixture, including unknown
  statuses, malformed records and contradictory evidence.
- Two workflows plus a newer unrelated probe prove selection never drifts.
- Any assignment marker or unknown result suppresses retry guidance even when
  terminal output/transcripts are absent.
- A stored receipt overrides idle/gone telemetry for completion reporting, but
  cannot bypass owning-root checks or manufacture root verification.
- Existing startup retry positive and negative cases run through both diagnosis
  and execution entry points; changed scope/profile/nonce/session remains blocked.
- Mock ports reject every mutation; compare manifest, session custom records,
  Git HEAD/index/status and resource inventories before/after diagnosis.
- Cancellation, timeout, evidence drift and partial responses produce useful
  incomplete reports, never positive eligibility.
- Canonical root/target paths and paths containing spaces work on Ubuntu and
  Windows. Do not lower-case arbitrary paths as an ownership shortcut.
- Run focused diagnosis/retry/status tests, then full `npm test` and both CI jobs.
- Live qualification proves diagnosis causes zero child launches, assignment
  submissions, resource creation or workflow writes. It does not prove a recovery
  would succeed without execution-time validation.

## Accessibility and usability checklist

- State, selected workflow and one next step come first; facts/gaps follow.
- Use text labels, not color or icons alone. Keep output readable in narrow
  terminals and by screen readers.
- Label saved versus live evidence and include observation times.
- Show concise summaries plus bounded detail; mark truncation and identify the
  exact evidence reference. Avoid dumping unrelated environment values or logs.
- Keep commands separate from explanations and on one copyable line. Never label
  a model-callable tool as a slash command.
- Preserve all other blockers visibly; one recommendation does not erase them.

## Dependencies, risks and deferred work

The read-only milestone can ship independently of new Baa-ton execution changes.
At planning time, Baa-ton [PR #13](https://github.com/zachristmas/baa-ton/pull/13)
is open; [PR #5](https://github.com/zachristmas/baa-ton/pull/5) is closed without a
merge commit. Do not assume either patch is available in upstream builds. The
installed trial copy contains local fixes. Verify actual supported runtime
capabilities before live qualification; version strings or files on disk alone
do not prove what an already-running extension loaded.

The largest risk is making diagnosis a second recovery authority. Mitigate it
with pure projections, shared eligibility predicates, explicit native inspection,
no execute option, and the existing confirmation/revalidation path for any later
action. Unknown states stay unknown. Global doctor failures remain separate from
the selected workflow and never gain an automatic exception.

Defer automated recovery/resume, workflow replacement or supersession, source
recreation, commit/integration helpers, resource cleanup, multi-root dashboards,
notification redelivery and event-driven monitoring. Reassess those after this
feature demonstrably reduces manual diagnosis in one native walkthrough.
