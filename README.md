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
- Resolves named Baa-ton task profiles into exact launch settings.
- Requires resolved launch profiles, clean application/lane checkouts, and appropriate writer
  worktrees before preparing a lane.
- Automatically creates or reuses a native application source workspace for
  explicit `repoCwd` tasks, with audited creation and duplicate prevention.
- Checks that dependency verification matches the brief and that verified commits
  are integrated into their declared repository and any dependent checkout in that repository.
- Saves workflow mappings and root verification in the active Pi session branch.
- Recovers missing mappings from matching durable Baa-ton manifests.
- Shows task status, owning roots, completion receipts, and preparation blockers.
- Previews the next root step and checks local/native readiness without mutation.
- Hands off one user-confirmed dispatch to native Baa-ton, with fresh readiness
  checks and a session audit; no automatic retry or next-lane progression.

Install once and use it from each project's own Baa-ton root. The adapter's
development checkout does not need to control other projects.

## Install and preview

Requires Node.js 20+. Preview, local checks, and tests use Node's standard library
with no dependency installation. Explicit repository previews also require Git and existing
checkouts to resolve repository identity. Live use additionally requires Pi,
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

## Update an existing installation

In a clean clone of this repository:

```sh
git pull --ff-only
npm test
```

There is no compilation or dependency-install step for this adapter. Keep Pi's
registered `extension.js` path pointed at that checkout, then run `/reload` in
each project root. If tools remain stale, restart Pi in the same Herdr pane and
resume the same session. A new pane or workspace needs controller ownership
recovery; reopening the transcript alone does not restore that identity.
Launch interactive Pi directly (`pi --session <id>`), not through `rtk proxy`:
the tested RTK wrapper pipes stdout, which makes Pi choose print-and-exit mode.
Do not overwrite local modifications if the pull refuses to fast-forward.

Named-profile support requires Baa-ton's project profile configuration:
`.baa-ton/config.json` with version 1 and exact settings for the selected names.
Update Baa-ton separately using its `baa-ton-update` skill, and use
`baa-ton-configure` to select worker assignments. Updating this adapter does not
update Baa-ton, replace configuration, migrate active workflows, or change the
current root model. Existing explicit-profile briefs remain supported.

Provider qualification is also separate. Named profiles do not remove provider
restrictions in the installed Baa-ton launch adapter. A local Baa-ton patch that
enables additional Pi OAuth providers is not distributed by this repository;
check the installed Baa-ton version before expecting a new provider to dispatch.

## Validated behavior and current limits

Local validation includes a dependent two-writer trial and a completed read-only
lane in a second project root, each with independently recorded verification.
An additional live read-only trial exercised the configured native Claude Code
review profile (`claude / claude-code / claude-sonnet-5 / high / subscription`)
after failed-submission recovery and an audited Baa-ton root migration. The lane
completed with a durable receipt; the root checked the findings against the
README, corrected an unsafe reset-command recommendation, confirmed unchanged
checkout/HEAD/README content, and saved native verification. This qualifies that
tested profile and workflow, not every configured model or included billing.
The automated suite covers preparation guards, dependency integration, recovery,
status, installation checks and CLI behavior. Run `npm test` for the current suite.

