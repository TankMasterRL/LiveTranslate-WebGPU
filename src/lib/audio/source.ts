export type CaptureKind = 'tab' | 'microphone';

// Disable browser voice processing — it hurts ASR of media/music content.
const RAW_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
};

/**
 * Acquire an audio MediaStream.
 *
 * NOTE: A cross-origin YouTube <iframe>'s audio cannot be read directly, so to
 * transcribe what's playing the user shares the tab/system audio via
 * getDisplayMedia (the browser-legal analog of LiveTranslate's WASAPI
 * loopback). getDisplayMedia requires `video: true` for the share picker even
 * though we only consume the audio track. The microphone is the simpler
 * fallback that captures the speakers ambiently.
 */
export function requestAudioStream(
  kind: CaptureKind,
  mediaDevices: MediaDevices = navigator.mediaDevices
): Promise<MediaStream> {
  if (kind === 'tab') {
    return mediaDevices.getDisplayMedia({ video: true, audio: RAW_AUDIO });
  }
  return mediaDevices.getUserMedia({ audio: RAW_AUDIO });
}
