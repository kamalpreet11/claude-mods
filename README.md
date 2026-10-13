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
- History survives a crash or `--resume`: it is saved per session in the
  plugin's own store under `~/.claude`, last 30 sessions kept.

### How a prompt is scored

The grader first reads the conversation so far: your last three prompts and
a slice of Claude's last reply. Anything Claude already knows from earlier
turns counts as given, so a short follow-up that is clear in context is not
punished for leaving it out.

It then decides what kind of message you sent and grades it by that kind's
own standard:

| Kind | What it is | What a good one needs |
|---|---|---|
| task | asks for work: build, fix, change, write, run | files or module, the symptom, what done looks like, what not to touch |
| question | asks to know or understand something | one question, bounded to one thing, clear what a satisfying answer contains |
| decision | answers a question Claude asked, or picks an option | a plain, unambiguous answer |

Five criteria, each 0 to 20, summed to the score:

| Criterion | Asks |
|---|---|
| Clarity | Is the ask unambiguous, with the task stated up front? |
| Context | Does Claude have what it needs, from this prompt or earlier turns: what is known, where things are, what was tried? |
| Criteria | Is it clear what "done" looks like, how to verify, or what to return? |
| Scope | Is the work bounded: which files, which platform, what not to touch? |
| Constraints | Are rules, examples, style or decisions already made named where they matter? |

Score anchors per criterion: 20 means nothing more could reasonably be
asked for a task of this size; 16 to 19 covered, one small thing could be
sharper; 11 to 15 partly covered; 5 to 10 mostly missing; 0 to 4 absent.
Points are never withheld for details you could not know yet (the root
cause, which fix is right) or for brevity when the ask is already clear.

Rough reading of the total:

| Score | Means |
|---|---|
| 80 and up | Claude can start without guessing |
| 60 to 79 | one or two things left for Claude to assume |
| 40 to 59 | Claude will guess at something material |
| under 40 | expect a clarifying question or the wrong thing built |

Calibration runs with the real grader: a prompt of "fix it please it is
broken" scores about 13; a prompt naming the file, the symptom, the test to
add and the command to run scores 77 to 85; the same prompt scored three
times lands within one or two points. Alongside the score the pane gives one
tip, up to three bullets, and "Try instead": your ask rewritten the way you
should have sent it, in your own voice.

## session-coach

Reviews how you ran the whole session, not one prompt. It logs every turn
(your prompt, duration, tool calls, edits, shell runs, test or build runs,
failures, questions asked, aborts) and has Sonnet judge the developer, not
the assistant.

- `/session-coach` or the pane's "Review now" runs a review; it also runs by
  itself every 10 turns.
- The pane shows the gauge and score, a summary, what is going well, what to
  do differently, the wasted turn numbers, the one habit to change next
  session, and the recent turns tagged talk, edit, check or abort.
- The log and the last review persist per session like prompt-coach's.
  Subagent activity is not counted.

### How a session is scored

Five parts of 20, summed to the score:

| Criterion | Asks |
|---|---|
| Goal | Was the goal stated early and kept in view? |
| Steering | Were course corrections early and specific, or late and vague? |
| Verification | Did you ask for, or get, tests, builds or checks before moving on? |
| Scope | Were turns bounded, or did asks sprawl and get re-done? |
| Efficiency | How many turns did real work versus clarification, repeats or undo? |

The same 0 to 20 anchors as prompt-coach apply. The reviewer judges from the
log, not from what it cannot know: a turn with a test or build run counts
for verification, a prompt naming files or a platform counts for scope, an
early turn stating the outcome counts for goal. Repeated prompts on the same
thing, aborted turns and turns spent answering Claude's questions count
against steering and efficiency. A session under five turns is scored on
what is there and the summary says the sample is small.

Calibration: a well-run eight-turn session (clear goal, test each step,
bounded asks, commits) scores 85 to 86; a messy one ("make the app better",
abort, undo everything, "just commit it") scores 20 to 23 with most turns
flagged as wasted. Repeat runs land within one to three points.

A shell command counts as a check when it runs tests, a build, a lint or a
type check: gradle or gradlew with `test`, npm or pnpm or yarn or bun `test`,
`check`, `lint` or `build`, pytest, jest, vitest, mocha, cargo test, go test,
swift test, xcodebuild test, mvn test, tsc, flutter test, dotnet test, make
test or check.

## Develop

```
claude plugin validate <mod>
claude plugin test <mod>
claude --plugin-dir <mod>
```

## License

MIT, see [LICENSE](LICENSE).
