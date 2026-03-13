const PREFETCH_LIMIT = 8;
const EAGER_PREFETCH_LIMIT = 3;

let initialized = false;
const prefetchedUrls = new Set();

function connectionAllowsPrefetch() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) {
    return true;
  }

  if (connection.saveData) {
    return false;
  }

  const effectiveType = String(connection.effectiveType || "").toLowerCase();
  return effectiveType !== "slow-2g" && effectiveType !== "2g";
}

function supportsLinkPrefetch() {
  const link = document.createElement("link");
  return Boolean(link.relList && typeof link.relList.supports === "function" && link.relList.supports("prefetch"));
}

function resolvedPrefetchUrl(anchor) {
  if (!anchor || anchor.dataset.prefetch === "off") {
    return "";
  }

  if (anchor.hasAttribute("download") || anchor.relList?.contains("external")) {
    return "";
  }

  const target = String(anchor.getAttribute("target") || "").trim().toLowerCase();
  if (target && target !== "_self") {
    return "";
  }

  const rawHref = String(anchor.getAttribute("href") || "").trim();
  if (!rawHref || rawHref.startsWith("#")) {
    return "";
  }

  let url;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return "";
  }

  if (url.origin !== window.location.origin || !/^https?:$/.test(url.protocol)) {
    return "";
  }

  url.hash = "";

  if (url.pathname === window.location.pathname && url.search === window.location.search) {
    return "";
  }

  return url.href;
}

function requestDocumentPrefetch(url) {
  if (prefetchedUrls.has(url) || prefetchedUrls.size >= PREFETCH_LIMIT) {
    return;
  }

  prefetchedUrls.add(url);

  if (supportsLinkPrefetch()) {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "document";
    link.href = url;
    document.head.append(link);
    return;
  }

  void fetch(url, {
    credentials: "same-origin"
  }).catch(() => {
    prefetchedUrls.delete(url);
  });
}

function scheduleIdleWork(callback) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => {
      callback();
    }, { timeout: 1500 });
    return;
  }

  window.setTimeout(() => {
    callback();
  }, 250);
}

function warmEagerLinks() {
  const eagerLinks = document.querySelectorAll('a[data-prefetch="eager"][href]');
  let warmedCount = 0;

  for (const anchor of eagerLinks) {
    if (warmedCount >= EAGER_PREFETCH_LIMIT || prefetchedUrls.size >= PREFETCH_LIMIT) {
      return;
    }

    const url = resolvedPrefetchUrl(anchor);
    if (!url || prefetchedUrls.has(url)) {
      continue;
    }

    requestDocumentPrefetch(url);
    warmedCount += 1;
  }
}

function prefetchFromEventTarget(target) {
  if (!(target instanceof Element)) {
    return;
  }

  const anchor = target.closest("a[href]");
  const url = resolvedPrefetchUrl(anchor);
  if (!url) {
    return;
  }

  requestDocumentPrefetch(url);
}

export function initLinkPrefetching() {
  if (initialized || !document.head || navigator.onLine === false || !connectionAllowsPrefetch()) {
    return;
  }

  initialized = true;

  document.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") {
      prefetchFromEventTarget(event.target);
    }
  }, { capture: true, passive: true });

  document.addEventListener("focusin", (event) => {
    prefetchFromEventTarget(event.target);
  });

  document.addEventListener("touchstart", (event) => {
    prefetchFromEventTarget(event.target);
  }, { capture: true, passive: true });

  scheduleIdleWork(() => {
    warmEagerLinks();
  });
}
