// Downloads MediaPipe model files and copies the WASM runtime into
// public/models so everything is served from OUR server (no CDN in the
// loop) and cached by the browser after the first visit.
// Run: node scripts/fetch-models.mjs

import { mkdir, writeFile, copyFile, readdir, access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = dirname(fileURLToPath(import.meta.url))
const outDir = join(root, '..', 'public', 'models')
const wasmDir = join(outDir, 'wasm')

const MODELS = [
  {
    name: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
  {
    name: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },
]

await mkdir(wasmDir, { recursive: true })

// WASM runtime ships inside the npm package — copy, don't download
const pkgWasm = join(root, '..', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
for (const file of await readdir(pkgWasm)) {
  await copyFile(join(pkgWasm, file), join(wasmDir, file))
  console.log(`copied wasm/${file}`)
}

for (const model of MODELS) {
  const dest = join(outDir, model.name)
  try {
    await access(dest)
    console.log(`${model.name} already present, skipping`)
    continue
  } catch {
    /* not downloaded yet */
  }
  console.log(`downloading ${model.name}…`)
  const res = await fetch(model.url)
  if (!res.ok) throw new Error(`Failed to fetch ${model.url}: ${res.status}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  console.log(`saved ${model.name}`)
}

console.log('models ready in frontend/public/models')

// 把 onnxruntime-web 的 wasm 复制到 /models/ort-wasm，
// 供 transformers.js（本地 Whisper）使用，避免运行时访问 CDN。
const ortWasmDir = join(outDir, 'ort-wasm')
await mkdir(ortWasmDir, { recursive: true })
const transformersDist = join(root, '..', 'node_modules', '@xenova', 'transformers', 'dist')
try {
  for (const file of await readdir(transformersDist)) {
    if (!file.endsWith('.wasm')) continue
    await copyFile(join(transformersDist, file), join(ortWasmDir, file))
    console.log(`copied ort-wasm/${file}`)
  }
} catch (e) {
  console.log('skip ort-wasm copy:', e.message)
}

// 本地 Whisper 模型（41MB）由 scripts/fetch-whisper 事先放好，
// 这里只做存在性检查，不重复下载。
try {
  await access(join(outDir, 'whisper-tiny', 'config.json'))
  console.log('whisper-tiny model present')
} catch {
  console.log('whisper-tiny model missing —— 本地语音识别将自动降级为浏览器内置识别')
}
// 复制 transformers.js 的预构建包（onnxruntime 已内联），供本地 ASR 使用
try {
  // 复制时顺手去掉 sourceMappingURL（对应的 .map 不存在，dev 下会让 Vite 报错）
  const srcFile = join(root, '..', 'node_modules', '@xenova', 'transformers', 'dist', 'transformers.min.js')
  const dstFile = join(root, '..', 'src', 'vendor', 'transformers.min.js')
  let code = await readFile(srcFile, 'utf8')
  code = code.replace(/\s*\/\/# sourceMappingURL=transformers\.min\.js\.map\s*$/, '\n')
  await writeFile(dstFile, code)
  console.log('copied transformers.min.js (sourcemap comment stripped)')
} catch (e) {
  console.log('skip transformers.min.js copy:', e.message)
}
