export type CaptureKind = 'current-tab' | 'tab' | 'microphone';

// Disable browser voice processing — it hurts ASR of media/music content.
const RAW_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
};

// `preferCurrentTab` is a Chrome extension to getDisplayMedia's options that
// pre-selects the app's own tab in the share picker; it isn't in lib.dom yet.
type DisplayMediaOptions = DisplayMediaStreamOptions & { preferCurrentTab?: boolean };

/**
 * Acquire an audio MediaStream.
 *
 * NOTE: A cross-origin YouTube <iframe>'s audio cannot be read directly, so to
 * transcribe what's playing the user shares the tab/system audio via
 * getDisplayMedia (the browser-legal analog of LiveTranslate's WASAPI
 * loopback). getDisplayMedia requires `video: true` for the share picker even
 * though we only consume the audio track.
 *
 * The YouTube embed plays inside the app's own tab, so `current-tab` is the
 * one-click path: `preferCurrentTab` makes the picker default to this very tab,
 * whose audio already includes the embedded video. `tab` opens the full picker
 * for audio playing in a different tab/window/screen, and the microphone is the
 * simpler fallback that captures the speakers ambiently.
 */
export function requestAudioStream(
  kind: CaptureKind,
  mediaDevices: MediaDevices = navigator.mediaDevices
): Promise<MediaStream> {
  if (kind === 'microphone') {
    return mediaDevices.getUserMedia({ audio: RAW_AUDIO });
  }
  const options: DisplayMediaOptions = { video: true, audio: RAW_AUDIO };
  if (kind === 'current-tab') options.preferCurrentTab = true;
  return mediaDevices.getDisplayMedia(options);
}
