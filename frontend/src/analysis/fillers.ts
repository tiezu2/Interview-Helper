// 中文口头禅识别与字数统计（中文化改造 + 高亮支持）。
//
// 判定思路：
// 1) 语气词类（嗯/呃/啊/唉/哎/唔）——只要单独出现就算填充词；
// 2) 连接/指代类（那个/这个/然后/就是/其实/反正/怎么说/对吧/你知道吧）——
//    它们本身是合法词，只有「同一句内重复出现 ≥2 次」才更像口头禅，
//    此时从第 2 次起计入。

const NOISE_RE = /(嗯+|呃+|啊+|唉+|哎+|唔+)/g

const AMBIGUOUS_PATTERNS = [
  /那个/g,
  /这个/g,
  /然后/g,
  /就是/g,
  /其实/g,
  /反正/g,
  /怎么说呢?/g,
  /你知道吧/g,
  /对吧/g,
]

const SENTENCE_RE = /[^。！？!?；;\n]+/g

export interface FillerHit {
  index: number
  length: number
  text: string
}

// 返回每一处口头禅的位置，用于界面高亮
export function findFillers(text: string): FillerHit[] {
  const hits: FillerHit[] = []

  let m: RegExpExecArray | null
  NOISE_RE.lastIndex = 0
  while ((m = NOISE_RE.exec(text)) !== null) {
    hits.push({ index: m.index, length: m[0].length, text: m[0] })
  }

  SENTENCE_RE.lastIndex = 0
  while ((m = SENTENCE_RE.exec(text)) !== null) {
    const sentence = m[0]
    const offset = m.index
    for (const pattern of AMBIGUOUS_PATTERNS) {
      pattern.lastIndex = 0
      const occ: Array<{ index: number; text: string }> = []
      let p: RegExpExecArray | null
      while ((p = pattern.exec(sentence)) !== null) occ.push({ index: p.index, text: p[0] })
      if (occ.length >= 2) {
        // 第 2 次起计入口头禅
        for (let i = 1; i < occ.length; i++) {
          hits.push({
            index: offset + occ[i].index,
            length: occ[i].text.length,
            text: occ[i].text,
          })
        }
      }
    }
  }

  return hits.sort((a, b) => a.index - b.index)
}

export function countFillers(text: string): number {
  return findFillers(text).length
}

// 中文字数：汉字按 1 个字计，英文按词计；标点与空白不计。
// 这样「语速＝字/分钟」的口径与朗读中文的实际感受一致。
export function countWords(text: string): number {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)
  const cjkCount = cjk ? cjk.length : 0
  const latin = text
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
    .match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g)
  const latinCount = latin ? latin.length : 0
  return cjkCount + latinCount
}
