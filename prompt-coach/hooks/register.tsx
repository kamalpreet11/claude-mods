import { atom, read, update } from 'claude-code'
import type { Register, Hook, Color } from 'claude-code'

import type { Recent, Rubric, Score } from '../types'

const PANE = 'prompt-coach'
const KEEP = 30
const MIN_WORDS = 6
const GAUGE_CELLS = 20

const scores = atom({ plugin: 'prompt-coach', key: 'scores' } as const, [])
const selected = atom({ plugin: 'prompt-coach', key: 'selected' } as const, null)
const recent = atom({ plugin: 'prompt-coach', key: 'recent' } as const, { prompts: [], answer: '' })
const isHidden = atom({ plugin: 'prompt-coach', key: 'isHidden' } as const, false)
const isPending = atom({ plugin: 'prompt-coach', key: 'isPending' } as const, false)
const lastError = atom({ plugin: 'prompt-coach', key: 'lastError' } as const, null)
const sessionId = atom({ plugin: 'prompt-coach', key: 'sessionId' } as const, null)

const KEEP_SESSIONS = 30

/** The store keys to drop so at most `keep` sessions stay, oldest first. */
export const staleKeys = (keys: readonly string[], keep: number): string[] => {
  const mine = keys.filter(k => k.startsWith('session:'))
  return mine.length <= keep ? [] : mine.slice(0, mine.length - keep)
}

type Saved = { scores: Score[]; recent: Recent }

/** Writes this session's history to the plugin's own store, so a resumed session gets it back. */
async function persist($: Parameters<Hook<'prompt.submit'>>[0]) {
  const id = await read($, sessionId)
  if (id === null) return
  const saved: Saved = { scores: await read($, scores), recent: await read($, recent) }
  await $.store.set(`session:${id}`, saved)
}


const RULES = `You grade prompts that a software developer sends to an AI coding assistant, inside an ongoing conversation.
You are given the conversation so far (the developer's previous prompts and the assistant's last reply) and then the new prompt. Grade the NEW prompt in that context: anything the assistant already knows from earlier turns counts as given, and a short follow-up that is unambiguous in context scores well. Do not invent a different domain than the conversation shows.
First decide the prompt's kind: "task" (asks for work: build, fix, change, write, run), "question" (asks to know or understand something), or "decision" (answers a question the assistant asked, or picks an option). Grade each kind by what a good one needs. For a question, criteria means "is it clear what a satisfying answer contains", scope means "is it one question, bounded to one thing", and constraints means "are the things that would change the answer named"; a question that the assistant can answer fully with nothing more scores 16 or more on all three. For a decision, a plain unambiguous answer scores 16 or more everywhere. Only a task is judged on files, platforms, tests and done criteria.
Score five criteria, each 0 to 20:
- clarity: is the ask unambiguous, with the task stated up front?
- context: does the assistant have what it needs (from this prompt or earlier turns): what is known, where things are, what was tried?
- criteria: is it clear what "done" looks like, how to verify, or what to return?
- scope: is the work bounded (which files, which platform, what not to touch)?
- constraints: are rules, examples, style or decisions already made named where they matter?
Scoring anchors, apply them literally: 20 = nothing more could reasonably be asked on this criterion for a task of this size; 16-19 = covered, one small thing could be sharper; 11-15 = partly covered; 5-10 = mostly missing; 0-4 = absent. A prompt that names the file or module, the symptom, what is already in use, the platform, the test to add and the command to run is 16 or more on every criterion. Do not withhold points for details the developer could not know yet (the root cause, which fix is right). Do not withhold points for brevity when the ask is already unambiguous. A follow-up that continues work agreed in earlier turns inherits the criteria, scope and constraints already established there; "keep the tests passing" names a success criterion. Leave "better" empty when nothing material is missing.
Then write "rewrite": the same ask, rewritten as the developer should have sent it, in the developer's voice, keeping their intent and length within reason (one to four sentences). Never pad with things the assistant already knows.
Answer with JSON only, no prose and no code fence:
{"kind":"task|question|decision","clarity":n,"context":n,"criteria":n,"scope":n,"constraints":n,"tip":"one sentence, under 90 characters, the single most useful change","better":["up to three short bullets on what to add or change"],"rewrite":"the improved prompt"}`

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
  const rewrite = typeof raw.rewrite === 'string' ? raw.rewrite.trim() : ''
  const kind = raw.kind === 'question' || raw.kind === 'decision' ? raw.kind : 'task'
  return { score, rubric, tip, better, rewrite, kind }
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

