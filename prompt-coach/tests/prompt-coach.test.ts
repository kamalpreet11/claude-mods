import { test, expect, mock } from 'claude-code/testing'

import { colorFor, isGradable, parseGrade } from '../hooks/register'

const GRADE = JSON.stringify({
  clarity: 15, context: 10, criteria: 12, scope: 14, constraints: 11,
  tip: 'Say how to verify the result.',
  better: ['Name the files in scope', 'State what done looks like'],
})

test('skips slash commands and bare follow-ups', async () => {
  expect(isGradable('/commit')).toBe(false)
  expect(isGradable('yes do it')).toBe(false)
  expect(isGradable('please add a test for the parser and run it')).toBe(true)
})

test('parses the grader JSON and sums the rubric', async () => {
  const parsed = parseGrade('```json\n' + GRADE + '\n```')
  expect(parsed?.score).toBe(62)
  expect(parsed?.tip).toBe('Say how to verify the result.')
  expect(parsed?.better.length).toBe(2)
  expect(parseGrade('no json here')).toBe(null)
})

test('runs red to green', async () => {
  expect(colorFor(1)).toBe('#d93c3c')
  expect(colorFor(100)).toBe('#2eb85a')
  expect(colorFor(50).startsWith('#')).toBe(true)
})

const BAND = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { top: 0 }, view: { rows: 3, columns: 120 } } as never

test('a graded prompt draws the gauge, the score and the tip above the prompt', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.render', async () => null)
  on('model.complete', async () => ({
    value: {
      isAnswered: true as const,
      text: GRADE,
      usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))

  await $.prompt.submit({ text: 'please add a test for the parser and run it', wait: false })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const drawn = await $.ui.mount({ plugin: 'prompt-coach', surface, component: 'AbovePrompt', props: BAND })
    expect(await drawn.find({ text: /62/ })).toBeTruthy()
    expect(await drawn.find({ text: /verify/ })).toBeTruthy()
  }
})

test('a short prompt is not graded', async ($, on) => {
  mock.clock(on)
  let calls = 0
  on('model.complete', async () => {
    calls += 1
    return { value: { isAnswered: true as const, text: GRADE, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  })
  on('prompt.submit', async (_$, e) => ({ text: e.text }))

  await $.prompt.submit({ text: 'commit this', wait: false })
  expect(calls).toBe(0)
})
