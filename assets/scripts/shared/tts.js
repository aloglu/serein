const idleIcon = "\uD83D\uDD0A\uFE0E";
const pauseIcon = "\u23F8\uFE0E";
const playback = new Audio();

let activePlayer = null;
let activeUrl = "";
let suppressPauseUi = false;

function setPlayerState(player, state) {
  const button = player?.querySelector("[data-tts-toggle]");
  const icon = player?.querySelector("[data-tts-icon]");
  if (!button || !icon) {
    return;
  }

  button.dataset.ttsState = state;
  button.setAttribute("aria-busy", state === "loading" ? "true" : "false");

  if (state === "playing") {
    icon.textContent = pauseIcon;
    button.setAttribute("aria-label", "Pause poem audio");
    button.setAttribute("title", "Pause poem audio");
    return;
  }

  if (state === "loading") {
    icon.textContent = idleIcon;
    button.setAttribute("aria-label", "Loading poem audio");
    button.setAttribute("title", "Loading poem audio");
    return;
  }

  if (state === "ended") {
    icon.textContent = idleIcon;
    button.setAttribute("aria-label", "Play poem audio again");
    button.setAttribute("title", "Play poem audio again");
    return;
  }

  if (state === "error") {
    icon.textContent = idleIcon;
    button.setAttribute("aria-label", "Poem audio is unavailable");
    button.setAttribute("title", "Poem audio is unavailable");
    return;
  }

  icon.textContent = idleIcon;
  button.setAttribute("aria-label", "Play poem audio");
  button.setAttribute("title", "Play poem audio");
}

playback.preload = "none";
playback.addEventListener("play", () => {
  if (activePlayer) {
    setPlayerState(activePlayer, "playing");
  }
});
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
        } else if (playback.ended) {
          playback.currentTime = 0;
        }
        await playback.play();
        setPlayerState(player, "playing");
      } catch (error) {
        console.error("TTS playback failed.", error);
        setPlayerState(player, "error");
      }
    });

    setPlayerState(player, "paused");
  }
}
