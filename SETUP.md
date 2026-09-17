# Use the adapter in another project

Install the adapter once; each project uses its own checkout, Pi session and
Baa-ton root. The adapter repository is its development home, not the controller
for every project. Do not copy another project's workflow ledger or session.

## 1. Check the shared installation

Requirements: Node 20+, Git, Pi, Herdr/Baa-ton and the installed Forgeflow lean
skills. Keep the adapter checkout at a stable path. In Pi's user settings
(`~/.pi/agent/settings.json`, or your configured agent directory), preserve the
existing settings and add the absolute adapter `extension.js` path to
`extensions` if absent. Preserve Baa-ton and Forgeflow extension/skill entries.
The current machine already has these global registrations.

Global registration makes the extension available to Pi in other projects.
Alternatively, register its absolute path in the project's `.pi/settings.json`.
Pi resolves relative entries there against `.pi/`, not the project root. Avoid
duplicate registrations. Project trust and runtime loading still apply.

From any directory, run (replace both paths as needed):

```sh
rtk proxy node "/path/to/baa-ton forge/check-install.js" --project "/path/to/project"
```

Use `--json` for structured output or `--agent-dir PATH` for a custom Pi agent
directory. Exit 1 means local checks failed; exit 2 means invalid arguments.
Warnings do not fail the command. A successful exit means only the checks listed
passed, not that a controller is ready. The checker reads Git and settings; it
does not install anything, read credentials, execute extensions or change files.
Direct file registrations are recognized. Package registrations, discovery and
exclusion patterns must be confirmed by Pi's actual loader.

## 2. Keep workflow state local

Start from a committed Git checkout. Add these lines to its repository-local Git
exclude file, preserving existing entries:

```gitignore
.forgeflow/
.pi/herdr-orchestrator/
```

Find that file with `rtk proxy git rev-parse --git-path info/exclude` from the
target checkout; linked worktrees may share it. Check for already tracked state
before proceeding: ignore rules do not untrack files. The checker tests an ignored
probe path and checks for tracked files; inspect custom negation rules separately.
Store the new brief under `.forgeflow/`; do not reuse another project's worktree
paths. Writers need clean, pre-existing linked worktrees in this repository.

## 3. Establish the project's real controller

Open the target checkout in its own Herdr pane and start Pi directly in the
terminal. Confirm `HERDR_ENV=1`, and the actual pane/workspace IDs. Never copy IDs
from this guide or another session. Use Pi's interactive `/login` with the
subscription provider if necessary; `/login` is not a shell command.

Ask Pi to inspect existing Baa-ton controller mappings first and preserve other
roots. For initial registration, use `herdr_bootstrap_root` normally. Use
`add=true` only when both this pane and workspace are distinct from all existing
roots. Never reset an existing root without asking its owner. Registering a new
root must be authorized; a setup check does not grant that authorization.

After successful authorized registration, enable the installed controller plugin
with `rtk proxy herdr plugin enable herdr-orchestrator-controller`, then call
`herdr_doctor` and report unresolved checks. Do not dispatch during setup.

Confirm these native tools are present in that Pi session:

- Baa-ton: `herdr_bootstrap_root`, `herdr_doctor`, `herdr_plan`, `herdr_dispatch`.
- Adapter: `forgeflow_status`, `forgeflow_plan_lanes`,
  `forgeflow_prepare_lane`, `forgeflow_reconcile_lane`, `forgeflow_verify_lane`.

If missing after `/reload`, restart Pi and resume that project's same session.
The local `baa-ton-forge-resume` launcher is specific to the adapter development
root; do not use it for another project. Do not replace missing native tools with
shell imports or mock APIs.

## 4. Preview before dispatch

Create a project-specific brief using [the brief contract](README.md#brief-contract).
Include an explicit `launchProfile` on each task, including read-only tasks.
Preparation rejects missing profiles before creating a workflow; preview alone
does not establish dispatch readiness. Use the provider/model authorized for this
project rather than copying another project's selection.
Run `/forgeflow-status ".forgeflow/brief.json"` first. For a new project, missing
workflow records or a missing manifest may be expected; they do not prove that
registration succeeded or that no workflows exist elsewhere.

Call `forgeflow_plan_lanes` with that brief to save its preview in the live root
session. Call `forgeflow_prepare_lane` only after checking the task's checkout,
authorization and harness readiness. Baa-ton owns subsequent planning, dispatch
and completion receipts. Apply Forgeflow lean planning/review guidance without
spawning nested agents inside lanes. Root independently verifies the diff and
checks, integrates with authorization, then saves `forgeflow_verify_lane`.
Completion alone does not satisfy a dependency.

A portable installation smoke test can validate local checks, real Pi extension
loading, and brief/status handling in a second Git repository. It cannot validate
live controller registration or dispatch without a real second Herdr root.
