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
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-coach': {
      scores: Score[]
      isHidden: boolean
      isPending: boolean
      lastError: string | null
    }
  }
}
