import type { BlendshapeMap } from './tension.js'
import { tensionComposite } from './tension.js'

// Instant per-frame expression classification (no smoothing window) so the
// UI reacts the moment your face changes. Order matters: most distinctive
// expressions are checked first.

export type Expression =
  | 'happy'
  | 'content'
  | 'surprised'
  | 'sad'
  | 'confused'
  | 'thoughtful'
  | 'concerned'
  | 'tense'
  | 'neutral'

export const EXPRESSION_META: Record<Expression, { emoji: string; label: string }> = {
  happy: { emoji: '', label: '开心' },
  content: { emoji: '', label: '满意' },
  surprised: { emoji: '', label: '惊讶' },
  sad: { emoji: '', label: '失落' },
  confused: { emoji: '', label: '疑惑' },
  thoughtful: { emoji: '', label: '思考' },
  concerned: { emoji: '', label: '担忧' },
  tense: { emoji: '', label: '紧绷' },
  neutral: { emoji: '', label: '平静' },
}

const avg = (b: BlendshapeMap, ...names: string[]) =>
  names.reduce((a, n) => a + (b[n] ?? 0), 0) / names.length

export function classifyExpression(b: BlendshapeMap): Expression {
  const smile = avg(b, 'mouthSmileLeft', 'mouthSmileRight')
  const frown = avg(b, 'mouthFrownLeft', 'mouthFrownRight')
  const jawOpen = b.jawOpen ?? 0
  const browUp = avg(b, 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight')
  const browInnerUp = b.browInnerUp ?? 0
  const browDown = avg(b, 'browDownLeft', 'browDownRight')
  const browAsymmetry = Math.abs((b.browDownLeft ?? 0) - (b.browDownRight ?? 0))
  const eyesUp = avg(b, 'eyeLookUpLeft', 'eyeLookUpRight')
  const tension = tensionComposite(b)

  // Surprise: raised brows with open jaw, or a strong jaw drop
  if ((browUp > 0.4 && jawOpen > 0.2) || jawOpen > 0.45) return 'surprised'
  // Sadness: mouth corners down; inner-brow raise makes weaker frowns count
  if (frown > 0.4 || (frown > 0.22 && browInnerUp > 0.2)) return 'sad'
  if (smile > 0.35) return 'happy'
  if (smile > 0.15) return 'content'
  // One brow down, one not — the classic skeptical squint
  if (browAsymmetry > 0.25) return 'confused'
  // Eyes rolled up while composing an answer
  if (eyesUp > 0.35) return 'thoughtful'
  if (tension > 0.55) return 'tense'
  if (browDown > 0.3) return 'concerned'
  return 'neutral'
}

export function expressionMeta(e: Expression) {
  return EXPRESSION_META[e]
}
