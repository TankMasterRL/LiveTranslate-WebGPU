# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # dev server (http://localhost:5173)
npm test              # all Vitest unit/component tests, one pass
npm run test:unit     # Vitest in watch mode
npx vitest run src/lib/audio/vad.test.ts        # single test file
npx vitest run -t "hangover"                    # tests matching a name
npm run test:e2e      # Playwright (auto-builds and serves on :4173)
npm run test:docker   # full suite (check+unit+e2e) in the CI container (Dockerfile.test)
npm run check         # svelte-kit sync + svelte-check (type-check .svelte + .ts)
npm run build         # static SPA build (adapter-static, output in build/)
npm run format        # prettier
npm run screenshot    # rebuild + regenerate docs/screenshot.png (embedded in README)
```

- Vitest picks up `src/**/*.{test,spec}.ts` (jsdom, globals on, setup in `vitest-setup.ts`); Playwright specs live in `tests/e2e/` and are excluded from Vitest.
- The Silero integration test (`src/lib/audio/silero-session.integration.test.ts`) runs the **real ONNX model** vendored at `static/models/silero_vad_v5.onnx`; it runs under `@vitest-environment node` and skips itself if the model file is missing (`SILERO_MODEL_PATH` overrides the path).
- Playwright uses a preinstalled Chromium at `/opt/pw-browsers/chromium` (`PLAYWRIGHT_CHROMIUM_PATH` overrides). Do not run `playwright install`.
- CI runs the suite inside `Dockerfile.test` (official Playwright base image). **Its tag must match the `@playwright/test` version in `package-lock.json`** — bump them together.

## What this is

A browser-native port of LiveTranslate (Windows/PyQt6 real-time audio translator): live subtitles overlaid on embedded YouTube videos, with Whisper ASR and optional translation running client-side on WebGPU via transformers.js / onnxruntime-web. Fully static SPA — `ssr = false`, prerendered shell, no server code.

## Architecture: the pipeline

Everything hangs off one dataflow, orchestrated by `TranscriptionPipeline` in `src/lib/pipeline.svelte.ts`:

```
MediaStream (getDisplayMedia tab audio | mic)        src/lib/audio/source.ts
  → AudioWorklet → mono 16kHz, 512-sample frames     src/lib/audio/{capture.ts,pcm-worklet.js,resample.ts,frames.ts}
  → Vad (EnergyVad | SileroVad)                      src/lib/audio/{vad.ts,silero-vad.ts,silero-session.ts}
  → SpeechChunker (utterance chunks)                 src/lib/audio/chunker.ts
  → Whisper Web Worker (WebGPU, WASM fallback)       src/lib/asr/{whisper-worker.ts,asr-client.ts,webgpu.ts}
  → segmentsToCues (true timestamps)                 src/lib/asr/align.ts
  → Translator (optional, swappable at runtime)      src/lib/translate/*
  → SubtitleTrack (runes store)                      src/lib/subtitles/track.svelte.ts
  → SubtitleOverlay, synced to player.currentMs      src/lib/ui/SubtitleOverlay.svelte, src/lib/youtube/player.svelte.ts
```

**Every pipeline dependency is an injected seam** (`PipelineDeps`: `detect`, `requestStream`, `createCapture`, `asr`, `translator`, `vad`) with browser defaults. Tests construct the pipeline with fakes and drive PCM frames directly — see `src/lib/pipeline.test.ts` for the pattern. Preserve this: new integrations get a seam + a fake, not a mock of the browser API.

### The worker pattern (used twice, keep them mirrored)

`asr/whisper-worker.ts`↔`asr/asr-client.ts` and `translate/translate-worker.ts`↔`translate/webgpu-translator.ts` share a postMessage protocol: `load` / work message with `id` / `progress` / `ready` / `result` / `error`. Clients match results to promises by id. **Load failures must reject the pending `load()` promise** (an `error` message with no `id`) — a silent hang here was a real bug once already.

### Reactivity model

Svelte 5 runes classes live in `.svelte.ts` files (`SubtitleTrack`, `YouTubePlayer`, `TranscriptionPipeline`) exposing `$state` fields behind getters; they are unit-testable in Vitest directly. Components use `$props()`/`$bindable()`/`$derived`. The page persists settings via one `$effect` calling `savePersisted` with `$state.snapshot`.

### Timing semantics (subtle, tested)

Cue timestamps are on the _media timeline_ (`player.currentMs`). An utterance chunk emitted "now" is **backdated** by its audio duration; Whisper segments (from `return_timestamps`) become individual true-timed cues; only the **last** cue of an utterance gets its `endMs` extended to reading time (`cueDisplayMs`, ~70ms/char clamped 1.8–7s, computed from the _displayed_ text — the translation if present). `SileroVad.process()` is synchronous by returning the previous frame's decision while queueing async inference (one 32ms frame of lag, absorbed by the hangover).

## Hard constraints (these explain non-obvious code)

- **A cross-origin YouTube iframe's audio cannot be read.** Transcription requires sharing tab/system audio (`getDisplayMedia`, WASAPI-loopback analog) or the mic. Don't try to tap the embed.
- **No COOP/COEP headers, ever** — cross-origin isolation would break the YouTube embed. Consequence: no SharedArrayBuffer, so WASM paths are single-threaded (`ort.env.wasm.numThreads = 1` in `silero-session.ts`).
- **The overlay never touches the iframe's DOM.** It is a sibling absolutely positioned over the player; time comes from the IFrame Player API polled via rAF (`youtube/player.svelte.ts`).
- **No GPU in CI/headless.** Real Whisper/translation inference is manual-verification only (steps in README). Tests cover pure logic with fakes; the vendored Silero model is the one real-model automated test; a Playwright test verifies ort-web + the vendored model load in the built app by blocking huggingface.co and asserting the fallback notice does not appear.
- Whisper and translation model weights download from the Hugging Face hub at runtime (browser-cached). Silero (~2.3MB, MIT) is vendored in `static/models/` deliberately.

## Conventions

- **Red/green TDD**: write the failing test first. Pure logic gets Vitest units; components get @testing-library/svelte tests; AudioContext/Worker wiring is covered by e2e + manual verification rather than mocked unit tests.
- E2e determinism: the YouTube IFrame API is stubbed via `page.route('**/iframe_api', …)` with the shared stub in `tests/e2e/yt-stub.js`; Chromium runs with fake media-device flags (see `playwright.config.ts`).
- **README screenshot stays current**: `docs/screenshot.png` (embedded in README.md) is generated by `scripts/readme-screenshot.mjs`, which drives the built app with the shared YouTube stub and a software WebGPU adapter. After **any change that alters the web UI's appearance** — components, styles, layout, themes, visible copy — run `npm run screenshot` and commit the regenerated PNG together with the change.
- Persisted settings use `loadPersisted` (`src/lib/persist.ts`), which type-checks and deep-merges stored values over defaults — to persist a new setting, add it to the defaults object in `src/routes/+page.svelte`; stale/corrupt stored shapes degrade to defaults automatically.
- Adding a translation language: extend `LANGUAGES` in `src/lib/translate/lang.ts` (needs the NLLB FLORES code); `chooseLocalModel` decides fast-opus-mt (auto→en) vs NLLB (explicit source required).
- **Never hardcode root-relative asset URLs** — subpath deploys (`BASE_PATH` env → `kit.paths.base`) break them. Build asset URLs from `base` (`$app/paths`), but resolve `base` at the call site in browser-only code (e.g. `+page.svelte`): importing `$app/paths` from a module reached by the node-environment integration test pulls in SvelteKit's client runtime and crashes on `window`.
- Build-time env: `BASE_PATH` (subpath hosting) and `VITE_MODEL_HOST` (HF-compatible weights mirror, applied via `applyModelHost` in both workers). Model bytes fetched by URL go through `cachedFetch` (`src/lib/model-cache.ts`, Cache Storage API).

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

