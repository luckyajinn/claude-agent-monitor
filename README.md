# claude-agent-monitor

A Claude Code mod that keeps a live pane of every subagent your session starts. Each agent gets a card showing:

- **Model:** a plain name such as "Sonnet 5.5".
- **Task:** what it is doing right now (Researching, Writing, Verifying, Delegating, Done), with the file or command in progress.
- **Progress:** a percent bar.
- **Cost:** estimated dollars and token counts.
- **A crab:** an 8-bit sprite that works while the agent works and raises its arms when it is done.

A one-line summary also appears above the prompt while any agent is running. Anything another plugin draws there (a usage bar, for example) stays beneath it.

The pane shows the latest prompt's work only. When you send a new prompt, cards for finished agents clear; agents still running stay. A slash command or a background notification does not clear anything.

## Install

At the prompt of a terminal session:

```
/plugin install agent-monitor --marketplace luckyajinn/claude-agent-monitor
```

From a shell:

```
claude plugin install agent-monitor --marketplace luckyajinn/claude-agent-monitor
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `luckyajinn/claude-agent-monitor`, then Add plugin.

When asked `Add marketplace?`, answer `y`, then pick a scope. The pane opens by itself the first time a subagent starts, and `/agent-monitor` opens it any time.

## What is real and what is estimated

- **Progress is an estimate.** The engine has no percent-complete for an agent, so the bar is a curve over steps taken: quick at first, flattening toward 95%, and 100% when the agent finishes.
- **Cost is an estimate.** The engine reports token counts per agent but no dollars. They are multiplied by the rates in [`hooks/track.ts`](hooks/track.ts), which are assumptions, not a price list. Edit them to match what you pay. The pane also shows the session total the engine itself keeps.
- **Model, steps, tokens and activity are real.** They come straight from the engine's events.

## Development

The mod is one hooks module (`hooks/register.tsx`) plus helpers. Run its tests and validation with:

```
claude plugin test .
claude plugin validate .
```

## Not affiliated with Anthropic

This is an unofficial community mod. The crab is a small pixel sprite inspired by the Claude Code mascot and is not official art.

## License

MIT, see [LICENSE](LICENSE).
