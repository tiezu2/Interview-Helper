// 摄像头取流 + 画面健康检查（含多组采集参数回退）。
//
// 现实中常见问题：
//  1) 默认设备是虚拟摄像头（OBS / 手机投屏 / 远程桌面）→ 拿到流但画面是绿条纹；
//  2) 摄像头不支持某组分辨率/帧率组合 → Chrome 出绿屏或坏帧（"Only has one second image data"）；
//  3) 摄像头被其他程序占用 → NotReadableError。
// 这里按「参数阶梯」依次尝试，任一组合能出画面就用它。

export interface OpenCameraResult {
  stream: MediaStream
  video: HTMLVideoElement
  /** 实际生效的采集参数描述，便于界面显示与排错 */
  usedLabel: string
}

const FRAME_TIMEOUT = 3000

function buildAttempts(deviceId?: string): MediaStreamConstraints[] {
  const cam = (video: MediaTrackConstraints): MediaStreamConstraints => ({ video, audio: false })
  const withDevice = (v: MediaTrackConstraints): MediaTrackConstraints =>
    deviceId ? { ...v, deviceId: { exact: deviceId } } : v

  return [
    // 1) 常用 640×480 / 30fps
    cam(withDevice({ width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } })),
    // 2) 720p（有些集成摄像头在 VGA 模式下会出绿屏）
    cam(withDevice({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } })),
    // 3) 完全不约束，让浏览器自己挑
    cam(withDevice({})),
    // 4) 允许浏览器重新协商（advanced 里去掉 facingMode 等干扰项）
    cam(withDevice({ width: { ideal: 640 }, height: { ideal: 480 } })),
  ]
}

function describe(stream: MediaStream): string {
  const track = stream.getVideoTracks()[0]
  const s: any = track?.getSettings?.() ?? {}
  const size = s.width && s.height ? `${s.width}×${s.height}` : '未知分辨率'
  const fps = s.frameRate ? ` @${Math.round(s.frameRate)}fps` : ''
  return `${track?.label || '未命名设备'} · ${size}${fps}`
}

async function waitForFrame(video: HTMLVideoElement, timeoutMs: number): Promise<boolean> {
  const start = performance.now()
  return new Promise<boolean>((resolve) => {
    const check = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) return resolve(true)
      if (performance.now() - start > timeoutMs) return resolve(false)
      setTimeout(check, 100)
    }
    check()
  })
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((t) => {
    try {
      t.stop()
    } catch {
      /* ignore */
    }
  })
}

export async function openCameraWithCheck(
  video: HTMLVideoElement,
  opts: { deviceId?: string; timeoutMs?: number } = {},
): Promise<OpenCameraResult> {
  const { deviceId, timeoutMs = FRAME_TIMEOUT } = opts
  const attempts = buildAttempts(deviceId)
  const failures: string[] = []

  for (let i = 0; i < attempts.length; i++) {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia(attempts[i])
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') {
        throw new Error('摄像头权限被拒绝。请点击地址栏左侧的相机图标允许访问后重试。')
      }
      if (e?.name === 'NotFoundError' || e?.name === 'DevicesNotFoundError') {
        throw new Error('没有检测到摄像头设备。请接上摄像头，或在系统设置中启用相机。')
      }
      if (e?.name === 'NotReadableError' || e?.name === 'TrackStartError') {
        throw new Error('摄像头被其他程序占用（如微信视频、OBS、Teams）。请关闭后重试。')
      }
      failures.push(`第 ${i + 1} 组参数：${e?.name ?? 'Error'} ${e?.message ?? ''}`.trim())
      continue
    }

    video.srcObject = stream
    try {
      await video.play()
    } catch {
      /* 靠 readyState 判断 */
    }

    const ok = await waitForFrame(video, timeoutMs)
    if (ok) {
      return { stream, video, usedLabel: describe(stream) }
    }

    failures.push(`第 ${i + 1} 组参数：拿到设备但没有画面（${describe(stream)}）`)
    video.srcObject = null
    stopStream(stream)
  }

  throw new Error(
    '摄像头没有输出有效画面，已尝试多组采集参数均失败：\n' +
      failures.join('\n') +
      '\n排查建议：① 浏览器设置里关闭「使用硬件加速」后重启浏览器；' +
      '② 确认默认设备是真实摄像头（不是 OBS/投屏虚拟摄像头）；' +
      '③ Windows 设置 → 隐私和安全性 → 相机，允许桌面应用访问；' +
      '④ 换 Edge 浏览器试试。',
  )
}

// ---------- 设备枚举与偏好记忆 ----------
export interface CameraOption {
  deviceId: string
  label: string
}

export async function listCameras(): Promise<CameraOption[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `摄像头 ${i + 1}` }))
  } catch {
    return []
  }
}

const PREF_KEY = 'lia_camera_device'

export function getPreferredCameraId(): string | null {
  try {
    return localStorage.getItem(PREF_KEY)
  } catch {
    return null
  }
}

export function setPreferredCameraId(deviceId: string | null) {
  try {
    if (deviceId) localStorage.setItem(PREF_KEY, deviceId)
    else localStorage.removeItem(PREF_KEY)
  } catch {
    /* ignore */
  }
}