## PR workflow

These are the actions to perform when shepherding a PR end-to-end.
Follow them in order; skip steps only when the user explicitly
declines them.

1. **Branch.** Start from an up-to-date `main`
   (`git checkout main && git pull origin main`), then create the
   `claude/<topic>-<suffix>` branch the task specifies.
2. **Implement + validate.** Red/green TDD: write the failing test
   first. Keep changes focused on a single pipeline stage or module
   where possible; edits to shared seams (`PipelineDeps`, the worker
   message protocol, cue-timing semantics) are cross-cutting and must
   call out the blast radius. Gates before pushing: `npm test`
   (includes the real-model Silero integration test), `npm run check`,
   `npm run test:e2e`, and `npm run build` — plus a
   `BASE_PATH=x npm run build` when touching asset or model URLs, and
   `npm run screenshot` (commit the regenerated `docs/screenshot.png`)
   when the change alters the web UI's appearance.
   Changes to Whisper/translation inference paths additionally require
   the manual WebGPU verification steps in the README (CI has no GPU).
   Use the commit-message conventions above, including the
   `Assisted-by:` trailer.
3. **Push.** `git push -u origin <branch>`. Retry with exponential
   backoff (2s / 4s / 8s / 16s, up to 4 attempts) on network failures
   only.
4. **Open the PR only when asked.** PRs target
   `tankmasterrl/livetranslate-webgpu` — the GitHub MCP tools in this
   environment are scoped to that repo and calls elsewhere will be
   denied. Use a short imperative title and a body with a `## Summary`
   section and a `## Test plan` checklist. The checklist should
   enumerate what _must_ be true for the change to ship — typically:
   unit/component suite green, `svelte-check` clean, Playwright e2e
   green, plain and `BASE_PATH` builds green, and manual WebGPU
   verification when inference paths changed. **The agentic harness may
   auto-append a `_Generated by [Claude Code](...)_` footer to the PR
   body — always strip it immediately after creation via
   `update_pull_request`, as it violates the no-session-links rule
   above.**
5. **Subscribe to PR activity automatically** via
   `subscribe_pr_activity` immediately after the PR is opened — don't
   wait for the user to ask. Investigate review comments; make small
   fixes directly, ask the user when ambiguous. The PR-merged webhook
   unsubscribes on its own. CI (`.github/workflows/ci.yml`: check,
   unit, e2e) must be green before merge; manual WebGPU verification
   remains the bar for inference changes.
6. **Keep the test plan up to date continuously.** Update the PR body
   via `update_pull_request` after _every_ event that changes the
   status of a checklist item — don't batch updates to the end.
   - **Check completed:** tick the box and note how it was verified,
     e.g. `- [x] \`npm test\` green — validated on \`abc1234\``
   - **New commit pushed to the branch:** review every previously-ticked
     item; if the commit touches code that the item covers, un-tick it
     and annotate with `(re-opened by \`<sha>\`)` so the reviewer knows
     it needs re-verification on the new head.
   - **Item not exercised in this PR:** mark it
     `- [ ] <item> — N/A: <short reason>` rather than deleting it, so
     the scope of the PR remains visible to reviewers.
7. **Merge only on explicit request.** PRs are squash-merged via
   `merge_pull_request` with `merge_method: squash`. Write the squash
   commit title as the final imperative subject; put the body detail
   in the squash commit message. The `Assisted-by:` trailer must
   appear in the squash message.
8. **Clean up.** Delete any local worktree branches that are no
   longer needed after the squash-merge lands.
