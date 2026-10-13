import { atom, read, update } from 'claude-code'
import type { Register, Hook, Color } from 'claude-code'

import type { Rubric, Score } from '../types'

const PANE = 'prompt-coach'
const KEEP = 30
const MIN_WORDS = 6
const GAUGE_CELLS = 20

const scores = atom({ plugin: 'prompt-coach', key: 'scores' } as const, [])
const isHidden = atom({ plugin: 'prompt-coach', key: 'isHidden' } as const, false)
const isPending = atom({ plugin: 'prompt-coach', key: 'isPending' } as const, false)
const lastError = atom({ plugin: 'prompt-coach', key: 'lastError' } as const, null)

const RULES = `You grade prompts that a software developer sends to an AI coding assistant.
Score the prompt on five criteria, each 0 to 20:
- clarity: is the ask unambiguous, with the task stated up front?
- context: does it say what is already known, where things are, what was tried?
- criteria: does it say what "done" looks like, how to verify, or what to return?
- scope: does it bound the work (which files, which platform, what not to touch)?
- constraints: does it name rules, examples, style, or decisions already made?
A short follow-up that is clear in context ("yes, do it", "commit this") can still score well on clarity and scope; do not punish brevity when nothing more was needed.
Answer with JSON only, no prose and no code fence:
{"clarity":n,"context":n,"criteria":n,"scope":n,"constraints":n,"tip":"one sentence, under 90 characters, the single most useful change","better":["up to three short bullets on what to add or change"]}`

/** A prompt worth grading: not a slash command, not a bare "yes". */
export const isGradable = (text: string): boolean => {
  const t = text.trim()
  if (t.length === 0 || t.startsWith('/')) return false
  return t.split(/\s+/).length >= MIN_WORDS
}

const clamp = (n: unknown, max: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0
  return Math.max(0, Math.min(max, v))
}

/** The grader's JSON, tolerant of a fence or stray prose around it. */
export const parseGrade = (text: string): Omit<Score, 'at' | 'prompt'> | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  const rubric: Rubric = {
    clarity: clamp(raw.clarity, 20),
    context: clamp(raw.context, 20),
    criteria: clamp(raw.criteria, 20),
    scope: clamp(raw.scope, 20),
    constraints: clamp(raw.constraints, 20),
  }
  const sum = rubric.clarity + rubric.context + rubric.criteria + rubric.scope + rubric.constraints
  const score = Math.max(1, Math.min(100, sum))
  const tip = typeof raw.tip === 'string' ? raw.tip.trim() : ''
  const better = Array.isArray(raw.better)
    ? raw.better.filter((b): b is string => typeof b === 'string').map(b => b.trim()).filter(Boolean).slice(0, 3)
    : []
  return { score, rubric, tip, better }
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

async function grade($: Parameters<Hook<'prompt.submit'>>[0], text: string, at: number) {
  await update($, isPending, () => true)
  const r = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 400,
    timeoutMs: 25000,
    system: [{ text: RULES, cache: true }],
    prompt: text,
  })
  await update($, isPending, () => false)

  if (!r.isAnswered) {
    await update($, lastError, () => `grader ${r.reason}`)
    return
  }
  const parsed = parseGrade(r.text)
  if (parsed === null) {
    await update($, lastError, () => 'grader returned no JSON')
    return
  }
  const entry: Score = { at, prompt: text.replace(/\s+/g, ' ').slice(0, 80), ...parsed }
  await update($, lastError, () => null)
  await update($, scores, list => [...list, entry].slice(-KEEP))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompt-coach',
      description: 'Open the prompt coach pane: your last scores, the rubric and what to do better',
    })
    void $.ui.open({ id: PANE, title: 'Prompt coach' })

    return next(e)
  })

  on('command.run', { command: 'prompt-coach' }, async $ => {
    await update($, isHidden, () => false)
    const opened = await $.ui.open({ id: PANE, title: 'Prompt coach', focus: true })

    return { text: opened.isPlaced ? 'Prompt coach pane opened.' : 'Prompt coach pane is waiting for room; widen the window.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const text = e.text
    if (!isGradable(text)) return next(e)

    const started = await $.clock.now()
    void grade($, text, started).catch(() => update($, isPending, () => false))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, scores)
    const latest = list[list.length - 1]
    const pending = await read($, isPending)
    const error = await read($, lastError)
    const hidden = await read($, isHidden)
    if (e.props.hasSurvey || hidden || (latest === undefined && !pending && error === null)) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        {latest !== undefined && <Gauge Text={Text} Box={Box} score={latest.score} />}
        {latest !== undefined && (
          <Text bold color={colorFor(latest.score)}>
            {String(latest.score)}
          </Text>
        )}
        {latest !== undefined && (
          <Text dimColor wrap="truncate-end">
            {latest.tip}
          </Text>
        )}
        {pending && <Text dimColor>scoring…</Text>}
        {error !== null && !pending && <Text color="warning">{error}</Text>}
        <Button key="hide" label="Hide" plain onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, scores)
    const latest = list[list.length - 1]
    const rows = e.viewport?.rows ?? 24
    const historyRoom = Math.max(1, rows - 12)

    if (latest === undefined) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No prompts scored yet. Prompts of {String(MIN_WORDS)}+ words are graded as you send them.</Text>
        </Box>
      )
    }

    const avg = Math.round(list.reduce((s, one) => s + one.score, 0) / list.length)
    const r = latest.rubric

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold>Latest</Text>
          <Gauge Text={Text} Box={Box} score={latest.score} />
          <Text bold color={colorFor(latest.score)}>{String(latest.score)}</Text>
          <Text dimColor>avg {String(avg)} over {String(list.length)}</Text>
        </Box>
        <Text dimColor wrap="truncate-end">"{latest.prompt}"</Text>
        <Box flexDirection="column">
          <RubricRow Text={Text} Box={Box} label="Clarity" value={r.clarity} />
          <RubricRow Text={Text} Box={Box} label="Context" value={r.context} />
          <RubricRow Text={Text} Box={Box} label="Criteria" value={r.criteria} />
          <RubricRow Text={Text} Box={Box} label="Scope" value={r.scope} />
          <RubricRow Text={Text} Box={Box} label="Constraints" value={r.constraints} />
        </Box>
        <Box flexDirection="column">
          <Text bold>Do better</Text>
          <Text>{latest.tip}</Text>
          {latest.better.map(b => (
            <Text dimColor wrap="wrap">
              {'  - '}
              {b}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text bold>History</Text>
          {list
            .slice(0, -1)
            .slice(-historyRoom)
            .reverse()
            .map(one => (
              <Box flexDirection="row" gap={1}>
                <Gauge Text={Text} Box={Box} score={one.score} cells={10} />
                <Text color={colorFor(one.score)}>{String(one.score).padStart(3)}</Text>
                <Text dimColor wrap="truncate-end">{one.prompt}</Text>
              </Box>
            ))}
        </Box>
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
    parts.push(
      i < filled ? (
        <Text color={colorFor(at)}>▰</Text>
      ) : (
        <Text dimColor>▱</Text>
      ),
    )
  }
  return <Box flexDirection="row">{parts}</Box>
}

function RubricRow(props: { Text: any; Box: any; label: string; value: number }) {
  const { Text, Box, label, value } = props
  const pct = value * 5
  return (
    <Box flexDirection="row" gap={1}>
      <Text dimColor>{label.padEnd(12)}</Text>
      <Gauge Text={Text} Box={Box} score={pct} cells={10} />
      <Text color={colorFor(pct)}>{String(value).padStart(2)}/20</Text>
    </Box>
  )
}
