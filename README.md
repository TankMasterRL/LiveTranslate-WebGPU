# LiveTranslate WebGPU

A browser-native port of [**LiveTranslate**](https://github.com/TheDeathDragon/LiveTranslate)
(a Windows/PyQt6 real-time audio translator) to **SvelteKit + Svelte 5**, running
**Whisper speech recognition entirely client-side on WebGPU** via
[transformers.js](https://huggingface.co/docs/transformers.js) / ONNX Runtime Web.

It overlays live subtitles on top of embedded **YouTube** videos — the same
"port a PyTorch model to the browser with WebGPU" approach Simon Willison used in
[Porting the Moebius model](https://simonwillison.net/2026/Jun/22/porting-moebius/).

## Pipeline

The original desktop pipeline is reproduced with browser primitives:

| LiveTranslate (desktop)      | This port (browser)                                   |
| ---------------------------- | ----------------------------------------------------- |
| WASAPI loopback (system audio) | `getDisplayMedia` tab/system audio · or microphone  |
| Silero VAD                   | energy VAD with hangover (`src/lib/audio/vad.ts`)     |
| faster-whisper ASR           | Whisper on **WebGPU** in a Web Worker (`src/lib/asr`) |
| OpenAI-compatible LLM translate | `Translator` seam: identity / OpenAI-compatible API |
| PyQt transparent overlay     | positioned Svelte overlay on the YouTube embed        |

```
capture → frames → VAD → speech chunker → Whisper (WebGPU worker) → [translate] → subtitle track → overlay
```

## Why you must share tab/mic audio

A cross-origin YouTube `<iframe>`'s audio **cannot be read directly** from the page.
To transcribe what's playing you share the **tab's audio** via `getDisplayMedia`
(the browser-legal analog of WASAPI loopback), or use the microphone. The subtitle
overlay is a sibling element positioned over the player; timing comes from the
**YouTube IFrame Player API**.

## Requirements

- A **WebGPU-capable browser** (Chrome/Edge; Firefox Nightly / Safari TP). Without
  WebGPU the app falls back to WASM (slower). The UI shows which backend is active.
- First run downloads the Whisper weights from Hugging Face (browser-cached
  thereafter).

## Getting started

```bash
npm install
npm run dev            # http://localhost:5173
```

1. Paste a YouTube URL and **Load video**.
2. Click **Preview subtitle overlay** to see the overlay with demo cues, or
3. **Start transcription**, pick *Tab / system audio* (share this tab **with audio**)
   or *Microphone*, and live subtitles appear over the video.

## Testing (red/green TDD)

The DSP and app logic are covered by fast unit/component tests; the
WebGPU/Worker/AudioContext wiring is exercised by e2e + manual verification.

```bash
npm test          # Vitest unit + component tests
npm run test:e2e  # Playwright (YouTube API stubbed — no network)
npm run check     # svelte-check
npm run build     # static SPA (adapter-static)
```

## Project layout

```
src/lib/
  subtitles/  cue model, active-cue selection, reactive SubtitleTrack store
  audio/      capture (AudioWorklet), resample, framing, energy VAD, speech chunker
  asr/        WebGPU detection, transcript cleanup, Whisper worker + client
  translate/  Translator interface, identity + OpenAI-compatible adapters
  youtube/    IFrame Player API wrapper, URL parsing, embed component
  ui/         SubtitleOverlay, Controls, TranscribePanel, themes
  pipeline.svelte.ts   reactive orchestrator wiring it all together
```

## Roadmap

- **Translation on WebGPU**: wire a client-side translation model (NLLB / Opus-MT)
  behind the existing `Translator` seam, plus the OpenAI-compatible API path.
- Silero-ONNX VAD as a drop-in upgrade for the energy VAD.
- Per-cue timestamp alignment from Whisper chunk timestamps.

## Credits

Ported from [TheDeathDragon/LiveTranslate](https://github.com/TheDeathDragon/LiveTranslate).
