import { atom, read, update } from 'claude-code'
import type { Register, Hook, Color } from 'claude-code'

import type { Current, Review, Turn } from '../types'

const PANE = 'session-coach'
const KEEP = 200
const EVERY = 10
const GAUGE_CELLS = 20

const turns = atom({ plugin: 'session-coach', key: 'turns' } as const, [])
const current = atom({ plugin: 'session-coach', key: 'current' } as const, null)
const review = atom({ plugin: 'session-coach', key: 'review' } as const, null)
const isReviewing = atom({ plugin: 'session-coach', key: 'isReviewing' } as const, false)
const lastError = atom({ plugin: 'session-coach', key: 'lastError' } as const, null)
const sessionId = atom({ plugin: 'session-coach', key: 'sessionId' } as const, null)

const KEEP_SESSIONS = 30

/** The store keys to drop so at most `keep` sessions stay, oldest first. */
export const staleKeys = (keys: readonly string[], keep: number): string[] => {
  const mine = keys.filter(k => k.startsWith('session:'))
  return mine.length <= keep ? [] : mine.slice(0, mine.length - keep)
}

type Saved = { turns: Turn[]; review: Review | null }

/** Writes this session's log and review to the plugin's own store, so a resumed session gets them back. */
async function persist($: Parameters<Hook<'turn.complete'>>[0]) {
  const id = await read($, sessionId)
  if (id === null) return
  const saved: Saved = { turns: await read($, turns), review: await read($, review) }
  await $.store.set(`session:${id}`, saved)
}


const RULES = `You coach a software developer on how they ran a working session with an AI coding assistant.
You get the session's turn log: for each turn the developer's prompt (truncated), how long the assistant worked, how many tool calls it made, how many file edits, shell runs, test or build runs, failed tool calls, clarifying questions it had to ask, and whether the developer aborted it.
Judge the developer, not the assistant. Score 1 to 100 on five parts of 20:
- goal: was the goal stated early and kept in view?
- steering: were course corrections early and specific, or late and vague?
- verification: did the developer ask for or get tests, builds or checks before moving on?
- scope: were turns bounded, or did asks sprawl and get re-done?
- efficiency: how many turns did real work versus clarification, repeats or undo?
Scoring anchors, apply them literally: 20 = nothing more could reasonably be asked of the developer on this part; 16-19 = done well, one small thing could be sharper; 11-15 = partly; 5-10 = mostly missing; 0-4 = absent. Judge from the log you have, not from what is unknowable: a turn with checks run counts for verification, a prompt naming files or a platform counts for scope, an early turn that states the outcome counts for goal. Repeated prompts on the same thing, aborted turns, and turns the assistant spent asking questions count against steering and efficiency. A session of fewer than five turns has little evidence; score what is there, do not default to a middling number, and say in the summary that the sample is small. Leave "strengths" or "improve" empty when nothing material fits.
Answer with JSON only, no prose and no code fence:
{"goal":n,"steering":n,"verification":n,"scope":n,"efficiency":n,"summary":"two sentences on how the session went","strengths":["up to three short bullets"],"improve":["up to three short bullets, each a concrete habit"],"wasted":[turn numbers that added nothing, may be empty],"nextTime":"one sentence: the single habit to change next session"}`

const TEST_RUN = /\b(gradlew?|gradle)\b[^|;&]*\btest\b|\bnpm (run )?(test|check|lint|build)\b|\b(pnpm|yarn|bun) (test|check|lint|build)\b|\b(pytest|jest|vitest|mocha|cargo test|go test|swift test|xcodebuild[^|;&]*\btest\b|mvn[^|;&]*\btest\b|tsc\b|flutter test|dotnet test|make (test|check))/i

const clamp = (n: unknown, max: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0
  return Math.max(0, Math.min(max, v))
}

/** True when a shell command is a test, build, lint or type check. */
export const isVerification = (command: string): boolean => TEST_RUN.test(command)

/** One line per turn, the log the reviewer reads. */
export const describeTurns = (list: readonly Turn[]): string =>
  list
    .map(t => {
      const flags = [
        t.isAborted ? 'ABORTED' : null,
        t.reason !== 'answer' && !t.isAborted ? t.reason.toUpperCase() : null,
      ].filter(Boolean)
      return `#${t.n} (${Math.round(t.durationMs / 1000)}s, tools ${t.tools}, edits ${t.edits}, shell ${t.bash}, checks ${t.tests}, failed ${t.failures}, questions ${t.questions}${flags.length ? ', ' + flags.join(' ') : ''}): "${t.prompt}"`
    })
    .join('\n')

