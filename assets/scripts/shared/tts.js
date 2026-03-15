const playback = new Audio();
const playbackSpeedOptions = [0.5, 1, 1.5, 2];

let activePlayer = null;
let activeUrl = "";
let suppressPauseUi = false;
let activeSpeed = 1;
let openSpeedMenuPlayer = null;

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

function getSpeedControl(player) {
  return player?.querySelector("[data-tts-speed]") ?? null;
}

function getSpeedMenu(player) {
  return player?.querySelector("[data-tts-speed-menu]") ?? null;
}

function getSpeedOptions(player) {
  return Array.from(player?.querySelectorAll("[data-tts-speed-option]") ?? []);
}

function updateSpeedControl(player, { visible = false, speed = activeSpeed } = {}) {
  const control = getSpeedControl(player);
  if (!control) {
    return;
  }

  control.textContent = formatSpeed(speed);
  control.setAttribute(
    "aria-label",
    `Playback speed ${formatSpeed(speed)}. Choose playback speed.`
  );
  control.setAttribute("title", `Playback speed ${formatSpeed(speed)}`);
  control.hidden = !visible;
  control.setAttribute("aria-hidden", visible ? "false" : "true");
  control.tabIndex = visible ? 0 : -1;
  if (!visible) {
    control.setAttribute("aria-expanded", "false");
  }
  updateSpeedMenuOptions(player, speed);
}

function shouldShowSpeedControl(player) {
  const button = player?.querySelector("[data-tts-toggle]");
  return button?.dataset.ttsState === "playing";
}

function updateSpeedMenuOptions(player, speed = activeSpeed) {
  for (const option of getSpeedOptions(player)) {
    const value = Number(option.dataset.ttsSpeedValue);
    const selected = value === speed;
    option.setAttribute("aria-pressed", selected ? "true" : "false");
  }
}

function closeSpeedMenu(player = openSpeedMenuPlayer, { restoreFocus = false } = {}) {
  if (!player) {
    return;
  }

  const control = getSpeedControl(player);
  const menu = getSpeedMenu(player);
  if (menu) {
    menu.hidden = true;
  }
  if (control) {
    control.setAttribute("aria-expanded", "false");
    if (restoreFocus && !control.hidden) {
      control.focus();
    }
  }
  if (openSpeedMenuPlayer === player) {
    openSpeedMenuPlayer = null;
  }
}

function openSpeedMenu(player, { focusSelected = false } = {}) {
  if (!player || !shouldShowSpeedControl(player)) {
    return;
  }

  if (openSpeedMenuPlayer && openSpeedMenuPlayer !== player) {
    closeSpeedMenu(openSpeedMenuPlayer);
  }

  const control = getSpeedControl(player);
  const menu = getSpeedMenu(player);
  if (!control || !menu) {
    return;
  }

  updateSpeedMenuOptions(player, activeSpeed);
  menu.hidden = false;
  control.setAttribute("aria-expanded", "true");
  openSpeedMenuPlayer = player;

  if (focusSelected) {
    const selectedOption = getSpeedOptions(player).find((option) => option.getAttribute("aria-pressed") === "true");
    selectedOption?.focus();
  }
}

function toggleSpeedMenu(player, { focusSelected = false } = {}) {
  if (openSpeedMenuPlayer === player) {
    closeSpeedMenu(player, { restoreFocus: !focusSelected });
    return;
  }
  openSpeedMenu(player, { focusSelected });
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
    closeSpeedMenu(player);
    updateSpeedControl(player, { visible: false });
    setStatusText(player, "Loading poem audio.");
    return;
  }

  if (state === "ended") {
    button.setAttribute("aria-label", "Play poem audio again");
    button.setAttribute("title", "Play poem audio again");
    closeSpeedMenu(player);
    updateSpeedControl(player, { visible: false });
    setStatusText(player, "Poem audio ended.");
    return;
  }

  if (state === "error") {
    button.setAttribute("aria-label", "Poem audio is unavailable");
    button.setAttribute("title", "Poem audio is unavailable");
    closeSpeedMenu(player);
    updateSpeedControl(player, { visible: false });
    setStatusText(player, "Poem audio is unavailable.");
    return;
  }

  button.setAttribute("aria-label", "Play poem audio");
  button.setAttribute("title", "Play poem audio");
  closeSpeedMenu(player);
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
    const speedMenu = getSpeedMenu(player);
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

    if (speedControl && speedMenu) {
      speedControl.addEventListener("click", (event) => {
        event.preventDefault();
        if (activePlayer !== player || playback.paused || playback.ended) {
          return;
        }
        toggleSpeedMenu(player);
      });

      speedControl.addEventListener("keydown", (event) => {
        if (activePlayer !== player || playback.paused || playback.ended) {
          return;
        }

        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openSpeedMenu(player, { focusSelected: true });
          return;
        }

        if (event.key === "Escape" && openSpeedMenuPlayer === player) {
          event.preventDefault();
          closeSpeedMenu(player, { restoreFocus: true });
        }
      });

      for (const option of getSpeedOptions(player)) {
        option.addEventListener("click", (event) => {
          event.preventDefault();
          if (activePlayer !== player || playback.paused || playback.ended) {
            return;
          }
          const speed = Number(option.dataset.ttsSpeedValue);
          if (!playbackSpeedOptions.includes(speed)) {
            return;
          }
          setPlaybackSpeed(speed);
          closeSpeedMenu(player, { restoreFocus: true });
        });

        option.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeSpeedMenu(player, { restoreFocus: true });
            return;
          }

          const options = getSpeedOptions(player);
          const currentIndex = options.indexOf(option);
          if (currentIndex === -1) {
            return;
          }

          if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            event.preventDefault();
            options[(currentIndex + 1) % options.length]?.focus();
            return;
          }

          if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            options[(currentIndex - 1 + options.length) % options.length]?.focus();
          }
        });
      }
    }

    setPlayerState(player, "paused");
    setStatusText(player, "");
  }
}

if (typeof document !== "undefined" && document.body && !document.body.dataset.ttsMenusBound) {
  document.body.dataset.ttsMenusBound = "1";

  document.addEventListener("pointerdown", (event) => {
    if (!openSpeedMenuPlayer) {
      return;
    }
    if (event.target instanceof Node && openSpeedMenuPlayer.contains(event.target)) {
      return;
    }
    closeSpeedMenu(openSpeedMenuPlayer);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !openSpeedMenuPlayer) {
      return;
    }
    closeSpeedMenu(openSpeedMenuPlayer, { restoreFocus: true });
  });
}
