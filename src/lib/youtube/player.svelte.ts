import type { YTPlayer, YTPlayerEvent } from './types';

export type PlayerStatus =
  | 'idle'
  | 'unstarted'
  | 'ended'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'cued';

/** Map a YouTube numeric player-state code to a readable status. */
export function mapPlayerState(code: number): PlayerStatus {
  switch (code) {
    case -1:
      return 'unstarted';
    case 0:
      return 'ended';
    case 1:
      return 'playing';
    case 2:
      return 'paused';
    case 3:
      return 'buffering';
    case 5:
      return 'cued';
    default:
      return 'idle';
  }
}

let apiPromise: Promise<void> | null = null;

/** Load the YouTube IFrame Player API script once and resolve when ready. */
export function loadYouTubeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    document.head.appendChild(tag);
  });
  return apiPromise;
}

/**
 * Reactive wrapper around a YouTube player: exposes the current playback time
 * (polled via rAF) and status as runes so the overlay can sync to it.
 */
export class YouTubePlayer {
  #currentMs = $state(0);
  #durationMs = $state(0);
  #status = $state<PlayerStatus>('idle');
  #player: YTPlayer | null = null;
  #raf = 0;

  get currentMs(): number {
    return this.#currentMs;
  }
  get durationMs(): number {
    return this.#durationMs;
  }
  get status(): PlayerStatus {
    return this.#status;
  }
  get playing(): boolean {
    return this.#status === 'playing';
  }
  get ready(): boolean {
    return this.#player !== null;
  }

  /** Create the underlying player inside `host`, loading `videoId`. */
  async mount(host: HTMLElement, videoId: string): Promise<void> {
    await loadYouTubeApi();
    if (!window.YT?.Player) throw new Error('YouTube IFrame API failed to load');

    this.#player = new window.YT.Player(host, {
      videoId,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onReady: (event: YTPlayerEvent) => {
          this.#durationMs = event.target.getDuration() * 1000;
          this.#startPolling();
        },
        onStateChange: (event: YTPlayerEvent) => {
          this.#status = mapPlayerState(event.data);
          this.#durationMs = event.target.getDuration() * 1000;
        }
      }
    });
  }

  #startPolling(): void {
    const tick = () => {
      if (this.#player) {
        this.#currentMs = this.#player.getCurrentTime() * 1000;
        this.#raf = requestAnimationFrame(tick);
      }
    };
    this.#raf = requestAnimationFrame(tick);
  }

  loadVideo(videoId: string): void {
    this.#player?.loadVideoById(videoId);
  }

  play(): void {
    this.#player?.playVideo();
  }

  pause(): void {
    this.#player?.pauseVideo();
  }

  destroy(): void {
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#player?.destroy();
    this.#player = null;
    this.#status = 'idle';
  }
}
