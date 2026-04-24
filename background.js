const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0";
const SPOOF_DOMAINS = [
  "x.com",
  "twitter.com",
  "linkedin.com",
  "youtube.com",
  "twitch.tv",
  "netflix.com",
  "spotify.com",
  "hulu.com",
  "disneyplus.com",
  "reddit.com",
  "pinterest.com",
  "tumblr.com",
  "snapchat.com",
  "duckduckgo.com",
  "bing.com",
];

browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.tabId === -1 && details.type === "sub_frame") {
      try {
        const url = new URL(details.url);
        const needsSpoof = SPOOF_DOMAINS.some((d) => url.hostname.endsWith(d));

        if (needsSpoof) {
          const headers = details.requestHeaders;
          for (let i = 0; i < headers.length; i++) {
            if (headers[i].name.toLowerCase() === "user-agent") {
              headers[i].value = MOBILE_UA;
              return { requestHeaders: headers };
            }
          }
        }
      } catch (e) {}
    }
    return {};
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestHeaders"],
);

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId === -1) {
      const filtered = details.responseHeaders.filter((header) => {
        const name = header.name.toLowerCase();
        return !(
          name === "x-frame-options" ||
          name === "content-security-policy" ||
          name === "content-security-policy-report-only" ||
          name === "cross-origin-opener-policy" ||
          name === "cross-origin-embedder-policy"
        );
      });
      return { responseHeaders: filtered };
    }
    return {};
  },
  { urls: ["<all_urls>"] },
  ["blocking", "responseHeaders"],
);

browser.contextMenus.create({
  id: "open-in-sidesurf-page",
  title: browser.i18n.getMessage("menuPage"),
  contexts: ["page", "tab"],
});

browser.contextMenus.create({
  id: "open-in-sidesurf-link",
  title: browser.i18n.getMessage("menuLink"),
  contexts: ["link"],
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  let urlToOpen = info.linkUrl || info.pageUrl || (tab ? tab.url : null);
  if (info.menuItemId === "open-in-sidesurf-page" && tab) {
    urlToOpen = tab.url;
  }
  if (urlToOpen) await openInSideSurf(urlToOpen);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    tab.url &&
    !tab.url.startsWith("about:") &&
    !tab.url.startsWith("moz-extension:")
  ) {
    browser.pageAction.show(tabId);
  } else {
    browser.pageAction.hide(tabId);
  }
});

browser.pageAction.onClicked.addListener(async (tab) => {
  await openInSideSurf(tab.url);
});

async function openInSideSurf(url) {
  try {
    await browser.sidebarAction.open();

    setTimeout(() => {
      browser.runtime
        .sendMessage({ type: "OPEN_URL_IN_SIDEBAR", url })
        .catch(() => {});
    }, 400);
  } catch (e) {
    console.error("SideSurf: Erro ao abrir aba", e);
  }
}
