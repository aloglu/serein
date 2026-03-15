const playback = new Audio();
const touchSlowPressMs = 450;

let activePlayer = null;
let activeUrl = "";
let suppressPauseUi = false;
let activeSpeed = 1;

function setStatusText(player, text) {
  const status = player?.querySelector("[data-tts-status]");
  if (!status) {
    return;
  }
  status.textContent = text;
}

function formatSpeed(speed) {
  return `${speed}x`;
}

function updateSpeedControl(player, { visible = false, speed = activeSpeed } = {}) {
  const control = player?.querySelector("[data-tts-speed]");
  if (!control) {
    return;
  }

  control.textContent = formatSpeed(speed);
  control.setAttribute(
    "aria-label",
    `Playback speed ${formatSpeed(speed)}. Click or tap for 2x. Right-click or press and hold for 0.5x.`
  );
  control.setAttribute("title", `Playback speed ${formatSpeed(speed)}`);
  control.hidden = !visible;
  control.setAttribute("aria-hidden", visible ? "false" : "true");
  control.tabIndex = visible ? 0 : -1;
}

function shouldShowSpeedControl(player) {
  const button = player?.querySelector("[data-tts-toggle]");
  return button?.dataset.ttsState === "playing";
}

function setPlaybackSpeed(speed, { announce = true, visible = null } = {}) {
  activeSpeed = speed;
  playback.playbackRate = speed;
  playback.defaultPlaybackRate = speed;
  if (activePlayer) {
    updateSpeedControl(activePlayer, {
      visible: visible ?? shouldShowSpeedControl(activePlayer),
      speed
    });
    if (announce) {
      setStatusText(activePlayer, `Playback speed ${formatSpeed(speed)}.`);
    }
  }
}

function toggleFastSpeed() {
  if (activeSpeed < 1) {
    setPlaybackSpeed(1);
    return;
  }
  setPlaybackSpeed(activeSpeed === 2 ? 1 : 2);
}

function toggleSlowSpeed() {
  if (activeSpeed > 1) {
    setPlaybackSpeed(1);
    return;
  }
  setPlaybackSpeed(activeSpeed === 0.5 ? 1 : 0.5);
}

function resetPlaybackSpeed() {
  setPlaybackSpeed(1, { announce: false, visible: false });
}

function setPlayerState(player, state) {
  const button = player?.querySelector("[data-tts-toggle]");
  if (!button) {
    return;
  }

  button.dataset.ttsState = state;
  button.setAttribute("aria-busy", state === "loading" ? "true" : "false");

  if (state === "playing") {
    button.setAttribute("aria-label", "Pause poem audio");
    button.setAttribute("title", "Pause poem audio");
    updateSpeedControl(player, { visible: true });
    setStatusText(player, "Poem audio playing.");
    return;
  }

  if (state === "loading") {
    button.setAttribute("aria-label", "Loading poem audio");
    button.setAttribute("title", "Loading poem audio");
    updateSpeedControl(player, { visible: false });
    setStatusText(player, "Loading poem audio.");
    return;
  }

  if (state === "ended") {
    button.setAttribute("aria-label", "Play poem audio again");
    button.setAttribute("title", "Play poem audio again");
    updateSpeedControl(player, { visible: false });
    setStatusText(player, "Poem audio ended.");
    return;
  }

  if (state === "error") {
    button.setAttribute("aria-label", "Poem audio is unavailable");
    button.setAttribute("title", "Poem audio is unavailable");
    updateSpeedControl(player, { visible: false });
    setStatusText(player, "Poem audio is unavailable.");
    return;
  }

  button.setAttribute("aria-label", "Play poem audio");
  button.setAttribute("title", "Play poem audio");
  updateSpeedControl(player, { visible: false });
  setStatusText(player, "Poem audio paused.");
}

