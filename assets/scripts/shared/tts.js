const playback = new Audio();
const playbackSpeedOptions = [0.5, 1, 1.5, 2];

let activePlayer = null;
let activeUrl = "";
let suppressPauseUi = false;
let activeSpeed = 1;
let openSpeedMenuPlayer = null;
let activeHighlight = null;
let syncFrame = 0;
const timingsCache = new Map();

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

function hasPlaybackStarted(player) {
  const button = player?.querySelector("[data-tts-toggle]");
  return button?.dataset.ttsStarted === "1";
}

function markPlaybackStarted(player, started) {
  const button = player?.querySelector("[data-tts-toggle]");
  if (!button) {
    return;
  }
  button.dataset.ttsStarted = started ? "1" : "0";
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
  return button?.dataset.ttsState === "playing" || button?.dataset.ttsStarted === "1";
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

function firstPlayer(scope = document) {
  return scope?.querySelector?.("[data-tts-root]") ?? null;
}

function nextPlaybackSpeed(currentSpeed, direction) {
  const currentIndex = playbackSpeedOptions.indexOf(currentSpeed);
  if (currentIndex < 0) {
    return activeSpeed;
  }
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= playbackSpeedOptions.length) {
    return currentSpeed;
  }
  return playbackSpeedOptions[nextIndex];
}

function stopHighlightLoop() {
  if (syncFrame) {
    cancelAnimationFrame(syncFrame);
    syncFrame = 0;
  }
}

function clearHighlightState(context = activeHighlight) {
  if (!context) {
    return;
  }
  for (const node of context.nodesByIndex.values()) {
    node.classList.remove("spoken");
  }
  context.spokenIndex = -1;
}

function updateHighlightState(currentTime) {
  if (!activeHighlight) {
    return;
  }

  const { words } = activeHighlight;
  let nextIndex = -1;
  while (nextIndex + 1 < words.length && words[nextIndex + 1].start <= currentTime) {
    nextIndex += 1;
  }

  if (nextIndex < activeHighlight.spokenIndex) {
    clearHighlightState(activeHighlight);
  }
  if (nextIndex === activeHighlight.spokenIndex) {
    return;
  }

  for (let index = activeHighlight.spokenIndex + 1; index <= nextIndex; index += 1) {
    const tokenIndex = words[index]?.tokenIndex;
    if (!Number.isInteger(tokenIndex)) {
      continue;
    }
    activeHighlight.nodesByIndex.get(tokenIndex)?.classList.add("spoken");
  }
  activeHighlight.spokenIndex = nextIndex;
}

function startHighlightLoop() {
  stopHighlightLoop();
  const step = () => {
    if (!activeHighlight) {
      syncFrame = 0;
      return;
    }
    updateHighlightState(playback.currentTime);
    if (!playback.paused && !playback.ended) {
      syncFrame = requestAnimationFrame(step);
      return;
    }
    syncFrame = 0;
  };
  syncFrame = requestAnimationFrame(step);
}

function tokenizedNodeClassList() {
  return "tts-highlight-word";
}

