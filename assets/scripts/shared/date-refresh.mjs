// Recheck after sleep or a restored tab as well as at local midnight.
export function watchForDateChange({
  getDate,
  onChange,
  doc = document,
  win = window,
  now = () => new Date(),
  schedule = setTimeout,
  cancel = clearTimeout
}) {
  const initialDate = getDate();
  let timer;
  let changed = false;

  function check() {
    cancel(timer);
    if (changed) return;
    if (getDate() !== initialDate) {
      changed = true;
      onChange();
      return;
    }
    if (doc.visibilityState === "hidden") return;
    const current = now();
    const midnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
    timer = schedule(check, midnight.getTime() - current.getTime() + 50);
  }

  doc.addEventListener("visibilitychange", check);
  win.addEventListener("pageshow", check);
  check();
  return () => {
    changed = true;
    cancel(timer);
    doc.removeEventListener("visibilitychange", check);
    win.removeEventListener("pageshow", check);
  };
}
