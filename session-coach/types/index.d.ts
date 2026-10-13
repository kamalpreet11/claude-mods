export type Turn = {
  n: number
  at: number
  prompt: string
  durationMs: number
  tools: number
  edits: number
  bash: number
  tests: number
  failures: number
  questions: number
  isAborted: boolean
  reason: string
}

export type Current = {
  turnId: string
  prompt: string
  tools: number
  edits: number
  bash: number
  tests: number
  failures: number
  questions: number
}

export type Review = {
  at: number
  turns: number
  score: number
  summary: string
  strengths: string[]
  improve: string[]
  wasted: number[]
  nextTime: string
}

declare module 'claude-code' {
  interface PluginState {
    'session-coach': {
      turns: Turn[]
      current: Current | null
      review: Review | null
      sessionId: string | null
      isReviewing: boolean
      lastError: string | null
    }
  }
}
