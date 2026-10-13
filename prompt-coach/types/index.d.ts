export type Rubric = {
  clarity: number
  context: number
  criteria: number
  scope: number
  constraints: number
}

export type Score = {
  at: number
  prompt: string
  score: number
  rubric: Rubric
  tip: string
  better: string[]
  rewrite: string
  kind: 'task' | 'question' | 'decision'
}

export type Recent = {
  prompts: string[]
  answer: string
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-coach': {
      scores: Score[]
      selected: number | null
      recent: Recent
      sessionId: string | null
      isHidden: boolean
      isPending: boolean
      lastError: string | null
    }
  }
}
