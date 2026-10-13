import { test, expect, mock } from 'claude-code/testing'

import { describeTurns, isVerification, parseReview, colorFor, staleKeys } from '../hooks/register'

const REVIEW = JSON.stringify({
  goal: 16, steering: 12, verification: 10, scope: 14, efficiency: 13,
  summary: 'Goal was clear from the first turn. Verification came late.',
  strengths: ['Stated the goal up front'],
  improve: ['Ask for tests before moving on'],
  wasted: [3],
  nextTime: 'Ask for a test run after every edit.',
})
const USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const PANE = { bodyColumns: 100 } as never

test('recognises test, build and lint runs', async () => {
  expect(isVerification('./gradlew :mobile:test --tests Foo')).toBe(true)
  expect(isVerification('npm test')).toBe(true)
  expect(isVerification('npx tsc -p .')).toBe(true)
  expect(isVerification('git status')).toBe(false)
  expect(isVerification('ls -la')).toBe(false)
})

test('parses the reviewer JSON and sums the rubric', async () => {
  const r = parseReview('```json\n' + REVIEW + '\n```', 12, 5)
  expect(r?.score).toBe(65)
  expect(r?.wasted).toEqual([3])
  expect(r?.improve.length).toBe(1)
  expect(parseReview('nope', 1, 0)).toBe(null)
})

test('describes a turn on one line', async () => {
  const line = describeTurns([{ n: 1, at: 0, prompt: 'fix the parser', durationMs: 12000, tools: 4, edits: 1, bash: 2, tests: 1, failures: 0, questions: 0, isAborted: false, reason: 'answer' }])
  expect(line).toBe('#1 (12s, tools 4, edits 1, shell 2, checks 1, failed 0, questions 0): "fix the parser"')
  expect(colorFor(100)).toBe('#2eb85a')
})

test('counts a turn and draws the review in the pane', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.render', async () => null)
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('command.run', async () => ({ text: '' }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('tool.call', async () => ({ result: 'ok' as never, isError: false }))
  on('model.complete', async () => ({ value: { isAnswered: true as const, text: REVIEW, usage: USAGE } }))

  await $.turn.start({ text: 'please fix the parser and run the tests', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' } as never)
  await $.turn.complete({ answer: 'done', durationMs: 9000, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  await $.command.run({ command: 'session-coach', args: '' } as never)
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const drawn = await $.ui.mount({ plugin: 'session-coach', surface, component: 'Pane', props: PANE, requestId: 'session-coach' })
    expect(await drawn.find({ text: /1 turns, 2 tools, 1 edits, 1 checks/ })).toBeTruthy()
    expect(await drawn.find({ text: /65/ })).toBeTruthy()
    expect(await drawn.find({ text: /Ask for a test run/ })).toBeTruthy()
  }
})

test('keeps only the newest sessions in the store', async () => {
  expect(staleKeys(['session:a', 'session:b', 'session:c'], 2)).toEqual(['session:a'])
  expect(staleKeys(['session:a'], 2)).toEqual([])
})
