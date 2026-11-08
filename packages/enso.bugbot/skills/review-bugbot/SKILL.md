---
name: review-bugbot
description: Review code changes with the Bugbot readonly subagent and record findings in the Bugbot sidebar panel.
---

# Bugbot Code Review (`/review-bugbot`)

Follow this workflow whenever the user invokes `/skill:review-bugbot`, `/review-bugbot`, `/enso.bugbot:review`, or asks to run a Bugbot code review on local changes.

## Step 1: Determine whether to delegate or review in-place

Review **in-place** (do NOT spawn another subagent) if either is true:
- The `subagent` tool is unavailable in this session; or
- You are **already** running inside the `bugbot` subagent (your prompt already contains `Full Repository Path:` and `Diff:`).

Otherwise, delegate to the `bugbot` readonly subagent after preparing the local context.

## Step 2: Prepare local diff and repository rules (`bugbot_prepare`)

Call `bugbot_prepare` first:
- Default `mode`: `"branch_changes"` (compares merge-base against the default base branch plus staged/unstaged/untracked changes).
- Use `mode: "uncommitted_changes"` when the user specifically asks to review only uncommitted / dirty working-tree changes, or when the current branch has no commits ahead of the base branch.
- If the user message says to call `bugbot_prepare` with `mode: "uncommitted_changes"`, that mode is required. Do not fall back to `branch_changes`.
- Use `mode: "natural_language"` with `changeDescription` only as a last resort when git diff is unavailable.
- Pass `customInstructions` if the user specified extra review focus.

If `bugbot_prepare` returns `details.skipped === true` (for example `Not enough changes to review (< 10 changed lines)`), report that directly to the user and stop.

## Step 3: Spawn exactly one `bugbot` subagent

Call `subagent` with:
- `operation: "spawn"`
- `agent_type: "bugbot"`
- `description: "Bugbot"`
- `wait: true`
- `prompt`: Pass the prepared prompt from `bugbot_prepare` (which contains `Full Repository Path:`, `Diff:`, optional `Base Branch:`, `Patch File:`, and `Custom Instructions:`).

## Step 4: Record findings and present results (`bugbot_report`)

1. Call `bugbot_report` with `runId` (from `bugbot_prepare`) and `rawText` (the output returned by the `bugbot` subagent) so the Bugbot sidebar panel and quick-fix actions stay updated.
2. Present the findings to the user as a Markdown table sorted by severity (`high` → `medium` → `low`):
   `| Severity | Location (file:line) | Finding |`
   or output `Bugbot found no bugs` when there are none.
3. Do **not** automatically edit files or fix the bugs unless the user explicitly asks you to fix them.
