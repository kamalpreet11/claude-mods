# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): small plugins that
change Claude's own interface or behaviour.

## prompt-coach

Scores every prompt you send from 1 to 100 and shows it on a red-to-green
gauge above the prompt box, with one tip on what to do better. A pane keeps
the history, the rubric breakdown and the fuller notes.


### Install

At the prompt of a Claude Code terminal session:

```
/plugin install prompt-coach --marketplace kamalpreet11/claude-mods
```

Answer `y` to add the marketplace, then pick the **user** scope so it loads
in every project on your machine.

### What it does

- Every prompt of six or more words is graded in the background by one
  Haiku call at low effort. Slash commands and short follow-ups ("yes",
  "commit this") are skipped. Your prompt is never delayed.
- The grade is five parts of 20: clarity, context given, success criteria,
  scope bounds, constraints or examples. The sum is the score.
- **Band above the prompt:** a 20-cell gauge coloured red through amber to
  green, the score, and the one-line tip. A Hide button dismisses it.
- **Pane:** `/prompt-coach` opens the latest score with the rubric as mini
  gauges, the "Do better" notes, your running average, and the last 30
  prompts.

The grader call runs through your own Claude Code session, so on a
subscription it draws from your plan's usage allowance; there is no
separate charge.

### Develop

```
claude plugin validate prompt-coach
claude plugin test prompt-coach
claude --plugin-dir prompt-coach
```

## License

MIT, see [LICENSE](LICENSE).
