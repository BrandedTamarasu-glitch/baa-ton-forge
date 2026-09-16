# Baa-ton Forge

A local Pi adapter that previews Baa-ton lane plans from Forgeflow briefs.
Requires Node.js 20+. No runtime dependencies or network calls.

## Use

```sh
rtk proxy node cli.js examples/brief.md
rtk proxy node cli.js --json examples/brief.md
rtk proxy npm test
```

Register the absolute `extension.js` path in Pi's `settings.json` extensions
array. Reload Pi with `/reload`, then run:

```text
/forgeflow-plan-lanes /absolute/path/to/brief.md
```

Paths containing spaces are supported, with or without enclosing double quotes.
The command displays the preview without starting a model turn. Pi may retain
that displayed message in its local session history.

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

This adapter does not execute checks, create worktrees, call Baa-ton tools,
change workflow ledgers, merge code, or ingest receipts. Proposed tool arguments
must pass Baa-ton's own live guards. No full Forgeflow workflows are imported.

Next increments: approved plan handoff through the root, checkout-bound receipt
mapping, independent verification, then local task-history updates. Preserve
each system's ledger and keep generated state local. Use Git local exclusions
for `.forgeflow/` and `.pi/herdr-orchestrator/` in target repositories.