A [Linux nested-repository trial](docs/linux-nested-repository-trial.md) also
completed writer, application integration, dependent read-only review, and native
root verification while leaving the controller checkout unchanged. Its evidence
preserves an unexplained earlier integration transition accepted by the user;
that acceptance is not retroactive proof of who performed the transition.
The trial used local Baa-ton recovery/approval patches described in the report.
Zach subsequently confirmed that Windows testing resolved the nested-repository
problem in [issue #1](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/issues/1),
as reported by the project owner. This confirmation is specific to that issue;
it does not qualify every Windows workflow or cross-application live dependency.

The subsequent [automatic source-workspace trial](docs/linux-nested-repository-trial.md#automatic-source-workspace-qualification)
passed live on Linux: read-only preparation rejected the missing source without
creating resources; automatic preparation created one shell-only workspace;
repeat preparation reused it with an unchanged single-attempt audit; and actual
`herdr_plan` succeeded with a saved mapping and manifest snapshot. That initial
milestone stopped before dispatch. The subsequent
[single-dispatch qualification](docs/linux-nested-repository-trial.md#single-dispatch-and-independent-verification)
completed the same workflow through native dispatch, delivered completion and
independent root verification at `fcdb053323c444002fc4641e4919c2628ccef1a8`.
Startup evidence matched `pi / openai-codex / gpt-5.6-luna / low / subscription`.
The worker left an uncommitted change; the root separately committed it using
normal hooks and integrated it through the guarded fast-forward path. Dispatch
did not automatically commit, integrate or verify the result.

Linux and Windows CI also pass the portable source-workspace
tests, which use a fixture Herdr transport. The separate native Windows
automatic-binding test for [issue #5](https://github.com/BrandedTamarasu-glitch/baa-ton-forge/issues/5)
remains outstanding.

This is an early local integration. Dispatch requires an explicit user-confirmed
handoff or a separately authorized native Baa-ton call. It does not automatically
create worktrees, merge, cancel workflows, or retire resources. Editing a brief changes
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
`worktreeCwd`, `repoCwd`, `taskProfile`, and `launchProfile` with `provider`, `model`, `thinking`, and
`auth: "subscription"`. Profiles are passed unchanged; runtime qualification
belongs to Baa-ton. Missing profiles are not guessed.
Profiles may be omitted for preview, but preparation requires an explicit
`launchProfile` for every lane, including read-only reviews, either directly or
resolved from a named `taskProfile`. Add the intended
provider, model, thinking level and subscription auth to the task before planning;
dispatch cannot supply a missing profile later.

## One controller, multiple application repositories

An optional task-level `repoCwd` names the absolute **integration checkout** for
that task. `worktreeCwd` names its separate, pre-existing linked worker checkout.
The controller can stay in the parent workspace, with one brief, session history,
profile configuration and Baa-ton manifest. File scopes and commands are relative
to the worker checkout, not prefixed with the application's workspace path.

For Zach's Windows layout, a task can declare:

```json
{
  "id": "application-fix",
  "objective": "Apply the scoped application fix",
  "repoCwd": "C:\\tc\\_SAVE\\globalshop",
  "worktreeCwd": "C:\\worktrees\\globalshop-fix",
  "taskProfile": "implementation",
  "files": ["src/"],
  "checks": ["Run the application's relevant tests"]
}
```

Use native absolute paths for the machine running Pi. Without `repoCwd`, existing
single-repository behavior is unchanged. With `repoCwd`, **both writers and
read-only reviewers need a distinct linked `worktreeCwd`**; preview withholds plan
arguments until it is assigned. The integration checkout may itself be a linked
worktree on the intended integration branch. Forge never creates worktrees or
merges commits. Keep nested repositories and generated state intentionally
excluded from the parent repository where appropriate; the application integration
checkout and lane worktree must remain clean.

With explicit `repoCwd`, the controller may contain unrelated staged, unstaged
or untracked edits. Preparation, planning revalidation, reconciliation, readiness
and verification do not require that separate controller working tree to be clean
and never stash, reset or commit its files. The application integration checkout
and lane worktree must still be clean. If `repoCwd` resolves to the controller
itself (including an alias), that checkout remains subject to application
cleanliness requirements. Without `repoCwd`, the original clean-root rule applies.
Saved controller HEAD, canonical checkout identity, brief/profile hashes and
native ownership checks still apply; a HEAD change requires fresh preparation.

Preparation validates the controller, integration checkout and worker, including
canonical Git common-directory identity. Repository/worker branches and HEADs
are captured and revalidated before planning. Verification requires the reviewed
commit at the worker HEAD, unchanged mapped branches and integration into
`repoCwd`, rather than the independent controller repository. A separate root in
each application is not required by Forge.

Explicit repository previews read Git metadata and bind repository identities
into the preview hash. File-scope conflicts are compared within each repository;
symlinks and different linked checkouts of the same repository share an identity.
Read-only tasks still follow all writers. A cross-repository dependency requires
its verification record and its commit still integrated in its own declared
checkout. Same-repository dependencies additionally require ancestry in the
current integration and worker checkouts. This does not prove that artifacts,
packages or services have been published between applications; include those
requirements in acceptance criteria and root validation.

`repoCwd` is adapter metadata, not a new Baa-ton argument. Baa-ton receives the
existing `worktreeCwd`; native reconciliation checks its repository-source
binding separately from the controller session/pane/workspace identity.
**Baa-ton/Herdr must recognize the application repository's source workspace and
worktree.** Native preparation now checks that binding and can establish a missing
source workspace for explicit `repoCwd` tasks, as described below. Preview alone
does not establish readiness. Never substitute the parent controller workspace ID
for the application's native source ID.

Automated tests cover nested repositories, aliases, integration, dependencies,
branch drift and native-manifest reconciliation. The source-workspace regression
runs on Linux and Windows CI with a fixture Herdr transport. Linux live trials
and Zach's Windows confirmation for issue #1 are described above; the new
automatic source-binding path still needs its own native Windows qualification.

## Shared Baa-ton worker profiles

Configure model assignments once per project in `.baa-ton/config.json` using
Baa-ton's `baa-ton-configure` skill. Brief tasks can then use
`"taskProfile": "quick"` or `"taskProfile": "review"` instead of repeating
`launchProfile`. See [the named-profile example](examples/named-profiles.md).

The supported Baa-ton v1 names are `planning`, `quick`, `balanced`,
`implementation`, `sustained`, `review`, and `deep-review`. Resolution uses the
owning Pi root's configuration, not the brief's directory or a writer worktree's
copy. For CLI previews, run from the project root using the absolute adapter CLI
path. The adapter uses only data from the config and does not execute Baa-ton code.

Each selected config entry must have an exact `launchProfile`. Its `agentKind`
is used unless absent, in which case the task's choice or the existing `pi`
default applies. Conflicting task/config harness choices are rejected. A task
cannot specify both `taskProfile` and `launchProfile`. Read-only settings in
the config and the built-in `planning`, `review`, and `deep-review` profiles
cannot be weakened by the brief. This does not add a pre-implementation planning
stage: the adapter still schedules all read-only tasks after writers.

The preview shows the selected profile and emits resolved explicit arguments;
it does not forward `taskProfile` to Baa-ton for a second resolution. For named
profiles, `sourceSha256` binds the brief bytes, canonical configuration path and
entire configuration file hash. `briefSha256` retains the brief-only hash.
Even an unrelated config edit requires a new preview and invalidates old
verification for dependency preparation. Finish an active brief before changing
its profile configuration; changing config does not cancel an existing workflow.
Explicit-profile briefs retain their existing brief-only hashes and behavior.

Profile configuration selects credentials by auth mode, not billing entitlement.
`auth: "subscription"` currently means OAuth; it does not guarantee included
plan usage. Model availability, billing authorization and startup qualification
must still be checked before dispatch.

## Harnesses and file scopes

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

The adapter exposes six native model-callable tools:

| Tool | Arguments | Result |
| --- | --- | --- |
| `forgeflow_status` | `filename` | Read-only task, workflow, verification and owning-root snapshot |
| `forgeflow_continue` | `filename` | Preview one next root step, required checks and stop reason; no execution |
| `forgeflow_check_readiness` | `filename` | Read-only local/native prerequisite checks; no repair or dispatch |
| `forgeflow_plan_lanes` | `filename` | Lane preview and saved brief hash |
| `forgeflow_prepare_lane` | `filename`, `taskId`, optional `createSourceWorkspace` | Checked handoff and saved preparation; automatic source setup by default for explicit `repoCwd` |
| `forgeflow_reconcile_lane` | `filename`, `taskId`, `workflowId` | Validated recovery of a missing mapping |
| `forgeflow_recover_submission` | `filename`, `taskId` | Append evidence for a proven pre-persistence root or missing-source-workspace rejection, allowing fresh preparation |
| `forgeflow_verify_lane` | `workflowId`, `commit`, `evidence` | Saved root verification |

When asking the Pi agent to perform these operations, name these tools. They
execute within the live extension; the planning/recording tools persist session entries. Shell imports
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

Each task now includes a `nextAction` with a code, category, explanation and
optional tool suggestion. The report also suggests one next action across the
brief. Categories distinguish `ready-for-root`, `waiting`, `blocked`,
`awaiting-verification`, `awaiting-answer`, `awaiting-approval` and `complete`.
For example, all durable receipts with notification delivery still pending
produce **Independently verify completion**: the root need not wait for another
notification. A receipt alone never releases a dependent task.

Advice uses saved and local evidence only. `authorization: "not-assessed"` and
`nativeReadiness: "not-checked"` are explicit in the report. A mapped, planned
workflow suggests checking authorization and readiness before dispatch; it does
not dispatch. Only recorded parent requests produce approval/question advice.
Old preparations, unresolved submissions and changed ownership remain blockers.
Preparing a lane can create a source workspace; use `createSourceWorkspace:false`
when resource creation is not authorized. Status itself creates nothing.

Status does not save adapter records, dispatch, run tests, or change checkouts.
For tasks without a mapping or submission it evaluates the read-only preparation
checks, reporting the first failure. A passed check does not establish live
Baa-ton readiness. Saved verification is historical evidence, not a fresh check
of Git ancestry or tests. The slash command may leave a display message in Pi's
session history but does not start a model turn. If a new tool is absent after
`/reload`, restart Pi in the same Herdr pane and resume the same owning root session.

### Preview root continuation

Use native `forgeflow_continue` with `filename`, or enter:

```text
/forgeflow-continue "/absolute/path/to/brief.md"
```

This first version is **preview only**. It reuses status evidence to propose one
immediate root step, explain required checks and state why execution stops. It
keeps other tasks' blockers and parent requests visible. It does not forecast a
chain of future steps whose prerequisites have not yet been checked.

The report includes `mode: "continuation-preview"`, `executionSupported: false`,
`executed: false`, the brief snapshot, root/session identity, proposed step and
stop reason. No execution parameter is accepted. It invokes no suggested tools,
saves no workflow records, creates no resources and starts no model turn from the
slash command. Like status, it reads local evidence without establishing live
native readiness or authorization. The slash command can save its display in Pi
history. Baa-ton retains planning/dispatch ownership, and independent root
verification remains required. Take a fresh snapshot after any external action.

### Check continuation readiness

After inspecting the preview, use native `forgeflow_check_readiness` with
`filename`, or:

```text
/forgeflow-check-readiness "/absolute/path/to/brief.md"
```

For a selected prepare, plan or dispatch-readiness step, this checks clean
application/lane checkouts (and the controller when no separate `repoCwd` is
declared), dependency integration and the exact configured profile, then probes
Herdr root/session identity, source-workspace binding and target availability.
It never creates a missing source workspace. Planned lanes must still match
their original saved preparation and native binding; changed evidence blocks.
Other steps, including wrong-session recovery and completion verification, are
reported without native probes and must be resolved separately.

`readiness.state` is `passed`, `blocked` or `not-checked`, with check descriptions
and blockers. A pass is a point-in-time prerequisite result, **not dispatch
authorization or provider/model runtime qualification**. No login, model request,
repair, preparation record, planning, dispatch or automatic retry occurs.
Concurrent detected changes to local evidence or the manifest stop the check;
the inspection is not a lock. Baa-ton must revalidate before actual dispatch.

### Dispatch one existing workflow

After checking readiness, enter this command directly in the owning,
idle Pi root:

```text
/forgeflow-dispatch-once "/absolute/path/to/brief.md"
```

This is a **mutating, opt-in handoff**, separate from preview and readiness.
It requires native `herdr_dispatch` and an interactive confirmation showing the
exact workflow, task and profile. Cancelling queues nothing. After confirmation,
Forge rechecks readiness, saves a session intent and starts one Pi model turn to
request the exact native `herdr_dispatch` call. That turn consumes model usage.
Pi does not expose direct cross-extension tool execution; Forge neither imports
Baa-ton internals nor substitutes shell commands. Baa-ton retains its own
approval and startup qualification checks, which may prompt separately.

The tool-call guard checks readiness again and saves an attempt before allowing
the native call. It rejects different arguments, restart/confirmation overrides,
other tools during the handoff, and repeated attempts. It records the native
result as dispatch-reported, cancelled, approval-required, error or unknown;
none means completion or verification. Further tools are blocked for that turn,
and no next lane, integration or cleanup is authorized.

Use `/forgeflow-dispatch-audit` to inspect the latest intent, attempt and result
in the current session branch without starting a model turn. Resume the owning
session to retain these guards. A crash, missing result, failed readiness check
or send failure remains unresolved and is not automatically retried or reset.
Inspect native durable state before recovery; this version deliberately provides
no retry/recovery command. These are orchestration guards, not a filesystem or
process sandbox. Independent completion verification remains a later root step.

The [Linux live trial](docs/linux-nested-repository-trial.md#single-dispatch-and-independent-verification)
exercised confirmation, one native dispatch, audit recording, receipt delivery,
and a separate root verification phase. If a worker leaves uncommitted edits,
inspect them and obtain authorization for commit/integration before saving native
verification. A completion receipt does not guarantee a clean or committed result.

### Native preparation preflight

The native `forgeflow_prepare_lane` tool and slash command perform native
Herdr checks before saving a handoff. They require a version-2 Baa-ton controller
registration for this checkout and pane/workspace, a live Pi agent whose native
session matches the current session, and (for `worktreeCwd` tasks) an unoccupied
registered worktree with a source workspace present in native inventory. A
read-only task in the controller checkout does not require a separate source
workspace. The check reads the existing controller config and never bootstraps
or replaces a controller root or substitutes identities.

For an explicit `repoCwd` task, preparation automatically establishes a missing
application source workspace. It first validates root/session ownership, the
clean declared repository, and the distinct unoccupied linked target. It reuses
a valid existing native binding. If the source is absent, it calls the supported
`herdr workspace create --cwd <repoCwd> --label ... --no-focus` path, then checks
the returned ID against fresh worktree and workspace inventories. This opens a
shell workspace, not another agent or controller root; it does not change focus,
create a Git worktree, grant repository trust, or dispatch work. Native source
checkout must equal `repoCwd` before automatic creation is allowed.

Use `createSourceWorkspace: false` on the native preparation tool to require
read-only native checks with no resource creation. The slash command uses the
automatic default. Tasks without explicit `repoCwd` retain read-only preflight.

Creation is serialized across cooperating Forge roots/worktrees using a lock in
the application's common Git directory. Intent and verified binding evidence,
including the owning root/session, are saved under
`<git-common-dir>/forgeflow-source-workspaces/`, outside versioned files. Forge
rechecks native inventory under the lock and records intent before creation.
Lost responses, malformed output, or a crash never trigger blind creation retries.
An existing valid native binding can still be reused; an unresolved creation with
no binding blocks and identifies its audit file. A leftover crash lock requires
inspection; do not delete it while setup may still be running. Forge neither
closes source workspaces nor edits historical Baa-ton bindings. The lock cannot
serialize unrelated manual Herdr commands; inconsistent native inventory fails
closed rather than being repaired automatically.

Root/session/source bindings are saved with the handoff and checked again before
`herdr_plan` is allowed through. A failed recheck writes no `planning` record.
If a valid binding changed, prepare again. Older handoffs must be prepared again
if they contain no native preflight evidence. This update also normalizes a
short-path or aliased controller cwd in repository preview fingerprints; rerun
preview and preparation for unsubmitted tasks from such aliases. Fingerprints
for roots already using canonical paths and historical records are preserved.
Missing or stale registrations
require the owning root or Baa-ton's audited recovery. Source setup happens only
during preparation; the submission recheck never creates resources. Preparation does
not establish model entitlement, runtime adapter qualification, full doctor health,
or authorization to dispatch. Baa-ton still validates the actual plan and launch.

The automatic binding tests exercise real nested Git checkouts with a fixture
Herdr transport. See the [native Windows regression procedure](docs/windows-source-workspace-trial.md)
for the separate end-to-end check through actual `herdr_plan`. A passing portable
CI test is not live Windows qualification.

Preview and status remain read-only/local: a passed status preparation check does
not run this native preflight or establish live readiness. Saved owner identity
includes the Pi session path so status can flag a different session earlier.

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
distinct linked worktree in the declared repository (the root by default). Controller, integration checkout and worker must be
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

### A rejected plan with no workflow

If `herdr_plan` rejected a prepared task with either exact error:

- `Only the verified controller-mapped root may create or update the parent goal or queue.`
- `Herdr worktree list response is missing source_workspace_id.`

Ask the **same Pi session branch and pane** to call the native
`forgeflow_recover_submission` with `filename` and `taskId`.
It reads the saved assistant tool call, unique failed native result, and original
planning entry. No matching workflow or saved mapping may exist.

New submissions save a manifest fingerprint immediately before the native plan:
existence, raw SHA-256, canonical state SHA-256, capture time, and owning-session
identity. Recovery compares that saved baseline directly, including all workflows,
goals, queues and unknown fields. Only `status` and `lastResponseAt` in the
identity-matched top-level root `sessionLog` are excluded from the state hash.
Changes to other root logs or supervisor/goal state remain blocked. A previously
absent manifest must still be absent. The snapshot is evidence of a read at one
point in time, not a lock or a grant of planning authority.

Legacy submissions without a fingerprint must either have a manifest predating
submission or meet the narrowly supported native-observation baseline below.

Use `/forgeflow-status` to confirm the session file before recovery. A new
session in the correct project and pane still lacks the original planning
records. Use `/resume` to select the original session; do not create another
preview or plan to replace its missing history.

This narrow path appends a `submission-no-effect` record with evidence hashes.
It preserves the failed attempt and only releases that attempt's retry guard.
It does not register a root or claim that a workflow completed. Missing results,
different errors, unproven manifest changes, or ambiguous effects remain blocked; an
existing durable workflow must use `forgeflow_reconcile_lane` instead.

Baa-ton writes root activity into its manifest when a turn starts or ends, so
file timestamps alone can reject an otherwise unchanged workflow inventory.
For a newer manifest containing **only** `version`, `workflows`, and this owning
Pi session's `sessionLog`, recovery can compare every complete workflow object
against its latest successful native `herdr_observe` result saved before the
failed submission. Each observation must have a unique matching native call and
result. The inventory must also match the workflow IDs in earlier successful
native plan/observe history. Added, removed, or changed workflows, missing
observations, extra manifest state (including goals/queues), and foreign root
activity remain blocked. Recovery records the proof mode and observation hashes;
it never claims that a newer file has old timestamps.

For a missing source workspace, the saved plan must contain an absolute
`worktreeCwd`. Recover the failed submission before changing the manifest.
Then inspect native workspace inventory and restore the application source
workspace through the authorized Herdr flow. Do not invent a workspace ID,
rewrite historical bindings, or create an application agent/root. Confirm the
new native source binding, then run preview and prepare again. Recovery itself
does not create a workspace or establish live readiness.

For a stale controller registration, run submission recovery **before** any
root migration or other manifest mutation. Then use Baa-ton's native
`herdr_recover_root` preview and explicitly authorized application if available
in your installed version. This adapter does not implement root migration.
After root recovery, run doctor, preview and prepare again. Do not change the
brief hash, remove session records, or bootstrap with reset to evade a blocker.
Historical verification stays historical; moving a root does not adopt another
session's workflow verification.

After completion, independently rerun checks and inspect the lane changes. Once
the reviewed commit is integrated into its designated checkout with authorization, record it:

```text
/forgeflow-verify-lane herdr-id FULL_COMMIT_HASH checks independently rerun and results
```

This requires matching durable completion receipts, a clean lane checkout at
that commit, and commit ancestry in the designated integration checkout. Evidence text is the root's
explicit attestation; the adapter does not run checks or validate prose claims.
Dependent preparation requires a verification record for the same brief and
requires integration in the dependency repository, plus the current integration
and worker HEADs when they share that repository.
Use an ancestry-preserving integration for this version; squashed/rebased
equivalents are not inferred. A later lane checkout change invalidates verification
of an earlier lane HEAD. Prepare dependent worktrees after integrating changes.

The adapter never creates worktrees, calls Baa-ton tools itself, changes Baa-ton
ledgers, or merges code. Preserve each system's ledger and keep generated state
local. Use Git local exclusions for `.forgeflow/` and `.pi/herdr-orchestrator/`.

## License

MIT; see [LICENSE](LICENSE). Baa-ton and Forgeflow are separate projects with
their own installation instructions and licenses.
