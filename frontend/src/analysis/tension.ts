// Facial tension composite from FaceLandmarker blendshapes (0-1 each).
// Weights documented in docs/signals.md.

export interface BlendshapeMap {
  [name: string]: number
}

const TENSION_WEIGHTS: Record<string, number> = {
  browDownLeft: 0.15,
  browDownRight: 0.15,
  jawClench: 0.2,
  mouthPressLeft: 0.125,
  mouthPressRight: 0.125,
  eyeSquintLeft: 0.125,
  eyeSquintRight: 0.125,
}

export function tensionComposite(blendshapes: BlendshapeMap): number {
  let score = 0
  let totalWeight = 0
  for (const [name, weight] of Object.entries(TENSION_WEIGHTS)) {
    if (name in blendshapes) {
      score += blendshapes[name] * weight
      totalWeight += weight
    }
  }
  if (totalWeight === 0) return 0
  return Math.min(1, score / totalWeight)
}

// Dominant expression from the standard blendshape set, for the live meter label
const EXPRESSION_SHAPES = ['mouthSmileLeft', 'mouthSmileRight', 'browInnerUp', 'browDownLeft', 'browDownRight']

export function dominantExpression(blendshapes: BlendshapeMap): 'positive' | 'concerned' | 'neutral' {
  const smile = ((blendshapes.mouthSmileLeft ?? 0) + (blendshapes.mouthSmileRight ?? 0)) / 2
  const frown = ((blendshapes.browDownLeft ?? 0) + (blendshapes.browDownRight ?? 0)) / 2
  if (smile > 0.3 && smile > frown) return 'positive'
  if (frown > 0.3) return 'concerned'
  return 'neutral'
}
