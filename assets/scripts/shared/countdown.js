function pluralize(value, singular, plural) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function formatCountdown(secondsRemaining) {
  const safe = Math.max(0, Math.floor(secondsRemaining));
  if (safe < 60) {
    return pluralize(safe, "second", "seconds");
  }
  if (safe < 3600) {
    const minutes = Math.floor(safe / 60);
    return pluralize(minutes, "minute", "minutes");
  }
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${pluralize(hours, "hour", "hours")} and ${pluralize(minutes, "minute", "minutes")}`;
}

export function formatFutureAvailabilityCountdown(secondsRemaining) {
  const safe = Math.max(0, Math.floor(secondsRemaining));
  if (safe < 60) {
    return pluralize(safe, "second", "seconds");
  }

  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const parts = [];

  if (days > 0) {
    parts.push(pluralize(days, "day", "days"));
  }
  if (hours > 0) {
    parts.push(pluralize(hours, "hour", "hours"));
  }
  if (minutes > 0) {
    parts.push(pluralize(minutes, "minute", "minutes"));
  }

  if (parts.length === 0) {
    return pluralize(Math.max(1, safe), "second", "seconds");
  }
  return parts.join(", ");
}

export function secondsUntilNextLocalMidnight(now = new Date()) {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return (nextMidnight.getTime() - now.getTime()) / 1000;
}

function msUntilNextSecondValue(secondsRemaining) {
  if (secondsRemaining <= 0) {
    return 1000;
  }

  if (Number.isInteger(secondsRemaining)) {
    return 1000;
  }

  const wholeSeconds = Math.floor(secondsRemaining);
  return Math.ceil((secondsRemaining - wholeSeconds) * 1000) + 25;
}

function msUntilSafeBelowThreshold(secondsRemaining, thresholdSeconds) {
  const safe = Math.max(0, Math.floor(secondsRemaining));
  if (safe < thresholdSeconds) {
    return msUntilNextSecondValue(secondsRemaining);
  }

  const dropsNeeded = safe - thresholdSeconds + 1;
  return msUntilNextSecondValue(secondsRemaining) + ((dropsNeeded - 1) * 1000);
}

export function nextAboutCountdownDelay(secondsRemaining) {
  const safe = Math.max(0, Math.floor(secondsRemaining));
  if (safe < 60) {
    return msUntilNextSecondValue(secondsRemaining);
  }

  if (safe < 3600) {
    const minutes = Math.floor(safe / 60);
    return msUntilSafeBelowThreshold(secondsRemaining, minutes * 60);
  }

  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return msUntilSafeBelowThreshold(secondsRemaining, (hours * 3600) + (minutes * 60));
}

export function nextFutureAvailabilityDelay(secondsRemaining) {
  const safe = Math.max(0, Math.floor(secondsRemaining));
  if (safe < 60) {
    return msUntilNextSecondValue(secondsRemaining);
  }

  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return msUntilSafeBelowThreshold(
    secondsRemaining,
    (days * 86400) + (hours * 3600) + (minutes * 60)
  );
}

export function startScheduledCountdown({ getSecondsRemaining, render, getNextDelay, onExpire }) {
  let timerId = 0;

  const tick = () => {
    const secondsRemaining = getSecondsRemaining();
    if (secondsRemaining <= 0 && onExpire) {
      onExpire();
      return;
    }

    render(secondsRemaining);
    const delay = Math.max(50, Math.floor(getNextDelay(secondsRemaining)));
    timerId = window.setTimeout(tick, delay);
  };

  tick();

  return () => {
    if (timerId) {
      window.clearTimeout(timerId);
    }
  };
}

export function initCountdown() {
  const el = document.getElementById("next-poem-countdown");
  if (!el) {
    return;
  }

  startScheduledCountdown({
    getSecondsRemaining: () => secondsUntilNextLocalMidnight(new Date()),
    render: (remaining) => {
      el.textContent = formatCountdown(remaining);
    },
    getNextDelay: nextAboutCountdownDelay
  });
}
