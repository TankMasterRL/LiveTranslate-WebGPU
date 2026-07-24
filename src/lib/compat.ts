import type { WebGPUSupport } from './asr/webgpu';

/**
 * Runtime feature detection for the browser capabilities the pipeline depends
 * on, with user-facing guidance. The version numbers in the notices come from
 * MDN's Browser Compatibility Data (api.MediaDevices.getDisplayMedia
 * audio_capture_support, api.GPU, webassembly.api.Suspending) — keep them in
 * sync with BCD when upgrading claims.
 *
 * It also detects the inverse of a capability: cross-origin isolation. Shared
 * memory (SharedArrayBuffer / threaded WASM) is gated behind COOP + COEP
 * headers per the MDN "Security requirements" —
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements
 * — but those same headers would block the cross-origin YouTube embed, so this
 * app deliberately stays non-isolated (WASM runs single-threaded, no
 * SharedArrayBuffer). `youtubeEmbed` flags a stray isolation header as a
 * misconfiguration rather than a silently broken embed.
 */

export interface FeatureCompat {
  supported: boolean;
  /** User-facing guidance (with minimum browser versions) when unsupported. */
  notice: string | null;
}

export interface BrowserCompat {
  /** getDisplayMedia — the tab/system audio capture path. */
  tabCapture: FeatureCompat;
  /** WebAssembly JSPI — required by Nemotron's WebGPU session build. */
  jspi: FeatureCompat;
  /**
   * The cross-origin YouTube <iframe> embed — the core feature. `supported` is
   * true when the document is NOT cross-origin isolated (the normal, required
   * state); it flips to false if a stray COOP/COEP header turns isolation on,
   * which would block the embed. See the note below on why this app forgoes
   * cross-origin isolation (and therefore SharedArrayBuffer / threaded WASM).
   */
  youtubeEmbed: FeatureCompat;
}

/** Injection seam so tests can probe arbitrary browser shapes. */
export interface CompatEnv {
  mediaDevices?: { getDisplayMedia?: unknown };
  wasm?: { Suspending?: unknown };
  /**
   * Whether the document is cross-origin isolated — the WorkerGlobalScope /
   * Window `crossOriginIsolated` flag, true only when both COOP: same-origin
   * and COEP: require-corp are set. Absent in jsdom/node.
   */
  crossOriginIsolated?: boolean;
}

export function detectBrowserCompat(
  env: CompatEnv = {
    // mediaDevices is absent entirely in insecure contexts.
    mediaDevices: typeof navigator === 'undefined' ? undefined : navigator.mediaDevices,
    wasm: WebAssembly as { Suspending?: unknown },
    crossOriginIsolated:
      typeof globalThis === 'undefined' ? false : globalThis.crossOriginIsolated === true
  }
): BrowserCompat {
  const tabCapture = typeof env.mediaDevices?.getDisplayMedia === 'function';
  const jspi = typeof env.wasm?.Suspending === 'function';
  const crossOriginIsolated = env.crossOriginIsolated === true;
  return {
    tabCapture: {
      supported: tabCapture,
      notice: tabCapture
        ? null
        : 'Tab / system audio capture is not supported in this browser — sharing tab audio ' +
          'needs desktop Chrome 74+, Edge 79+, or Opera 62+, and no mobile browser supports ' +
          'it. The microphone is used instead.'
    },
    jspi: {
      supported: jspi,
      notice: jspi
        ? null
        : 'WebAssembly JavaScript Promise Integration is unavailable — it needs Chrome/Edge ' +
          '137+ or Opera 121+.'
    },
    youtubeEmbed: {
      supported: !crossOriginIsolated,
      notice: crossOriginIsolated
        ? 'This page is cross-origin isolated (Cross-Origin-Opener-Policy + ' +
          'Cross-Origin-Embedder-Policy headers are set), which blocks the embedded ' +
          'cross-origin YouTube player. LiveTranslate needs that iframe, so it runs ' +
          'without cross-origin isolation — and therefore without SharedArrayBuffer or ' +
          'multi-threaded WebAssembly. Remove the COOP/COEP headers from the deployment.'
        : null
    }
  };
}

/**
 * Nemotron is blocked only when the pipeline would pick the WebGPU backend
 * without JSPI: nemotron/session.ts must load ort's native WebGPU EP build,
 * which suspends WASM via JSPI, and refuses the broken JSEP path. On the WASM
 * backend the default ort build serves it, so a missing JSPI is irrelevant
 * there — and while WebGPU detection is still pending (null) nothing is
 * blocked yet.
 */
export function nemotronSupport(
  compat: BrowserCompat,
  webgpu: WebGPUSupport | null
): FeatureCompat {
  if (webgpu?.supported !== true || compat.jspi.supported) {
    return { supported: true, notice: null };
  }
  return {
    supported: false,
    notice:
      'Nemotron is disabled: running it on WebGPU needs WebAssembly JavaScript Promise ' +
      'Integration (Chrome/Edge 137+ or Opera 121+), which this browser lacks. Whisper ' +
      'still works.'
  };
}

export const WEBGPU_COMPAT_NOTICE =
  'WebGPU is unavailable here, so transcription will use the slower WASM fallback — WebGPU ' +
  'needs Chrome/Edge 113+ (Android 121+), Firefox 141+ on Windows, or Safari 26+.';
