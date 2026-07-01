// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  interface Window {
    // Loaded by the YouTube IFrame Player API script.
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export {};
