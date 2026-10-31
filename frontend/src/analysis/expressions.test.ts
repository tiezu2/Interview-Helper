import { describe, it, expect } from 'vitest'
import { classifyExpression, EXPRESSION_META, type Expression } from './expressions.js'

describe('instant expression classifier', () => {
  it('classifies a broad smile as happy', () => {
    expect(classifyExpression({ mouthSmileLeft: 0.6, mouthSmileRight: 0.5 })).toBe('happy')
  })

  it('classifies raised brows + open jaw as surprised', () => {
    expect(
      classifyExpression({
        browInnerUp: 0.6,
        browOuterUpLeft: 0.5,
        browOuterUpRight: 0.5,
        jawOpen: 0.3,
      }),
    ).toBe('surprised')
    expect(classifyExpression({ jawOpen: 0.6 })).toBe('surprised')
  })

  it('surprise wins over smile when both fire', () => {
    expect(
      classifyExpression({
        mouthSmileLeft: 0.5,
        mouthSmileRight: 0.5,
        jawOpen: 0.6,
      }),
    ).toBe('surprised')
  })

  it('classifies mouth-corners-down as sad', () => {
    expect(classifyExpression({ mouthFrownLeft: 0.5, mouthFrownRight: 0.45 })).toBe('sad')
  })

  it('classifies weak frown + inner-brow raise as sad (classic sadness AU)', () => {
    expect(
      classifyExpression({ mouthFrownLeft: 0.25, mouthFrownRight: 0.25, browInnerUp: 0.3 }),
    ).toBe('sad')
  })

  it('a weak frown alone stays neutral', () => {
    expect(classifyExpression({ mouthFrownLeft: 0.25, mouthFrownRight: 0.25 })).toBe('neutral')
  })

  it('classifies a mild smile as content, strong as happy', () => {
    expect(classifyExpression({ mouthSmileLeft: 0.22, mouthSmileRight: 0.2 })).toBe('content')
    expect(classifyExpression({ mouthSmileLeft: 0.5, mouthSmileRight: 0.5 })).toBe('happy')
  })

  it('classifies asymmetric brow as skeptical/confused', () => {
    expect(classifyExpression({ browDownLeft: 0.5, browDownRight: 0.1 })).toBe('confused')
  })

  it('classifies eyes rolled up as thoughtful', () => {
    expect(classifyExpression({ eyeLookUpLeft: 0.5, eyeLookUpRight: 0.4 })).toBe('thoughtful')
  })

  it('classifies clenched features as tense', () => {
    expect(
      classifyExpression({
        browDownLeft: 0.7,
        browDownRight: 0.7,
        jawClench: 0.8,
        mouthPressLeft: 0.7,
        mouthPressRight: 0.7,
        eyeSquintLeft: 0.6,
        eyeSquintRight: 0.6,
      }),
    ).toBe('tense')
  })

  it('classifies moderate brow-down as concerned', () => {
    expect(classifyExpression({ browDownLeft: 0.4, browDownRight: 0.4 })).toBe('concerned')
  })

  it('defaults to neutral on a relaxed face', () => {
    expect(classifyExpression({})).toBe('neutral')
    expect(classifyExpression({ mouthSmileLeft: 0.1, browDownLeft: 0.05 })).toBe('neutral')
  })

  it('every expression has a label（界面已不使用 emoji）', () => {
    for (const key of Object.keys(EXPRESSION_META) as Expression[]) {
      expect(EXPRESSION_META[key].label.length).toBeGreaterThan(0)
      expect(EXPRESSION_META[key].emoji).toBe('')
      expect(EXPRESSION_META[key].label.length).toBeGreaterThan(0)
    }
  })
})
