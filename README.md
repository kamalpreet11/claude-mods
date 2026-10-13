# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): small plugins that
change Claude's own interface or behaviour. Both run entirely on your
machine; the only network call is the grader request through your own Claude
Code session, so on a subscription it draws from your plan's allowance and
nothing is billed separately.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install prompt-coach --marketplace kamalpreet11/claude-mods
/plugin install session-coach --marketplace kamalpreet11/claude-mods
```

Answer `y` to add the marketplace the first time, then pick the **user**
scope so they load in every project.

## prompt-coach

Scores every prompt you send from 1 to 100 and shows it on a red-to-green
gauge above the prompt box, with one tip. `/prompt-coach` opens a pane with
the rubric, a rewrite of your prompt the way you should have sent it, and a
clickable history.

- Prompts of six or more words are graded in the background by one Sonnet
  call at low effort. Slash commands and short follow-ups are skipped and the
  prompt is never delayed.
- The grader reads your last three prompts and a slice of Claude's last reply
  first, so a follow-up that is clear in context is graded in context.
- Each prompt is graded as a task, a question or a decision by that kind's
  own standard. Five parts of 20: clarity, context, success criteria, scope,
  constraints.
- History survives a crash or `--resume`: it is saved per session in the
  plugin's own store under `~/.claude`, last 30 sessions kept.

## session-coach

Reviews how you ran the whole session, not one prompt. It logs every turn
(your prompt, duration, tool calls, edits, shell runs, test or build runs,
failures, questions asked, aborts) and has Sonnet judge the developer on
goal, steering, verification, scope and efficiency.

- `/session-coach` or the pane's "Review now" runs a review; it also runs by
  itself every 10 turns.
- The pane shows the gauge and score, a summary, what is going well, what to
  do differently, the wasted turn numbers, the one habit to change next
  session, and the recent turns tagged talk, edit, check or abort.
- The log and the last review persist per session like prompt-coach's.

## Develop

```
claude plugin validate <mod>
claude plugin test <mod>
claude --plugin-dir <mod>
```

## License

MIT, see [LICENSE](LICENSE).
