# Named worker profiles

Configure the owning project's `.baa-ton/config.json`, preserving existing
entries. This example uses a previously tested profile, not an automatic default;
choose exact provider/model/auth values authorized and available for your account.
Different roles can select different models and harnesses.

```json
{
  "version": 1,
  "profiles": {
    "quick": {
      "agentKind": "pi",
      "launchProfile": {
        "provider": "openai-codex",
        "model": "gpt-5.5",
        "thinking": "medium",
        "auth": "subscription"
      }
    },
    "review": {
      "agentKind": "pi",
      "launchProfile": {
        "provider": "openai-codex",
        "model": "gpt-5.5",
        "thinking": "medium",
        "auth": "subscription"
      }
    }
  }
}
```

The brief references those names. Assign an actual clean linked worktree to
the writer before preparation; its missing path here intentionally blocks it.
Keep this project-specific brief under `.forgeflow/` and excluded from Git.

```forgeflow-lanes
{
  "version": 1,
  "objective": "Clarify README setup instructions",
  "acceptance": ["Instructions match the supported setup commands"],
  "tasks": [
    {
      "id": "update-readme",
      "objective": "Correct the README setup instructions",
      "taskProfile": "quick",
      "files": ["README.md"],
      "checks": ["Compare the instructions against actual setup commands"]
    },
    {
      "id": "review-readme",
      "objective": "Review the integrated documentation change",
      "taskProfile": "review",
      "dependsOn": ["update-readme"],
      "files": ["README.md"],
      "checks": ["Read the scoped diff and verify the documented commands"]
    }
  ]
}
```

In the project's Pi root, preview the brief with `forgeflow_plan_lanes`, inspect
the resolved profiles, then prepare the selected task with
`forgeflow_prepare_lane`. Existing dispatch and independent verification gates
remain in place. Do not edit `.baa-ton/config.json` mid-workflow to swap models.
