// A stub of the YouTube IFrame Player API so browser automation is
// deterministic and needs no network / real embed. getCurrentTime returns 0.1s
// so the first demo cue (0–3800ms) is active. Shared by the Playwright e2e
// suite and scripts/readme-screenshot.mjs — serve it for '**/iframe_api'.
export const YT_STUB = `
  window.YT = {
    Player: function (el, opts) {
      this.getCurrentTime = function () { return 0.1; };
      this.getDuration = function () { return 100; };
      this.getPlayerState = function () { return 1; };
      this.playVideo = function () {};
      this.pauseVideo = function () {};
      this.loadVideoById = function () {};
      this.destroy = function () {};
      var self = this;
      setTimeout(function () { opts.events && opts.events.onReady && opts.events.onReady({ target: self, data: 1 }); }, 0);
    },
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }
  };
  if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady();
`;
