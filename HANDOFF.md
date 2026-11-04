# claude-agent-monitor: handoff

Written 2026-11-04 from the real repo state (git commands run, not recalled). Safe to delete once read.

## 1. What this is

`claude-agent-monitor` is a Claude Code **mod** (plugin name `agent-monitor`) by Christian Jones (GitHub `luckyajinn`, signs as CJ). It draws a live pane and a one-line summary of every subagent the session starts: task, model, estimated progress, estimated cost. It uses Claude Code's early-access mod API; `types/index.d.ts` is the repo's own state contract (the engine's API types are written to `.claude-plugin/types/` the first time the engine loads the mod).

What it does today (v0.1.1):
- **Pane** (`/agent-monitor`, also opens itself on the first subagent): one expanded card per agent (status icon, name, model, time, steps, `~%` progress bar, estimated cost, token counts, crab sprite; plain text `\o_o/` in a terminal). Click a name to open it like a folder: its sub-agents show inside, a breadcrumb leads back, and a detail view lists task, model, tokens, cost split, last 8 steps and final report.
- **Band**: a one-line "N agents running · $x est." above the prompt, drawn above whatever another plugin puts there.
- **Clear finished** (new in 0.1.1; was "Clear all"): removes only done/stopped/failed cards. Never removes an active agent, nor a finished parent that has an active agent inside it. Label `Clear finished (N)`; dimmed `Clear finished` plus a note like `2 still running stay` (or `1 still running stays, with 1 finished parent`) when nothing can be cleared. `Button` has no `disabled` prop, so dimmed means `dimColor` only.
- **New-prompt clearing** (kept from before, one fix in 0.1.1): when the person sends a prompt, finished cards go, and so does a card that says `running` but the engine no longer lists as going (stuck-card recovery). The breadcrumb resets. Slash commands, notifications and other plugins' prompts clear nothing. New: a finished parent of a still-going card now stays.

## 2. Repo state (checked with git)

- GitHub: https://github.com/luckyajinn/claude-agent-monitor (MIT). Marketplace name `claude-agent-monitor`, plugin `agent-monitor`.
- `main` HEAD = `ffa766e` "Clear finished: never clear an agent that is still active". Local `main` = `origin/main` = `ffa766e`, confirmed against GitHub with `git ls-remote origin main`. Everything is pushed.
- Plugin version in `.claude-plugin/plugin.json`: **0.1.1** (the only place the version lives).
- Both working trees (main clone and the worktree) were clean before this file was written. **`HANDOFF.md` itself is uncommitted and unpushed.**
- Branch + worktree `claude/no-clear-active-agents-60dcc5` (at `.claude/worktrees/no-clear-active-agents-60dcc5`) still exist, at `ffa766e`: fully merged, safe to remove (`git worktree remove .claude/worktrees/no-clear-active-agents-60dcc5` then `git branch -d claude/no-clear-active-agents-60dcc5`; not done). Removing the worktree deletes any file left in it, so move this file out first.
- History (newest first): ffa766e Clear finished; 8f5bfbc compat screenshot; 47cb9d4 expanded cards + detail view; 85b0d76 stuck statuses + folder open; f21af40 cost rates doc; 4a4fe42 lic/readme; 995e2c0 first version.

## 3. Verified and not verified

Verified (run against `main` just now with the 2.1.317 binary):
- `claude plugin validate .` -> "Validation passed" (one warning, ICON_MISSING: the plugin has no icon; harmless).
- `claude plugin test .` -> **26 pass, 0 fail**.
- The real engine loads the module: a headless `--plugin-dir` run logged `hooks module agent-monitor@inline loaded ... events: session.start,command.run,prompt.submit,agent.spawn,turn.start,turn.step,turn.complete,ui.render`, nothing skipped or refused.
- Mutation checks (broke one rule at a time in a scratch copy) made the relevant tests fail: clear-everything, ancestors dropped, engine list ignored, trail never/always trimmed, button never dimmed, new-prompt line reverted.
- Source files type-check clean with TypeScript against the engine's `claude-code.d.ts`. The test file has about 12 typing warnings from the kit's loose input types (`$.prompt.submit`, etc.); older tests had the same kind.

**NOT verified:**
- **It has not run in a live Claude Code session.** No one has seen the dimmed button, the note, or the new clearing on a real desktop or terminal pane. The headless run failed auth ("OAuth session expired") before any pane drew.
- Whether the real `$.agent.list()` reports `pending`/`waiting` the way the tests assume, and whether it lists every agent the mod tracks.
- How `dimColor` on a `Button` looks in the real terminal and desktop surfaces.

Installed copy: this PC has `agent-monitor@claude-agent-monitor` at **0.1.0** (user scope, enabled). It stays there until updated (restart needed afterwards):
```
claude plugin marketplace update claude-agent-monitor
claude plugin update agent-monitor@claude-agent-monitor
```
(Syntax read from `--help`; **not run**, to avoid changing the live install.)

## 4. Set up on a new machine

```
git clone https://github.com/luckyajinn/claude-agent-monitor.git
cd claude-agent-monitor
claude plugin validate .
claude plugin test .
claude --plugin-dir .      # load it for one session only
```
- No package.json, no npm install: tests run inside `claude plugin test`. (Clone URL is the repo's `origin`; I did not re-clone. Validate, test and `--plugin-dir` were run on this PC.)
- On this Windows PC `claude` was **not on PATH** in Git Bash. Binary used: `C:\Users\Administrator\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\claude-code\2.1.317\a33aa5518497\claude.exe`. Another one exists at `~\.local\bin\claude.exe` (version not checked).
- A fresh clone cannot type-check until the engine has loaded the mod once: `tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which the engine writes (gitignored). No `tsc` is installed here; VS Code bundles TypeScript.
- Try it: start a session with `--plugin-dir .`, run `/agent-monitor`, start a few subagents, press **Clear finished** while some are running.

## 5. Design decisions and why

- **Active** = card status in the existing `LIVE` set (`pending`, `running`, `waiting`) **or** the engine's `$.agent.list()` lists that id with a LIVE status, read when the pane draws and again when the button is pressed. Cards only ever hold `running/done/failed/stopped`, so `pending`/`waiting` protection comes only from the engine list. If the list can't be read, the card alone decides (same fallback as `prompt.submit`).
- **`survivors(list, isActive)`** (`hooks/track.ts`) keeps every active row plus all its ancestors (walks `parentId`; tolerates a missing parent and a parent loop). Why: a card must never sit in the tree without the parent it is opened from.
- **Judged inside the write**: `clearFinished` computes survivors inside `update($, agents, ...)`, so a card that came alive after the pane drew is kept. Press recomputes; the dimmed state is display only.
- **Trail** (`trailAfter`): the breadcrumb `path` is left untouched while every card it names remains; otherwise cut back to the longest valid prefix (`validTrail`). New-prompt clearing still resets it to `[]`.
- **New prompt** now calls `survivors` with its old test (`status === 'running'` and engine-listed), so a finished parent of a running child stays. Before, the parent was dropped and the child vanished from the pane (header said "1 running", no card; `rootsOf` only lists rows with no parent). Reproduced first, then fixed; regression test added.
- **Stuck card vs Clear** (a conscious trade-off): a card that says `running` but isn't in the engine list counts as active for the button, so Clear leaves it; the next prompt removes it. Chosen to keep "never remove an active agent" absolute. README says so.
- Progress and cost are estimates by design (drawn with `~`, "est."); cost rates in `hooks/track.ts` are assumptions (Fable's is a guess).

## 6. Known limitations, open questions, next steps (priority order)

1. **Run it live** and look: dimmed button + note on desktop and terminal, `Clear finished (N)` count, new-prompt behaviour with a nested running agent. Confirm real `agent.list()` statuses.
2. **Stuck card cannot be cleared with the button** (clears at next prompt). Options: (a) treat a `running` card as clearable only when the engine list positively names it with a non-LIVE status (`completed`/`failed`/`killed`), still trusting the card if it is merely absent; (b) a separate "Clear stuck" button shown only in that case; (c) press-twice confirm. (a) is the smallest change; needs a live check of what the engine reports.
3. **`capRows` can orphan too** (by code reading, not reproduced): at 30 rows it evicts the oldest *finished* row first, which could be a finished parent of a running child. Same fix idea: skip rows that `survivors` would keep.
4. **Inconsistency**: Clear finished keeps a `done` card the engine lists as `pending`/`waiting`; the new-prompt clearing still drops it (it requires `status === 'running'`). Decide which is right, probably align.
5. The `notes` Map (task text/report kept in memory) is not pruned when cards are cleared; a reload forgets it. Minor.
6. Optional: add a plugin icon to silence ICON_MISSING; clean the test-file typing warnings.

## 7. Conventions and layout

- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (used on ffa766e). PR bodies end with the Claude Code attribution line.
- Do not push or commit unless Christian asks. No network calls from the mod. Never read, print or log `~/.claude/settings.json` or `~/.claude/.credentials.json` (secrets).
- Other CJ mods live in separate repos and must not be touched from here.
- Layout: `hooks/register.tsx` (579 lines: pane UI, state atoms `agents`/`path`, event handlers), `hooks/track.ts` (335: pure helpers, rates, tree helpers), `hooks/crab.ts` + `hooks/crabs.ts` (sprite), `hooks/register.test.tsx` (1014: kit tests), `hooks/hooks.json` (`{"modules":["./register.tsx"]}`), `types/index.d.ts` (state contract), `.claude-plugin/plugin.json` and `marketplace.json`, `docs/*.png` (README screenshots).
- Not obvious: `.claude/worktrees/` is ignored via `.git/info/exclude`, not `.gitignore`; `.claude-plugin/types/` is engine-written and gitignored. In tests the kit's `$` has no `state` noun, so `keepState` in the test file answers `state.get`/`state.set` over a Map to read the breadcrumb back. `ui.find({type:'Button', key})` exposes `props.label`/`props.dimColor`.

## 8. Resume prompt

> I'm continuing work on `claude-agent-monitor`, my Claude Code mod (plugin `agent-monitor`, repo https://github.com/luckyajinn/claude-agent-monitor, v0.1.1, `main` at `ffa766e`, all pushed). Read `HANDOFF.md` at the repo root first. The pane's "Clear all" is now "Clear finished": it never removes an agent that is still active (card `running` or listed by the engine as pending/running/waiting) or a finished parent of one, and a new prompt no longer orphans a running child. 26 tests pass and `claude plugin validate .` passes, but it has never run in a live session. Start by cloning and running `claude plugin validate .`, `claude plugin test .` and `claude --plugin-dir .`, then help me with the top item in section 6 (live check, then the stuck-card override). Don't commit or push unless I ask; keep to this repo; never touch my settings or credentials files.
