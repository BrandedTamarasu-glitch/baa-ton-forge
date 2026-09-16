# Implementation brief: example only

This synthetic example demonstrates the adapter format. Replace objectives,
paths, acceptance criteria, and validation commands with the actual brief.
Worktrees and profiles are intentionally unassigned.

```forgeflow-lanes
{
  "version": 1,
  "objective": "Add a project status page",
  "acceptance": ["Status is accessible by keyboard", "Existing API consumers remain compatible"],
  "tasks": [
    { "id": "api", "objective": "Expose status data", "files": ["src/api/"], "checks": ["Run the project's API tests"] },
    { "id": "ui", "objective": "Render status using the agreed API contract", "files": ["src/ui/"], "checks": ["Run UI tests and check keyboard navigation"], "dependsOn": ["api"] },
    { "id": "review", "objective": "Review the integrated change against acceptance criteria", "files": ["src/"], "checks": ["Inspect the combined diff and root validation evidence"], "readOnly": true }
  ]
}
```