function wrapTextNodes(container, startIndex, nodesByIndex) {
  if (!container) {
    return startIndex;
  }

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!String(node.nodeValue || "").trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      if (
        parent.closest("[data-tts-root]")
        || parent.closest(".publication-note")
        || parent.closest(".published-note")
        || parent.closest(`.${tokenizedNodeClassList()}`)
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  let tokenIndex = startIndex;
  for (const node of textNodes) {
    const fragment = document.createDocumentFragment();
    const source = String(node.nodeValue || "");
    let lastIndex = 0;

    for (const match of source.matchAll(/\S+/g)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (start > lastIndex) {
        fragment.append(document.createTextNode(source.slice(lastIndex, start)));
      }

      const span = document.createElement("span");
      span.className = tokenizedNodeClassList();
      span.dataset.ttsTokenIndex = String(tokenIndex);
      span.textContent = match[0];
      nodesByIndex.set(tokenIndex, span);
      fragment.append(span);
      tokenIndex += 1;
      lastIndex = end;
    }

    if (lastIndex < source.length) {
      fragment.append(document.createTextNode(source.slice(lastIndex)));
    }

    node.parentNode?.replaceChild(fragment, node);
  }

  return tokenIndex;
}

function prepareHighlightContext(player, payload) {
  const timingsUrl = String(player?.dataset?.ttsTimingsUrl || "").trim();
  if (!timingsUrl || !Array.isArray(payload?.words) || payload.words.length === 0) {
    return null;
  }

  if (player.__ttsHighlight?.timingsUrl === timingsUrl) {
    player.__ttsHighlight.words = payload.words;
    return player.__ttsHighlight;
  }

  const main = player.closest("main");
  if (!main) {
    return null;
  }

  const nodesByIndex = new Map();
  let nextTokenIndex = 0;
  nextTokenIndex = wrapTextNodes(main.querySelector("h1"), nextTokenIndex, nodesByIndex);
  nextTokenIndex = wrapTextNodes(main.querySelector(".poem-meta-value-author"), nextTokenIndex, nodesByIndex);
  nextTokenIndex = wrapTextNodes(main.querySelector(".poem-meta-value-translator"), nextTokenIndex, nodesByIndex);
  nextTokenIndex = wrapTextNodes(main.querySelector(".content-block"), nextTokenIndex, nodesByIndex);

  const context = {
    timingsUrl,
    words: payload.words,
    nodesByIndex,
    spokenIndex: -1,
    tokenCount: nextTokenIndex
  };
  player.__ttsHighlight = context;
  return context;
}

async function loadTimingsPayload(player) {
  const rawUrl = String(player?.dataset?.ttsTimingsUrl || "").trim();
  if (!rawUrl) {
    return null;
  }

  const url = new URL(rawUrl, window.location.href).href;
  if (!timingsCache.has(url)) {
    timingsCache.set(url, fetch(url, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load TTS timings (${response.status}).`);
      }
      return response.json();
    }));
  }

  return timingsCache.get(url);
}

async function ensureHighlightContext(player) {
  const payload = await loadTimingsPayload(player).catch((error) => {
    console.error("TTS timings failed to load.", error);
    return null;
  });
  if (!payload || activePlayer !== player) {
    return null;
  }

  const context = prepareHighlightContext(player, payload);
  if (!context) {
    return null;
  }

  if (activeHighlight && activeHighlight !== context) {
    clearHighlightState(activeHighlight);
  }
  activeHighlight = context;
  updateHighlightState(playback.currentTime);
  return context;
}

function setPlayerState(player, state) {
  const button = player?.querySelector("[data-tts-toggle]");
  if (!button) {
    return;
  }

  button.dataset.ttsState = state;
  button.setAttribute("aria-busy", state === "loading" ? "true" : "false");

  if (state === "playing") {
    markPlaybackStarted(player, true);
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
    updateSpeedControl(player, { visible: hasPlaybackStarted(player) });
    setStatusText(player, "Loading poem audio.");
    return;
  }

  if (state === "ended") {
    markPlaybackStarted(player, false);
    button.setAttribute("aria-label", "Play poem audio again");
    button.setAttribute("title", "Play poem audio again");
    closeSpeedMenu(player);
    updateSpeedControl(player, { visible: false });
    setStatusText(player, "Poem audio ended.");
    return;
  }

  if (state === "error") {
    markPlaybackStarted(player, false);
    button.setAttribute("aria-label", "Poem audio is unavailable");
    button.setAttribute("title", "Poem audio is unavailable");
    closeSpeedMenu(player);
    updateSpeedControl(player, { visible: false });
    setStatusText(player, "Poem audio is unavailable.");
    return;
  }

  const resumable = hasPlaybackStarted(player);
  button.setAttribute("aria-label", resumable ? "Resume poem audio" : "Play poem audio");
  button.setAttribute("title", resumable ? "Resume poem audio" : "Play poem audio");
  closeSpeedMenu(player);
  updateSpeedControl(player, { visible: resumable });
  setStatusText(player, resumable ? "Poem audio paused." : "Poem audio ready.");
}

playback.preload = "none";
playback.addEventListener("playing", () => {
  if (activePlayer) {
    setPlayerState(activePlayer, "playing");
  }
  if (activeHighlight) {
    startHighlightLoop();
  }
});
playback.addEventListener("pause", () => {
  if (!activePlayer || suppressPauseUi) {
    return;
  }
  stopHighlightLoop();
  updateHighlightState(playback.currentTime);
  setPlayerState(activePlayer, playback.ended ? "ended" : "paused");
});
playback.addEventListener("waiting", () => {
  if (activePlayer) {
    setPlayerState(activePlayer, "loading");
  }
});
playback.addEventListener("ended", () => {
  stopHighlightLoop();
  clearHighlightState();
  if (activePlayer) {
    setPlayerState(activePlayer, "ended");
  }
});
playback.addEventListener("error", () => {
  stopHighlightLoop();
  console.error("TTS playback failed.", playback.error);
  if (activePlayer) {
    setPlayerState(activePlayer, "error");
  }
});
playback.addEventListener("seeked", () => {
  if (playback.paused || playback.ended) {
    clearHighlightState();
    return;
  }
  updateHighlightState(playback.currentTime);
});
playback.addEventListener("emptied", () => {
  stopHighlightLoop();
  clearHighlightState();
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
  stopHighlightLoop();
  clearHighlightState();
  if (activePlayer) {
    markPlaybackStarted(activePlayer, false);
    setPlayerState(activePlayer, "paused");
  }
  activeHighlight = null;
  activePlayer = null;
  activeUrl = "";
}

export function toggleTtsPlayback(scope = document) {
  const player = firstPlayer(scope);
  const button = player?.querySelector("[data-tts-toggle]");
  if (!button) {
    return false;
  }
  button.click();
  return true;
}

export function stepTtsPlaybackSpeed(direction, scope = document) {
  const player = firstPlayer(scope);
  if (!player || activePlayer !== player || playback.paused || playback.ended) {
    return false;
  }

  const nextSpeed = nextPlaybackSpeed(activeSpeed, direction);
  if (nextSpeed === activeSpeed) {
    return false;
  }

  setPlaybackSpeed(nextSpeed);
  return true;
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
        clearHighlightState(activeHighlight);
        activeHighlight = null;
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
          markPlaybackStarted(player, false);
        } else if (playback.ended) {
          playback.currentTime = 0;
          resetPlaybackSpeed();
          markPlaybackStarted(player, false);
        } else if (playback.paused) {
          updateSpeedControl(player, { visible: true });
        }
        await ensureHighlightContext(player);
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
    markPlaybackStarted(player, false);
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
