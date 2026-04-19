let sharingBound = false;
const canonicalShareOrigin = "https://apoemperday.com";

function isPlainPrimaryActivation(event) {
  return event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.top = "-9999px";
  input.style.left = "-9999px";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function setTemporaryLabel(anchor, nextLabel) {
  const defaultLabel = anchor.dataset.shareDefaultLabel || anchor.textContent || "Share";
  anchor.dataset.shareDefaultLabel = defaultLabel;
  anchor.textContent = nextLabel;

  const existingTimer = Number(anchor.dataset.shareTimerId || "0");
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timerId = window.setTimeout(() => {
    anchor.textContent = anchor.dataset.shareDefaultLabel || "Share";
    anchor.dataset.shareTimerId = "";
  }, 1800);
  anchor.dataset.shareTimerId = String(timerId);
}

function canonicalShareUrl(rawUrl) {
  const url = new URL(rawUrl || window.location.href, window.location.href);
  return `${canonicalShareOrigin}${url.pathname}${url.search}${url.hash}`;
}

async function handleShare(anchor) {
  const shareUrl = canonicalShareUrl(anchor.getAttribute("href") || anchor.href);
  const shareTitle = anchor.dataset.shareTitle || document.title.replace(/\s+\|\s+A Poem Per Day$/, "");

  if (navigator.share) {
    try {
      await navigator.share({ title: shareTitle, url: shareUrl });
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
    }
  }

  await copyText(shareUrl);
  setTemporaryLabel(anchor, "Link copied");
}

export function initSharing() {
  if (sharingBound) {
    return;
  }

  sharingBound = true;
  document.addEventListener("click", (event) => {
    const target = event.target;
    const anchor = target instanceof Element ? target.closest("a[data-share-link]") : null;
    if (!anchor || !isPlainPrimaryActivation(event)) {
      return;
    }

    event.preventDefault();
    void handleShare(anchor);
  });
}
