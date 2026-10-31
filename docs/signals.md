# Signal math — weights and formulas

All live analysis runs client-side (edge-first, CD3). The browser computes per-frame
signals, aggregates them into 1-second summaries, and streams only those summaries to
the server. This file documents the exact math so weights can be tuned deliberately.

## 1. Eye contact & gaze (`frontend/src/analysis/gaze.ts`)

- **Eye contact**: iris center (landmarks 468/473) deviation from the eye-corner
  midpoint, normalized by eye width. Both eyes must be within a tolerance cone of
  **0.18 × eye width** to count as looking at the camera.
- **Blink**: eye aspect ratio (lid gap ÷ eye width, averaged over both eyes). A dip
  below **0.18** is a closure; blinks count once per closing edge.
- Session-level: eye-contact % = share of 1s windows where the majority of frames had
  eye contact. Blink rate = blinks ÷ session minutes.

## 2. Facial tension composite (`tension.ts`)

Weighted blendshape sum, normalized to 0–1:

| Blendshape | Weight |
|---|---|
| browDownLeft / browDownRight | 0.15 each |
| jawClench | 0.20 |
| mouthPressLeft / mouthPressRight | 0.125 each |
| eyeSquintLeft / eyeSquintRight | 0.125 each |

Expression label: smile blendshapes > 0.3 → *positive*; brow-down > 0.3 → *concerned*;
otherwise *neutral*.

## 3. Movement / fidget (`fidget.ts`)

- Head movement: mean per-frame nose-tip displacement over a 30-frame window, scaled so
  **0.01 normalized units/frame ⇒ 1.0**.
- Hand-near-face: any hand landmark within **0.25** normalized units of the nose tip.
- Fidget score = `0.7 × movement + 0.3 × hand-near-face ratio` (clamped 0–1).

## 4. Voice (`voiceMetrics.ts`)

- **Volume**: RMS of the time-domain buffer, sampled ~10×/s. Speaking threshold 0.01.
- **Pitch**: autocorrelation over 70–400 Hz; unvoiced frames return null.
- **Pitch variation**: coefficient of variation (σ/μ) over the last ~10s of voiced
  frames. Higher = more expressive, monotone ≈ < 0.05.
- **Pace**: words-per-minute over the trailing 60s of transcribed words.
- **Pause**: continuous silence duration below the volume threshold.

## 5. Speech (`fillers.ts`)

Filler patterns: um, uh, er(m), hmm, like, you know, basically, actually, kind of,
sort of, i mean. Filler density = fillers per 100 words.

## Report scores (`backend/src/services/report/scores.ts`)

Per-signal 0–100:

- expression = 100 − avgTension×100
- eyeContact = eye-contact %
- stillness = 100 − avgFidget×100
- voice = 0.6×pace + 0.4×pitch, where pace peaks at **135 wpm** and pitch score =
  pitchVar×200 (capped)
- speech = 100 − fillerDensity×10 (5 fillers/100 words ⇒ 50)

**Overall** = 0.20 expression + 0.25 eyeContact + 0.15 stillness + 0.20 voice + 0.20 speech.

## 6. Mood & nervousness (`mood.ts`)

**Nervousness composite** (0–1), updated every second over a rolling 30s window:

| Input | Weight |
|---|---|
| tension composite | 0.35 |
| fidget score | 0.25 |
| gaze-away ratio | 0.20 |
| blink rate above 20/min (saturates at 45/min) | 0.12 |
| pause/hesitation ratio (when available) | 0.08 |

**Mood classification** (checked in order; smile/tension/gaze react over the last 5s,
nervousness over 30s):

| Mood | Condition |
|---|---|
| 😰 nervous | nervousness > 0.65 |
| 😬 tense | tension > 0.55 |
| 😎 confident | smile > 0.35 AND eye contact AND nervousness < 0.35 |
| 😊 positive | smile > 0.25 |
| 🙂 calm | tension < 0.3 AND nervousness < 0.4 |
| 😐 flat | everything else |

Mood is a delivery-coaching label describing how the person *comes across* — it is
never a judgment of the person, and like every signal it stays out of verdict territory.

## 6b. Instant expressions (`expressions.ts`)

Per-frame classification (no smoothing — updates ~4×/s in the UI), checked in order:

| Expression | Condition |
|---|---|
| 😮 surprised | brows up > 0.4 with jaw open > 0.2, or jaw open > 0.45 |
| 😢 sad | mouth frown > 0.4, or frown > 0.22 with inner-brow raise > 0.2 |
| 😄 happy | smile > 0.35 |
| 🙂 content | smile > 0.15 |
| 🤨 skeptical | brow asymmetry > 0.25 |
| 🤔 thinking | eyes-up gaze > 0.35 |
| 😬 tense | tension composite > 0.55 |
| 😟 concerned | brow-down > 0.3 |
| 😐 neutral | everything else |

**Framing guidance** (`framing.ts`): face width from cheek-edge landmarks (234/454) —
< 0.15 too far, > 0.55 too close; nose display-x outside 0.32–0.68 → shift left/right
(mirrored for the preview); nose y outside 0.26–0.76 → camera height cue; nose-to-cheek
distance ratio outside 0.5–2.0 → "turn to face the camera". Problems must persist 1s
before showing; good framing clears the message instantly.

Models are self-hosted under `/models` (fetched by `frontend/scripts/fetch-models.mjs`,
run automatically before dev/build); the CDN is only a fallback. All inference stays
in the browser — see CD3 in the plan for why live video never streams to the server.

## 7. Posture (`posture.ts`)

From PoseLandmarker (lite model, sampled at 2 fps): nose (0), shoulders (11/12).

- head height ratio = (shoulder-mid Y − nose Y) ÷ shoulder width; uprightness =
  clamp((ratio − 0.25) / 0.4). Upright ≈ 0.55–0.9, slouched/dropped < 0.35.
- tilt penalty = clamp((|leftY − rightY| ÷ width − 0.08) / 0.25); final score =
  uprightness × (1 − 0.5 × tiltPenalty). Rolling 10-sample average.
- Pose model failure never blocks a session — posture is simply omitted.

## 8. Vocal energy (`voiceMetrics.ts` / backend `scores.ts`)

energy = 0.6 × pitch expressiveness + 0.4 × volume dynamics, where volume dynamics =
coefficient of variation of above-threshold volumes. Monotone < 25/100, expressive > 55/100.

## 9. Answer quality (`backend/services/report/answers.ts`)

Per-question segments (windows tagged with `questionOrder`) get heuristic analysis:

- STAR cues — situation (/when i|at my|there was a time/…), action (/so i|i decided|i led/…),
  result (/as a result|the outcome|it improved/…); structureScore = detected ÷ 3 × 100.
- Length: < 40 words too short, > 350 long. Filler density per answer.
- The LLM (when configured) writes 2–3 sentences of coaching per answer on top of the
  heuristics; output is post-checked against the banned-verdict list, falling back to the
  heuristic notes.

## Nudges (`nudges.ts`)

Rules fire on a rolling 5s window, max one nudge per 20s, wording always supportive:

| Rule | Trigger |
|---|---|
| eye-contact | ≥4 samples, all gaze-away |
| fidgeting | ≥4 samples, fidget > 0.6 |
| pace-fast | ≥4 speaking samples, wpm > 180 |
| posture | ≥4 samples, posture < 0.4 |
| volume-low | ≥4 speaking samples, volume < 0.02 |
