# Evaluation: Sipp as a replacement for the inference runtime

- **Date:** 2026-07-04
- **Subject:** [noumena-labs/Sipp](https://github.com/noumena-labs/Sipp) v0.1.1 (released 2026-07-01)
- **Verdict: not viable as a replacement.** Sipp covers none of the three model
  classes this app runs, and its browser runtime requires cross-origin
  isolation — the one deployment property this project can never adopt.
  A narrow future role (LLM-based translation behind the existing `Translator`
  seam) is possible but blocked today; see [Re-evaluation triggers](#re-evaluation-triggers).

## What "the current runtime" actually is

The app runs three model classes on two runtimes, split deliberately by who
fetches the model bytes:

| Pipeline stage | Model | Architecture | Runtime | Where |
| --- | --- | --- | --- | --- |
| ASR | `onnx-community/whisper-base` | encoder–decoder speech (Whisper) | transformers.js, WebGPU with q8-WASM fallback, in a Web Worker | `src/lib/asr/whisper-worker.ts` |
| Translation (local mode) | `Xenova/opus-mt-mul-en` / `Xenova/nllb-200-distilled-600M` | Marian / NLLB seq2seq | transformers.js, WebGPU with q8-WASM fallback, in a Web Worker | `src/lib/translate/translate-worker.ts` |
| VAD | Silero v5 (~2.3 MB ONNX LSTM) | recurrent classifier | onnxruntime-web, single-threaded WASM | `src/lib/audio/silero-session.ts` |

transformers.js fetches and caches Whisper/translation weights itself (host
redirectable via `VITE_MODEL_HOST`); the Silero bytes are fetched by the app
through the integrity-pinned `cachedFetch` (`src/lib/model-cache.ts`,
`sileroModelSha256` in `src/lib/audio/silero-model.ts`).

## What Sipp is

Sipp is an inference framework built on a vendored [llama.cpp](https://github.com/ggml-org/llama.cpp)
behind a Rust/C++ layer, exposed to browsers through an Emscripten WASM +
WebGPU runtime (`@sipphq/sipp`), plus Node/Rust/Python bindings and a
cloud-gateway routing layer. It runs **GGUF** models and its API surface is
`chat` / `query` / `embed`: decoder-only text LLMs, embeddings, and vision-chat
(model GGUF + projector GGUF). Self-reported LLM benchmarks (24.3 ms TTFT,
77 tok/s decode) position it against WebLLM and transformers.js —
*for LLM text generation*.

Maturity at time of writing: v0.1.1, two releases, ~72 stars, README warns
"Sipp is under active development. Breaking changes are expected."

Sources: the repo [README](https://github.com/noumena-labs/Sipp),
[`docs/en/architecture.md`](https://github.com/noumena-labs/Sipp/blob/master/docs/en/architecture.md),
[`docs/en/roadmap.md`](https://github.com/noumena-labs/Sipp/blob/master/docs/en/roadmap.md),
[`docs/en/packages/browser.md`](https://github.com/noumena-labs/Sipp/blob/master/docs/en/packages/browser.md),
[`docs/en/reference/runtime-options.md`](https://github.com/noumena-labs/Sipp/blob/master/docs/en/reference/runtime-options.md),
[`docs/en/getting-started/models-backends.md`](https://github.com/noumena-labs/Sipp/blob/master/docs/en/getting-started/models-backends.md).

## Why it cannot replace the current runtime

Four independent blockers; any one alone would be disqualifying.

### 1. No Whisper, no audio models at all

The ASR stage is the heart of the app, and Whisper is an encoder–decoder
*speech* model. Sipp's docs, API (`chat`/`query`/`embed`), and roadmap contain
no audio, ASR, or speech support of any kind. whisper.cpp is a separate ggml
project that Sipp does not vendor — "GGUF support" does not imply Whisper
support. Replacing transformers.js for ASR is simply not possible.

### 2. No seq2seq translation architectures

Local translation uses Marian (opus-mt) and NLLB models. llama.cpp — Sipp's
engine — supports neither architecture, and Sipp exposes no translation
workflow. (llama.cpp has partial T5 support upstream, but Sipp's documented
text workflow is chat-style decoder-only generation.)

### 3. No ONNX

Sipp runs GGUF exclusively. The Silero VAD is an ONNX graph with no GGUF
counterpart, so the onnxruntime-web dependency cannot be dropped. At best Sipp
would be a *third* runtime shipped alongside both existing ones — the opposite
of a replacement.

### 4. Its browser runtime requires cross-origin isolation

Per Sipp's own docs (`docs/en/packages/browser.md`,
`docs/en/reference/runtime-options.md`): the packaged browser runtime assets
use pthreads, so browser-local inference "needs `SharedArrayBuffer` and
cross-origin isolation headers" (COOP/COEP). This repo **deliberately never
sets COOP/COEP** — cross-origin isolation blocks the cross-origin YouTube
`<iframe>`, which is the core feature (`vite.config.ts`, CLAUDE.md "Hard
constraints"). The documented escape hatch — `wasmThreading: 'single-thread'`
— "is only valid with explicit custom `moduleUrl` and `wasmUrl` assets", i.e.
building and self-hosting a custom single-threaded runtime for a days-old
0.1.x package. That is unsupported territory, and the docs do not state that
the WebGPU backend avoids the requirement (the WebGPU path still runs through
the same Emscripten module).

By contrast, the current stack was chosen to run *without* isolation:
transformers.js on WebGPU needs no SharedArrayBuffer, and ort-web falls back
to single-threaded WASM (`ort.env.wasm.numThreads = 1` in
`src/lib/audio/silero-session.ts`).

## Secondary frictions

Not disqualifying on their own, but each conflicts with a project convention:

- **Model hosting.** Sipp's docs show models loaded from self-hosted paths
  (`source: '/models/model.gguf'`). This repo stores no model files and
  downloads all weights from the Hugging Face hub at runtime
  (CLAUDE.md "Hard constraints").
- **Caching and integrity.** Sipp offers OPFS-backed caching with no
  documented integrity pinning; this repo's Silero path requires
  SHA-256-pinned downloads via `cachedFetch`, and its cache lives in Cache
  Storage.
- **Churn risk.** A 0.1.x with declared breaking changes would sit under the
  app's most stability-sensitive seams (worker protocol, load-failure
  semantics — see the "load failures must reject" invariant in CLAUDE.md).

## Comparison at a glance

| | Current stack (transformers.js + onnxruntime-web) | Sipp v0.1.1 |
| --- | --- | --- |
| Whisper ASR | ✅ WebGPU, WASM fallback | ❌ no audio models |
| opus-mt / NLLB translation | ✅ | ❌ no seq2seq |
| Silero VAD (ONNX) | ✅ | ❌ GGUF only |
| Decoder-only LLMs | ➖ not used today | ✅ (its actual purpose) |
| Works without COOP/COEP | ✅ (a design requirement here) | ❌ default assets need isolation; single-thread mode requires custom self-built assets |
| Model source | HF hub at runtime, nothing in repo | self-hosted GGUF paths |
| Integrity pinning | ✅ SHA-256 via `cachedFetch` (Silero) | none documented |
| Maturity | transformers.js v4, ort-web 1.26 (established) | v0.1.1, "breaking changes expected" |

## Possible partial adoption (future, not now)

The one architecturally clean role for Sipp here is **LLM-based translation**:
a small instruct GGUF (e.g. a 1–4 B model) can translate, sometimes better
than NLLB-600M, and the app already supports swapping translators at runtime.
A `SippTranslator implements Translator`
(`src/lib/translate/translator.ts`) wired through the `createTranslator`
factory (`src/lib/translate/factory.ts`) would slot in without touching the
pipeline — exactly the "new integrations get a seam + a fake" pattern.

It is still blocked today by blocker 4 (isolation requirement), and the size
trade-off is unfavorable: NLLB-600M at q8 is ~600 MB, smaller than most
competent instruct GGUFs at q4. Note the existing `api` translation mode
already covers "LLM-quality translation" via an OpenAI-compatible endpoint
(`src/lib/translate/api-translator.ts`) without any of these costs.

## Re-evaluation triggers

Revisit this evaluation if Sipp ships any of:

1. **Isolation-free browser assets** — official single-thread (or
   WebGPU-without-pthreads) builds published in the npm package, no custom
   `moduleUrl`/`wasmUrl` self-hosting required;
2. **Audio/whisper.cpp support** — would make the ASR conversation possible
   (still needs WASM fallback parity and a no-isolation story);
3. **A stable 1.x** with a documented remote-model-URL + integrity story.

Until then: keep transformers.js + onnxruntime-web.