/** The reviewer's JSON, tolerant of a fence or stray prose around it. */
export const parseReview = (text: string, turnCount: number, at: number): Review | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  const sum = clamp(raw.goal, 20) + clamp(raw.steering, 20) + clamp(raw.verification, 20) + clamp(raw.scope, 20) + clamp(raw.efficiency, 20)
  const strings = (v: unknown, max: number): string[] =>
    Array.isArray(v) ? v.filter((b): b is string => typeof b === 'string').map(b => b.trim()).filter(Boolean).slice(0, max) : []
  const wasted = Array.isArray(raw.wasted) ? raw.wasted.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).map(n => Math.round(n)) : []
  return {
    at,
    turns: turnCount,
    score: Math.max(1, Math.min(100, sum)),
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
    strengths: strings(raw.strengths, 3),
    improve: strings(raw.improve, 3),
    wasted,
    nextTime: typeof raw.nextTime === 'string' ? raw.nextTime.trim() : '',
  }
}

/** Red at 1, amber at 50, green at 100, as a hex colour. */
export const colorFor = (score: number): Color => {
  const t = Math.max(0, Math.min(1, (score - 1) / 99))
  const mix = (a: number, b: number, k: number) => Math.round(a + (b - a) * k)
  const [r, g, b] =
    t < 0.5
      ? [mix(0xd9, 0xe6, t * 2), mix(0x3c, 0xa8, t * 2), mix(0x3c, 0x2e, t * 2)]
      : [mix(0xe6, 0x2e, (t - 0.5) * 2), mix(0xa8, 0xb8, (t - 0.5) * 2), mix(0x2e, 0x5a, (t - 0.5) * 2)]
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

async function runReview($: Parameters<Hook<'command.run'>>[0], at: number) {
  const list = await read($, turns)
  if (list.length === 0) {
    await update($, lastError, () => 'nothing to review yet')
    return
  }
  await update($, isReviewing, () => true)
  const r = await $.model.complete({
    model: 'sonnet',
    effort: 'medium',
    maxTokens: 900,
    timeoutMs: 60000,
    system: [{ text: RULES, cache: true }],
    prompt: `Session turn log (${list.length} turns):\n${describeTurns(list)}`,
  })
  await update($, isReviewing, () => false)
  if (!r.isAnswered) {
    await update($, lastError, () => `reviewer ${r.reason}`)
    return
  }
  const parsed = parseReview(r.text, list.length, at)
  if (parsed === null) {
    await update($, lastError, () => 'reviewer returned no JSON')
    return
  }
  await update($, lastError, () => null)
  await update($, review, () => parsed)
  await persist($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const id = await $.session.id()
    await update($, sessionId, () => id)
    const saved = (await $.store.get(`session:${id}`)) as Saved | undefined
    if (saved !== undefined && Array.isArray(saved.turns)) {
      await update($, turns, () => saved.turns)
      await update($, review, () => saved.review ?? null)
    } else {
      await $.store.set(`session:${id}`, { turns: [], review: null })
    }
    for (const stale of staleKeys(await $.store.keys(), KEEP_SESSIONS)) await $.store.delete(stale)
    await $.command.register({
      name: 'session-coach',
      description: 'Review how you have run this session: score, strengths, what to change, wasted turns',
    })
    void $.ui.open({ id: PANE, title: 'Session coach' })

    return next(e)
  })

  on('command.run', { command: 'session-coach' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Session coach', focus: true })
    const at = await $.clock.now()
    void runReview($, at).catch(() => update($, isReviewing, () => false))

    return { text: opened.isPlaced ? 'Session coach is reviewing; see the pane.' : 'Session coach is reviewing; widen the window to see the pane.' }
  })

  on('turn.start', async ($, e, next) => {
    const fresh: Current = { turnId: e.turnId, prompt: e.text.replace(/\s+/g, ' ').slice(0, 160), tools: 0, edits: 0, bash: 0, tests: 0, failures: 0, questions: 0 }
    await update($, current, () => fresh)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    // Bookkeeping only. The tool has run by now, so nothing below may throw
    // into the chain: a counting failure is swallowed and the result returned.
    try {
      if (e.agentId === undefined) {
        const tool = e.tool
        const command = tool === 'Bash' && typeof (e as { command?: unknown }).command === 'string' ? (e as { command: string }).command : ''
        const failed = ran.deny === undefined && ran.isError === true
        await update($, current, c =>
          c === null
            ? c
            : {
                ...c,
                tools: c.tools + 1,
                edits: c.edits + (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit' ? 1 : 0),
                bash: c.bash + (tool === 'Bash' ? 1 : 0),
                tests: c.tests + (tool === 'Bash' && isVerification(command) ? 1 : 0),
                failures: c.failures + (failed ? 1 : 0),
                questions: c.questions + (tool === 'AskUserQuestion' ? 1 : 0),
              },
        )
      }
    } catch {
      // counted nothing this time
    }

    return ran
  }).catch(($, e, next) => next(e)) // replay-safe: after `called`, next(e) is the result already obtained

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const c = await read($, current)
    const list = await read($, turns)
    const at = await $.clock.now()
    const done: Turn = {
      n: list.length + 1,
      at,
      prompt: c?.prompt ?? '',
      durationMs: e.durationMs,
      tools: c?.tools ?? 0,
      edits: c?.edits ?? 0,
      bash: c?.bash ?? 0,
      tests: c?.tests ?? 0,
      failures: c?.failures ?? 0,
      questions: c?.questions ?? 0,
      isAborted: e.isAborted,
      reason: e.reason,
    }
    await update($, turns, old => [...old, done].slice(-KEEP))
    await update($, current, () => null)
    await persist($)
    if (done.n % EVERY === 0) {
      void runReview($, at).catch(() => update($, isReviewing, () => false))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, turns)
    const rev = await read($, review)
    const busy = await read($, isReviewing)
    const error = await read($, lastError)
    const rows = e.viewport?.rows ?? 24

    const totals = list.reduce(
      (s, t) => ({ tools: s.tools + t.tools, edits: s.edits + t.edits, tests: s.tests + t.tests, failures: s.failures + t.failures, aborted: s.aborted + (t.isAborted ? 1 : 0), questions: s.questions + t.questions }),
      { tools: 0, edits: 0, tests: 0, failures: 0, aborted: 0, questions: 0 },
    )
    const refresh = (
      <Button key="refresh" label={busy ? 'Reviewing…' : 'Review now'} onPress={async () => { const at = await $.clock.now(); await runReview($, at) }} />
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold>Session</Text>
          <Text dimColor>
            {String(list.length)} turns, {String(totals.tools)} tools, {String(totals.edits)} edits, {String(totals.tests)} checks, {String(totals.failures)} failed, {String(totals.questions)} questions, {String(totals.aborted)} aborted
          </Text>
          {refresh}
        </Box>
        {rev === null && !busy && (
          <Text dimColor>No review yet. Press Review now, or wait: it runs itself every {String(EVERY)} turns.</Text>
        )}
        {busy && <Text dimColor>Reviewing the session…</Text>}
        {error !== null && !busy && <Text color="warning">{error}</Text>}
        {rev !== null && (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="row" gap={1}>
              <Gauge Text={Text} Box={Box} score={rev.score} />
              <Text bold color={colorFor(rev.score)}>{String(rev.score)}</Text>
              <Text dimColor>after {String(rev.turns)} turns</Text>
            </Box>
            <Text wrap="wrap">{rev.summary}</Text>
            {rev.strengths.length > 0 && (
              <Box flexDirection="column">
                <Text bold color="success">Going well</Text>
                {rev.strengths.map(s => <Text wrap="wrap">{'  + '}{s}</Text>)}
              </Box>
            )}
            {rev.improve.length > 0 && (
              <Box flexDirection="column">
                <Text bold color="warning">Do differently</Text>
                {rev.improve.map(s => <Text wrap="wrap">{'  - '}{s}</Text>)}
              </Box>
            )}
            {rev.wasted.length > 0 && (
              <Text dimColor wrap="wrap">Wasted turns: {rev.wasted.map(n => `#${n}`).join(', ')}</Text>
            )}
            {rev.nextTime !== '' && (
              <Box flexDirection="column">
                <Text bold>Next session</Text>
                <Text wrap="wrap">{rev.nextTime}</Text>
              </Box>
            )}
          </Box>
        )}
        {list.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Recent turns</Text>
            {list.slice(-Math.max(3, rows - 22)).reverse().map(t => (
              <Box flexDirection="row" gap={1}>
                <Text dimColor>{`#${t.n}`.padStart(4)}</Text>
                <Text dimColor>{`${Math.round(t.durationMs / 1000)}s`.padStart(5)}</Text>
                <Text color={t.failures > 0 || t.isAborted ? 'warning' : t.tests > 0 ? 'success' : 'text'}>
                  {t.isAborted ? 'abort' : t.tests > 0 ? 'check' : t.edits > 0 ? 'edit ' : 'talk '}
                </Text>
                <Text dimColor wrap="truncate-end">{t.prompt}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}

/** A bar of cells, each coloured where it sits on the red-to-green run, filled up to the score. */
function Gauge(props: { Text: any; Box: any; score: number; cells?: number }) {
  const { Text, Box, score } = props
  const cells = props.cells ?? GAUGE_CELLS
  const filled = Math.round((score / 100) * cells)
  const parts = []
  for (let i = 0; i < cells; i += 1) {
    const at = Math.round(((i + 1) / cells) * 100)
    parts.push(i < filled ? <Text color={colorFor(at)}>▰</Text> : <Text dimColor>▱</Text>)
  }
  return <Box flexDirection="row">{parts}</Box>
}
