if (window !== window.top) {
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target.closest("a");
      if (a && a.href && !a.href.startsWith("javascript:")) {
        a.setAttribute("target", "_self");
        e.stopPropagation();
      }
    },
    true,
  );

  let lastUrl = "";
  let lastTitle = "";

  const notifySidebar = () => {
    const currentUrl = window.location.href;
    let currentTitle = document.title;

    if (!currentTitle && currentUrl !== "about:blank") {
      try {
        currentTitle = new URL(currentUrl).hostname;
      } catch (e) {}
    }

    if (currentUrl !== lastUrl || currentTitle !== lastTitle) {
      lastUrl = currentUrl;
      lastTitle = currentTitle;

      browser.runtime
        .sendMessage({
          type: "NAVIGATED",
          tabId: window.name,
          url: currentUrl,
          title: currentTitle || "Nova Aba",
        })
        .catch(() => {});
    }
  };

  notifySidebar();
  window.addEventListener("popstate", notifySidebar);
  window.addEventListener("hashchange", notifySidebar);
  window.addEventListener("load", notifySidebar);
  setInterval(notifySidebar, 1000);

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "RELOAD_TAB" && msg.tabId === window.name) {
      window.location.reload();
    }
  });
}