/** The conversation so far, as the grader reads it, then the new prompt. */
export const gradingPrompt = (ctx: Recent, text: string): string => {
  const earlier = ctx.prompts.length === 0 ? '(none)' : ctx.prompts.map((p, i) => `${i + 1}. ${p}`).join('\n')
  const answer = ctx.answer === '' ? '(none)' : ctx.answer
  return `Developer's previous prompts, oldest first:\n${earlier}\n\nAssistant's last reply (excerpt):\n${answer}\n\nNEW PROMPT to grade:\n${text}`
}

async function grade($: Parameters<Hook<'prompt.submit'>>[0], text: string, at: number) {
  await update($, isPending, () => true)
  const ctx = await read($, recent)
  const r = await $.model.complete({
    model: 'sonnet',
    effort: 'low',
    maxTokens: 700,
    timeoutMs: 25000,
    system: [{ text: RULES, cache: true }],
    prompt: gradingPrompt(ctx, text),
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
  await update($, selected, () => null)
  await persist($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const id = await $.session.id()
    await update($, sessionId, () => id)
    const saved = (await $.store.get(`session:${id}`)) as Saved | undefined
    if (saved !== undefined && Array.isArray(saved.scores)) {
      await update($, scores, () => saved.scores)
      await update($, recent, () => saved.recent ?? { prompts: [], answer: '' })
    } else {
      await $.store.set(`session:${id}`, { scores: [], recent: { prompts: [], answer: '' } })
    }
    for (const stale of staleKeys(await $.store.keys(), KEEP_SESSIONS)) await $.store.delete(stale)
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
    if (!text.trim().startsWith('/')) {
      await update($, recent, r => ({ ...r, prompts: [...r.prompts, text.replace(/\s+/g, ' ').slice(0, 300)].slice(-3) }))
    }
    if (!isGradable(text)) return next(e)

    const started = await $.clock.now()
    void grade($, text, started).catch(() => update($, isPending, () => false))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const answer = e.answer.replace(/\s+/g, ' ').slice(0, 600)
      await update($, recent, r => ({ ...r, answer }))
      await persist($)
    }

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
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, scores)
    const pick = await read($, selected)
    const shownIndex = pick !== null && pick >= 0 && pick < list.length ? pick : list.length - 1
    const latest = list[shownIndex]
    const rows = e.viewport?.rows ?? 24
    const historyRoom = Math.max(1, rows - 16)

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
          <Text bold>{shownIndex === list.length - 1 ? 'Latest' : `Prompt ${String(shownIndex + 1)}`}</Text>
          <Gauge Text={Text} Box={Box} score={latest.score} />
          <Text bold color={colorFor(latest.score)}>{String(latest.score)}</Text>
          <Text dimColor>avg {String(avg)} over {String(list.length)}</Text>
          <Text dimColor>{latest.kind}</Text>
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
        {latest.rewrite !== '' && (
          <Box flexDirection="column">
            <Text bold color="success">Try instead</Text>
            <Text wrap="wrap">{latest.rewrite}</Text>
          </Box>
        )}
        <Box flexDirection="column">
          <Text bold>History</Text>
          <Text dimColor>Pick a row to see its rubric, tip and rewrite.</Text>
          {list
            .map((one, i) => ({ one, i }))
            .slice(-historyRoom)
            .reverse()
            .map(({ one, i }) => (
              <Button key={`h${String(i)}`} plain onPress={() => update($, selected, () => i)}>
                <Text color={colorFor(one.score)}>{String(one.score).padStart(3)}</Text>
                {' '}
                <Text dimColor>{i === shownIndex ? '> ' : '  '}</Text>
                <Text dimColor={i !== shownIndex} wrap="truncate-end">{one.prompt}</Text>
              </Button>
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
