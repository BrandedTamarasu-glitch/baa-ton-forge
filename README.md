# Baa-ton Forge

A Pi extension that connects [Forgeflow](https://github.com/BrandedTamarasu-glitch/ForgeFlow)
planning and review to [Baa-ton](https://github.com/zachristmas/baa-ton) lane
orchestration in Herdr. Turn a structured brief into checked lane handoffs, track
workflow ownership, and record independent root verification before dependent
work proceeds.

**Baa-ton owns dispatch and completion receipts. The root verifies the work.**
The adapter adds preparation and record-keeping around that workflow; it does not
run a second agent orchestrator or spawn agents inside lanes.

## Start with a task, not a hand-written file

Give your project's registered Baa-ton root a task in plain language. Pi can
write the structured brief for you; you do not need a separate assistant to
generate it. For example:

```text
I want to add keyboard navigation to the settings page.

Use Forgeflow lean guidance to create .forgeflow/settings-navigation.json
with scope, acceptance criteria, validation, dependencies, and explicit
launch profiles using my authorized provider and model. Ask about unresolved
requirements. Use forgeflow_plan_lanes to preview it, then stop before dispatch.

Baa-ton owns lane dispatch and receipts. Root independently verifies completion.
Do not spawn nested agents inside lanes.
```

The adapter requires a structured brief; it does not itself convert prose into
one. You can also use Baa-ton directly without this adapter, in which case these
preparation and verification-record checks are not involved.

## What it does

- Previews task scopes, dependency stages, and exact proposed Baa-ton arguments.
- Requires explicit launch profiles, clean checkouts, and appropriate writer
  worktrees before preparing a lane.
- Checks that dependency verification matches the brief and that verified commits
  are integrated into both the root and the dependent checkout.
- Saves workflow mappings and root verification in the active Pi session branch.
- Recovers missing mappings from matching durable Baa-ton manifests.
- Shows task status, owning roots, completion receipts, and preparation blockers.

Install once and use it from each project's own Baa-ton root. The adapter's
development checkout does not need to control other projects.

## Install and preview

Requires Node.js 20+. Preview, local checks, and tests use Node's standard library
with no dependency installation. Live use additionally requires Git, Pi,
Herdr/Baa-ton, and the Forgeflow guidance/skills you intend to apply. The adapter
does not install those tools or manage provider login.

```sh
git clone https://github.com/BrandedTamarasu-glitch/baa-ton-forge.git
cd baa-ton-forge
node cli.js examples/brief.md
node cli.js --json examples/brief.md
npm test
```

For live use, add the absolute path to `extension.js` to the `extensions` array
in Pi's `~/.pi/agent/settings.json`, preserving existing entries:

```json
{
  "extensions": ["/absolute/path/to/baa-ton-forge/extension.js"]
}
```

Follow [SETUP.md](SETUP.md) to establish the actual project's Herdr root and keep
generated workflow state excluded from Git. Check local prerequisites with:

```sh
node /absolute/path/to/baa-ton-forge/check-install.js --project /path/to/project
```

In that project's Pi root, reload with `/reload`, then run:

```text
/forgeflow-plan-lanes /absolute/path/to/brief.md
```

Paths containing spaces are supported, with or without enclosing double quotes.
The command displays the preview without starting a model turn. Pi may retain
that displayed message in its local session history.
The bundled example intentionally omits worktrees and launch profiles; it is a
format demonstration, not a dispatch-ready task. Supply real project values
before preparation. Shell commands above also work through `rtk proxy` if you
use RTK; RTK is not an adapter dependency.

## Validated behavior and current limits

Local validation includes a dependent two-writer trial and a completed read-only
lane in a second project root, each with independently recorded verification.
The automated suite covers preparation guards, dependency integration, recovery,
status, installation checks and CLI behavior. Run `npm test` for the current suite.

This is an early local integration. It does not automatically create worktrees,
dispatch, merge, cancel workflows, or retire resources. Editing a brief changes
its hash; it does not cancel older workflows. Inspect existing plans before
creating replacements. Live harness availability and provider/model qualification
remain Baa-ton's responsibility. Run `herdr_doctor` in the owning root before
dispatch and investigate unresolved checks.

## Brief contract

See [the example](examples/brief.md). Supply JSON directly or exactly one
`forgeflow-lanes` fenced JSON block in a Markdown implementation brief.
Existing prose briefs need this explicit block added; the adapter does not infer
ownership, dependencies, or validation from prose. Include all execution-relevant
requirements in the block's objectives and acceptance criteria.

Required top-level fields: `version: 1`, `objective`, nonempty `acceptance`, and
`tasks`. Each task requires a unique `id`, `objective`, nonempty `files`, and
nonempty `checks`. Optional fields: `dependsOn`, `readOnly`, `agentKind`,
`worktreeCwd`, and `launchProfile` with `provider`, `model`, `thinking`, and
`auth: "subscription"`. Profiles are passed unchanged; runtime qualification
belongs to Baa-ton. Missing profiles are not guessed.
Profiles may be omitted for preview, but preparation requires an explicit
`launchProfile` for every lane, including read-only reviews. Add the intended
provider, model, thinking level and subscription auth to the task before planning;
dispatch cannot supply a missing profile later.

This version accepts the four kinds with launch adapters in the installed
Baa-ton: `pi`, `claude`, `codex`, and `opencode`. Baa-ton recognizes additional
Herdr kind names, but recognition alone does not qualify them for dispatch.

Scopes are repository-relative exact paths or directory prefixes ending in `/`.
Globs, traversal, absolute paths, and Git metadata scopes are rejected. Scope
comparison is lexical; aliases, symlinks, case folding, and omitted files still
need root review. Scope instructions do not provide filesystem isolation.

## Scheduling and boundaries

- One proposed workflow per task, with one lane in each workflow.
- Disjoint writers may share a stage. Overlapping writers are sequenced in an
  order compatible with explicit dependencies; cycles are rejected.
- Read-only tasks are final reviewers and wait for all writers. Pre-implementation
  research lanes are not supported in this version.
- Cross-workflow dependencies remain adapter metadata. The root must enforce
  `afterVerifiedAndIntegrated`; copying all plan arguments at once bypasses this
  ordering. No automatic dispatch is implemented.
- Writer worktree paths must be distinct. Missing writer worktrees produce
  `planArguments: null`; no copyable tool call is emitted. Read-only reviews may
  omit `worktreeCwd` to use the root's current checkout, with scope paths reviewed
  in that context. Before planning, the root must inspect real clean worktrees, ensure
  predecessor changes are integrated with authorization, and qualify the harness.
- File scope, acceptance criteria and validation instructions are included in the
  lane objective because Baa-ton's planning API has no ownership/check fields.
- Preview includes a source SHA-256. Regenerate after brief changes; it does not
  establish checkout freshness or validate the actual code state.

## Prepare and record a lane

The adapter exposes five native model-callable tools:

| Tool | Arguments | Result |
| --- | --- | --- |
| `forgeflow_status` | `filename` | Read-only task, workflow, verification and owning-root snapshot |
| `forgeflow_plan_lanes` | `filename` | Lane preview and saved brief hash |
| `forgeflow_prepare_lane` | `filename`, `taskId` | Checked handoff and saved preparation |
| `forgeflow_reconcile_lane` | `filename`, `taskId`, `workflowId` | Validated recovery of a missing mapping |
| `forgeflow_verify_lane` | `workflowId`, `commit`, `evidence` | Saved root verification |

When asking the Pi agent to perform these operations, name these tools. They
execute within the live extension; the four planning/recording tools persist session entries. Shell imports
only return calculations. Preview and prepare do not call Baa-ton or dispatch.
The slash commands below use the same implementations and remain available for
direct user input. Relative brief paths resolve against the Pi root checkout.

Before acting in an unfamiliar session, use `forgeflow_status` or:

```text
/forgeflow-status "/absolute/path/to/brief.md"
```

Status reads this checkout's Baa-ton manifest and the current Pi session branch.
It shows workflow IDs, owning sessions/panes/workspaces, completion receipts,
saved verification, dependencies, and preparation blockers. A receipt is never
reported as root verification. Changed brief hashes invalidate old records for
this view. Missing records are not evidence that a task has never run; missing
or ambiguous workflows require ledger inspection, not automatic redispatch.
The tool does not scan other projects or import another session's records.

Status does not save adapter records, dispatch, run tests, or change checkouts.
For tasks without a mapping or submission it evaluates the read-only preparation
checks, reporting the first failure. A passed check does not establish live
Baa-ton readiness. Saved verification is historical evidence, not a fresh check
of Git ancestry or tests. The slash command may leave a display message in Pi's
session history but does not start a model turn. If a new tool is absent after
`/reload`, restart Pi and resume the same owning root session.

For a new task, ask Pi to call `forgeflow_plan_lanes` and then
`forgeflow_prepare_lane` for the selected task. Review the handoff before asking
it to call `herdr_plan` and `herdr_dispatch`. Do not replan a completed trial.

In the registered Pi root, preview the real brief, then prepare one lane:

```text
/forgeflow-plan-lanes "/absolute/path/to/brief.md"
/forgeflow-prepare-lane "/absolute/path/to/brief.md" task-id
```

Prepare requires Herdr environment identity, the same brief hash as the last
preview in this session branch, clean committed checkouts, and for writers a
distinct linked worktree in the root repository. Both root and target must be
checkout roots. A read-only lane without `worktreeCwd` reviews the root checkout.
The target's paths are interpreted in that checkout, not relative to the brief.

The command displays exact tool arguments without starting a model turn. Ask the
root to check Baa-ton readiness and call `herdr_plan` with those arguments. Before
that matching call, the adapter rechecks the brief, Git state and pane identity.
It records submission before execution and captures a successful workflow ID
from the tool result. Dispatch still needs a separate explicit root action and
Baa-ton's live qualification. Environment presence alone does not attest a root.

Preview hashes, preparations and workflow mappings live as custom entries in
Pi's local session branch. They survive reload and resume of that branch. A new
session does not import them automatically. Run slash commands directly in Pi;
calling `prepareLane()` in a shell only calculates a result and does not register
a preparation or workflow mapping. Interrupted or failed submissions
remain blocked for ledger inspection rather than automatically retrying an
operation that may already have created a workflow. Independently issued native Baa-ton calls are not globally
intercepted: this is an adapter handoff guard, not an authorization boundary.

If a successful native plan has no mapping, recover it in the original Pi root:

```text
/forgeflow-reconcile-lane "/absolute/path/to/brief.md" task-id herdr-workflow-id
```

Recovery reads the durable manifest and requires exact agreement on root session,
pane/workspace, repository, target, objective, lane scope, profile and writer
parent binding. It rejects conflicting existing mappings and is idempotent.
It does not dispatch, mark verified, or change Baa-ton state. The recorded hash
associates the current matching brief; it does not assert a historical preparation
hash or reconstruct missing original checkout HEADs. Resuming another root session
or relocating the worktree requires a separate recovery design.

After completion, independently rerun checks and inspect the lane changes. Once
the reviewed commit is integrated into the root with authorization, record it:

```text
/forgeflow-verify-lane herdr-id FULL_COMMIT_HASH checks independently rerun and results
```

This requires matching durable completion receipts, a clean lane checkout at
that commit, and commit ancestry in the root. Evidence text is the root's
explicit attestation; the adapter does not run checks or validate prose claims.
Dependent preparation requires a verification record for the same brief and
requires the verified commit to be an ancestor of both root and target HEAD.
Use an ancestry-preserving integration for this version; squashed/rebased
equivalents are not inferred. A later lane checkout change invalidates verification
of an earlier lane HEAD. Prepare dependent worktrees after integrating changes.

The adapter never creates worktrees, calls Baa-ton tools itself, changes Baa-ton
ledgers, or merges code. Preserve each system's ledger and keep generated state
local. Use Git local exclusions for `.forgeflow/` and `.pi/herdr-orchestrator/`.

## License

MIT; see [LICENSE](LICENSE). Baa-ton and Forgeflow are separate projects with
their own installation instructions and licenses.