playback.preload = "none";
playback.addEventListener("playing", () => {
  if (activePlayer) {
    setPlayerState(activePlayer, "playing");
  }
});
playback.addEventListener("pause", () => {
  if (!activePlayer || suppressPauseUi) {
    return;
  }
  setPlayerState(activePlayer, playback.ended ? "ended" : "paused");
});
playback.addEventListener("waiting", () => {
  if (activePlayer) {
    setPlayerState(activePlayer, "loading");
  }
});
playback.addEventListener("ended", () => {
  if (activePlayer) {
    setPlayerState(activePlayer, "ended");
  }
});
playback.addEventListener("error", () => {
  console.error("TTS playback failed.", playback.error);
  if (activePlayer) {
    setPlayerState(activePlayer, "error");
  }
});

export function resetTtsPlayback() {
  if (!activePlayer && playback.paused) {
    return;
  }

  suppressPauseUi = true;
  playback.pause();
  suppressPauseUi = false;
  playback.currentTime = 0;
  resetPlaybackSpeed();
  if (activePlayer) {
    setPlayerState(activePlayer, "paused");
  }
  activePlayer = null;
  activeUrl = "";
}

export function bindTtsPlayers(scope = document) {
  const players = scope.querySelectorAll("[data-tts-root]");

  for (const player of players) {
    if (player.dataset.ttsBound === "1") {
      continue;
    }

    player.dataset.ttsBound = "1";
    const button = player.querySelector("[data-tts-toggle]");
    const speedControl = player.querySelector("[data-tts-speed]");
    const url = String(player.dataset.ttsAudioUrl || "").trim();

    if (!button || !url) {
      continue;
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault();

      if (activePlayer === player && !playback.paused && !playback.ended) {
        setPlayerState(player, "paused");
        playback.pause();
        return;
      }

      const normalizedUrl = new URL(url, window.location.href).href;
      const sourceChanged = activePlayer !== player || activeUrl !== normalizedUrl;
      const previousPlayer = activePlayer;

      if (previousPlayer && previousPlayer !== player) {
        setPlayerState(previousPlayer, "paused");
      }

      activePlayer = player;
      activeUrl = normalizedUrl;
      setPlayerState(player, "loading");

      try {
        if (sourceChanged) {
          suppressPauseUi = true;
          playback.pause();
          suppressPauseUi = false;
          playback.src = normalizedUrl;
          playback.currentTime = 0;
          resetPlaybackSpeed();
        } else if (playback.ended) {
          playback.currentTime = 0;
          resetPlaybackSpeed();
        }
        await playback.play();
        setPlayerState(player, "playing");
      } catch (error) {
        console.error("TTS playback failed.", error);
        setPlayerState(player, "error");
      }
    });

    if (speedControl) {
      let touchSlowTimer = null;
      let touchSlowTriggered = false;

      const clearTouchSlowTimer = () => {
        if (touchSlowTimer !== null) {
          window.clearTimeout(touchSlowTimer);
          touchSlowTimer = null;
        }
      };

      speedControl.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch") {
          return;
        }

        clearTouchSlowTimer();
        touchSlowTriggered = false;
        touchSlowTimer = window.setTimeout(() => {
          touchSlowTimer = null;
          if (activePlayer !== player || playback.paused || playback.ended) {
            return;
          }
          touchSlowTriggered = true;
          toggleSlowSpeed();
        }, touchSlowPressMs);
      });

      speedControl.addEventListener("pointerup", clearTouchSlowTimer);
      speedControl.addEventListener("pointercancel", clearTouchSlowTimer);
      speedControl.addEventListener("pointerleave", clearTouchSlowTimer);

      speedControl.addEventListener("click", (event) => {
        event.preventDefault();
        if (touchSlowTriggered) {
          touchSlowTriggered = false;
          return;
        }
        if (activePlayer !== player || playback.paused || playback.ended) {
          return;
        }
        toggleFastSpeed();
      });

      speedControl.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (activePlayer !== player || playback.paused || playback.ended) {
          return;
        }
        toggleSlowSpeed();
      });

      speedControl.addEventListener("keydown", (event) => {
        if (activePlayer !== player || playback.paused || playback.ended) {
          return;
        }

        if (event.key === "ArrowUp" || event.key === "ArrowRight") {
          event.preventDefault();
          toggleFastSpeed();
          return;
        }

        if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
          event.preventDefault();
          toggleSlowSpeed();
        }
      });
    }

    setPlayerState(player, "paused");
    setStatusText(player, "");
  }
}
