// Spoken interviewer (F5) via the browser SpeechSynthesis API.
export class Interviewer {
  enabled = true

  static supported(): boolean {
    return 'speechSynthesis' in window
  }

  speak(text: string) {
    if (!this.enabled || !Interviewer.supported()) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'
    utterance.rate = 1.0
    // Prefer a natural en voice when available
    const voice = window.speechSynthesis
      .getVoices()
      .find((v) => v.lang.toLowerCase().startsWith('zh') && v.localService)
    if (voice) utterance.voice = voice
    window.speechSynthesis.speak(utterance)
  }

  stop() {
    if (Interviewer.supported()) window.speechSynthesis.cancel()
  }
}
