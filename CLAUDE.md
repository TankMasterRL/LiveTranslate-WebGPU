# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Toolchain

- **Bun is the package manager and script runner only** — Vitest and Playwright remain the test runners. Always `bun run test`, never `bun test` (that invokes Bun's built-in test runner, which cannot run this suite).

- The Silero integration test (`src/lib/audio/silero-session.integration.test.ts`) runs the **real ONNX model** downloaded to the gitignored `.model-cache/silero_vad_v5.onnx` by `bun run fetch:models` (`SILERO_MODEL_PATH` overrides the path); it runs under `@vitest-environment node` and skips itself if the model file is missing. `Dockerfile.test` runs the fetch at image build, so CI always exercises it.
- Playwright uses a preinstalled Chromium at `/opt/pw-browsers/chromium` (`PLAYWRIGHT_CHROMIUM_PATH` overrides). Do not run `playwright install`.
- CI runs the suite inside `Dockerfile.test` (official Playwright base image, with the Bun binary copied in from `oven/bun`). **Its tag must match the `@playwright/test` version in `bun.lock`** — bump them together.

## Architecture: the pipeline

Everything hangs off one dataflow, orchestrated by `TranscriptionPipeline` in `src/lib/pipeline.svelte.ts`:

```
MediaStream (getDisplayMedia tab audio | mic)        src/lib/audio/source.ts
  → AudioWorklet → mono 16kHz, 512-sample frames     src/lib/audio/{capture.ts,pcm-worklet.js,resample.ts,frames.ts}
  → Vad (EnergyVad | SileroVad)                      src/lib/audio/{vad.ts,silero-vad.ts,silero-session.ts}
  → SpeechChunker (utterance chunks)                 src/lib/audio/chunker.ts
  → ASR Web Worker (WebGPU, WASM fallback)           src/lib/asr/{factory.ts,worker-asr-client.ts,webgpu.ts}
      Whisper via transformers.js                    src/lib/asr/{whisper-worker.ts,asr-client.ts}
      Nemotron 3.5 streaming via onnxruntime-web     src/lib/asr/{nemotron-worker.ts,nemotron-client.ts,nemotron/*}
  → segmentsToCues (true timestamps)                 src/lib/asr/align.ts
  → Translator (optional, swappable at runtime)      src/lib/translate/*
  → SubtitleTrack (runes store)                      src/lib/subtitles/track.svelte.ts
  → SubtitleOverlay, synced to player.currentMs      src/lib/ui/SubtitleOverlay.svelte, src/lib/youtube/player.svelte.ts
```

**Every pipeline dependency is an injected seam** (`PipelineDeps`: `detect`, `requestStream`, `createCapture`, `asr`, `translator`, `vad`) with browser defaults. Tests construct the pipeline with fakes and drive PCM frames directly — see `src/lib/pipeline.test.ts` for the pattern. Preserve this: new integrations get a seam + a fake, not a mock of the browser API.

### The worker pattern (keep the protocols mirrored)

The ASR workers (`asr/whisper-worker.ts` and `asr/nemotron-worker.ts`, both driven by the shared client in `asr/worker-asr-client.ts` behind `WhisperClient`/`NemotronClient`) and `translate/translate-worker.ts`↔`translate/webgpu-translator.ts` share a postMessage protocol: `load` / work message with `id` / `progress` / `ready` / `result` / `error`. Clients match results to promises by id. **Load failures must reject the pending `load()` promise** (an `error` message with no `id`) — a silent hang here was a real bug once already.

The Nemotron path (`asr/nemotron/`) is not served by transformers.js (unsupported architecture); its worker drives three onnxruntime-web sessions directly — encoder on the pipeline's backend, decoder+joint pinned to WASM because the greedy RNN-T loop runs them once per emitted token and per-call GPU dispatch/readback would dominate. On the webgpu backend `nemotron/session.ts` loads ort from `onnxruntime-web/jspi` (the native WebGPU EP): the default build's JSEP Concat kernel binds one storage buffer per input, and the encoder's 24-input cache concat exceeds every grantable `maxStorageBuffersPerShaderStage`, failing WebGPU validation and corrupting the streaming cache. The jspi build needs WebAssembly JSPI (Chrome/Edge 137+); without it the load rejects with an actionable error rather than falling back to the broken JSEP path. The wasm backend keeps the default build. The decode logic (`nemotron/engine.ts`) takes the sessions as injected step functions and is unit-tested with fakes; only `nemotron/session.ts` touches ort.

The encoder's **streaming chunk size** is a runtime knob (`NEMOTRON_CHUNK_SIZES` in `nemotron/model.ts`: the model card's 80/160/320/560/1120ms operating points, all served by the one export because the cache shapes don't depend on it — only the `audio_signal` time axis does). It is not a latency control in this port, since the pipeline decodes a whole VAD utterance per `transcribe` call; it sets the cost per second of audio, because every step re-uploads and reads back the whole streaming cache. `ChunkSizeController` (`nemotron/chunk-size.ts`) owns the policy: a fixed setting, or `'auto'`, which widens the chunk as soon as a `transcribe` message arrives with a non-zero `backlog` (utterances queued behind it in `AsrWorkerClient` — the engine running slower than real time) and steps back after four clean utterances, never below the export's native 560ms. Only the native size is known-good against the real weights, so a step that throws at any other size retries the utterance at 560ms and pins the controller there for the session.

### Reactivity model

Svelte 5 runes classes live in `.svelte.ts` files (`SubtitleTrack`, `YouTubePlayer`, `TranscriptionPipeline`) exposing `$state` fields behind getters; they are unit-testable in Vitest directly. Components use `$props()`/`$bindable()`/`$derived`. The page persists settings via one `$effect` calling `savePersisted` with `$state.snapshot`.

### Timing semantics (subtle, tested)

Cue timestamps are on the _media timeline_ (`player.currentMs`). An utterance chunk emitted "now" is **backdated** by its audio duration; Whisper segments (from `return_timestamps`) become individual true-timed cues; only the **last** cue of an utterance gets its `endMs` extended to reading time (`cueDisplayMs`, ~70ms/char clamped 1.8–7s, computed from the _displayed_ text — the translation if present). `SileroVad.process()` is synchronous by returning the previous frame's decision while queueing async inference (one 32ms frame of lag, absorbed by the hangover).

## Hard constraints (these explain non-obvious code)

- **A cross-origin YouTube iframe's audio cannot be read.** Transcription requires sharing tab/system audio (`getDisplayMedia`, WASAPI-loopback analog) or the mic. Don't try to tap the embed.
- **No COOP/COEP headers, ever** — cross-origin isolation would break the YouTube embed. Consequence: no SharedArrayBuffer, so WASM paths are single-threaded (`ort.env.wasm.numThreads = 1` in `silero-session.ts`).
- **The overlay never touches the iframe's DOM.** It is a sibling absolutely positioned over the player; time comes from the IFrame Player API polled via rAF (`youtube/player.svelte.ts`).
- **No GPU in CI/headless.** Real Whisper/translation inference is manual-verification only (steps in README). Tests cover pure logic with fakes; the fetched Silero model is the one real-model automated test; a Playwright test verifies ort-web + the real model load in the built app by serving the `.model-cache/` bytes at the exact hub URL the app requests while blocking the rest of huggingface.co, and asserting the fallback notice does not appear.
- **No model files are stored in the repo.** All model weights — Whisper, Nemotron, translation, and Silero VAD (~2.3MB, MIT) — download from the Hugging Face hub at runtime into the browser's Cache Storage model cache. Tests that need the real Silero model fetch it to the gitignored `.model-cache/` via `bun run fetch:models`; its URL in `scripts/fetch-silero.mjs` must stay in sync with `sileroModelUrl` (`src/lib/audio/silero-model.ts`).
- **The Silero download is integrity-pinned.** `sileroModelSha256` (`silero-model.ts`) is the SHA-256 of the file served by the pinned hub URL (onnx-community's v5 export — not byte-identical to the upstream snakers4 release; see the comment on the constant); `cachedFetch` rejects (and never caches) bytes that don't match, and drops+refetches a cached copy that stops matching. `scripts/fetch-silero.mjs` enforces the same pin, and the integration test asserts the fetched file matches `sileroModelSha256` — so the two pinned copies can't drift apart silently. To upgrade the model: verify the new file out-of-band, then update both pins together.
- **The Nemotron downloads are pinned the same way** (`NEMOTRON_FILES` in `src/lib/asr/nemotron/model.ts`, one SHA-256 per file; the `.onnx`/`.data` pins are the upstream Git LFS oids, which are content SHA-256s). At ~790MB total the files are far too large for a fetched-model automated test, so real Nemotron inference — like Whisper's — is manual WebGPU verification only; the decode logic is covered by unit tests with fake sessions.

## Conventions

- **Red/green TDD**: write the failing test first. Pure logic gets Vitest units; components get @testing-library/svelte tests; AudioContext/Worker wiring is covered by e2e + manual verification rather than mocked unit tests.
- E2e determinism: the YouTube IFrame API is stubbed via `page.route('**/iframe_api', …)` with the shared stub in `tests/e2e/yt-stub.js`; Chromium runs with fake media-device flags (see `playwright.config.ts`).
- **README screenshot stays current**: `docs/screenshot.png` (embedded in README.md) is generated by `scripts/readme-screenshot.mjs`, which drives the built app with the shared YouTube stub and a software WebGPU adapter. After **any change that alters the web UI's appearance** — components, styles, layout, themes, visible copy — run `bun run screenshot` and commit the regenerated PNG together with the change.
- Persisted settings use `loadPersisted` (`src/lib/persist.ts`), which type-checks and deep-merges stored values over defaults — to persist a new setting, add it to the defaults object in `src/routes/+page.svelte`; stale/corrupt stored shapes degrade to defaults automatically.
- Adding a translation language: extend `LANGUAGES` in `src/lib/translate/lang.ts` (needs the NLLB FLORES code); `chooseLocalModel` decides fast-opus-mt (auto→en) vs NLLB (explicit source required).
- **Never hardcode root-relative asset URLs** — subpath deploys (`BASE_PATH` env → `kit.paths.base`) break them. Build asset URLs from `base` (`$app/paths`), but resolve `base` at the call site in browser-only code (e.g. `+page.svelte`): importing `$app/paths` from a module reached by the node-environment integration test pulls in SvelteKit's client runtime and crashes on `window`.
- Build-time env: `BASE_PATH` (subpath hosting) and `VITE_MODEL_HOST` (HF-compatible weights mirror, applied via `applyModelHost` in both workers and in `sileroModelUrl`). Model bytes fetched by URL go through `cachedFetch` (`src/lib/model-cache.ts`, Cache Storage API).

## Branching & commit conventions

- Develop on a `claude/<topic>-<suffix>` branch (e.g.
  `claude/livetranslate-sveltekit-port-nyjf7i`).
- Branches are **fast-forward merged** into `main`
  (`git checkout main && git merge <branch>`). This keeps the history
  linear and bisectable. If the branch is behind `main`, rebase it
  first (`git rebase main`) rather than creating a merge commit.
  _(Transitional: until PR #1 lands, the base branch is `baseline`;
  rename it to `main` after merging, then delete this note.)_
- **Pull requests are squash-merged.** When a PR lands via GitHub, all
  commits on the branch are squashed into a single commit on `main`.
  Write the PR title as if it were the final commit message (imperative,
  concise) and use the PR body for detail.
- Commit messages: imperative, single-line subject, optional body
  explaining _why_ (e.g. why a pipeline seam, worker-protocol shape, or
  timing semantic was chosen). The human submitter is responsible for
  reviewing all AI-generated code, compliance, and taking responsibility
  for the contribution. Only humans can use "Signed-off", and the AI
  tools must be reported with the "Assisted-by" tag, e.g.
  `Assisted-by: Claude:<model>` or `Assisted-by: Claude Code`. Don't
  include any references to session links from agentic coding tools,
  e.g. `https://claude.ai/code/…`. (Commits predating this convention
  carry older trailers — do not rewrite history to fix them.)
- **Never** push directly to `main` from a working branch — always
  merge via the local `git checkout main && git merge <branch>` flow
  or open a pull request.

## Pull requests

- PRs target `tankmasterrl/livetranslate-webgpu` and are
  **squash-merged**. Write the PR title as the final commit message.
- **Merge only on explicit request** — never merge a PR on your own
  initiative.
- Full workflow (branch → validation gates → PR body template and its
  live test-plan checklist → squash merge → branch cleanup): the
  **`pr-workflow` skill** (`.claude/skills/pr-workflow/SKILL.md`).
