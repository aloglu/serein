function partsAtTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second)
  };
}

function formatCountdown(secondsRemaining) {
  const safe = Math.max(0, secondsRemaining);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours === 0) {
    const minuteOnlyLabel = minutes === 1 ? "minute" : "minutes";
    return `${minutes} ${minuteOnlyLabel}`;
  }
  const hourLabel = hours === 1 ? "hour" : "hours";
  const minuteLabel = minutes === 1 ? "minute" : "minutes";
  return `${hours} ${hourLabel}, ${minutes} ${minuteLabel}`;
}

function updateCountdown(el, timeZone) {
  const now = new Date();
  const nowTz = partsAtTimeZone(now, timeZone);
  const secondsNow = nowTz.hour * 3600 + nowTz.minute * 60 + nowTz.second;
  const secondsRemaining = 86400 - secondsNow;
  el.textContent = formatCountdown(secondsRemaining);
}

function initCountdown() {
  const el = document.querySelector("#next-poem-countdown");
  if (!el) {
    return;
  }
  const timeZone = el.getAttribute("data-tz") || "Europe/Istanbul";
  updateCountdown(el, timeZone);
  setInterval(() => updateCountdown(el, timeZone), 1000);
}

initCountdown();
