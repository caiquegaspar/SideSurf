"use strict";

let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let layoutMode = "tabbed";

const MAX_TABS = 6;
const newTabText = browser.i18n.getMessage("newTab");
const closeTitle = browser.i18n.getMessage("closeTab");

const urlBar = document.getElementById("url-bar");
const btnBack = document.getElementById("btn-back");
const btnForward = document.getElementById("btn-forward");
const btnReload = document.getElementById("btn-reload");
const btnZoomOut = document.getElementById("btn-zoom-out");
const btnZoomIn = document.getElementById("btn-zoom-in");
const zoomLabel = document.getElementById("zoom-label");
const btnLayout = document.getElementById("btn-layout");
const btnNewTab = document.getElementById("btn-new-tab");
const tabBar = document.getElementById("tab-bar");
const contentArea = document.getElementById("content-area");

async function saveSession() {
  const sessionTabs = tabs.map((t) => ({
    id: t.id,
    title: t.title,
    url: t.url,
    history: t.history,
    histIndex: t.histIndex,
    zoom: t.zoom,
  }));
  await browser.storage.local.set({
    sidepanelSession: {
      tabs: sessionTabs,
      activeTabId,
      layoutMode,
      tabCounter,
    },
  });
}

async function loadSession() {
  const data = await browser.storage.local.get("sidepanelSession");
  if (
    data.sidepanelSession &&
    data.sidepanelSession.tabs &&
    data.sidepanelSession.tabs.length > 0
  ) {
    const session = data.sidepanelSession;
    tabCounter = session.tabCounter || 0;
    layoutMode = session.layoutMode || "tabbed";
    btnLayout.textContent = layoutMode === "tiling" ? "⊟" : "⊡";
    btnLayout.title =
      layoutMode === "tabbed"
        ? browser.i18n.getMessage("switchToTiling")
        : browser.i18n.getMessage("switchToTabs");

    session.tabs.forEach((tData) => {
      const tab = buildTabDOM(tData.id);
      tab.title = tData.title || newTabText;
      tab.url = tData.url || "";
      tab.history = tData.history || [];
      tab.histIndex = tData.histIndex !== undefined ? tData.histIndex : -1;

      tabs.push(tab);

      if (tab.url && tab.url !== "about:blank") {
        tab.emptyScreen.style.display = "none";
        tab.iframe.src = tab.url;
      }
      setZoom(tab, tData.zoom || 100);
    });

    renderContent();
    switchTab(session.activeTabId || tabs[0].id);
  } else {
    createTab();
  }
}

function buildTabDOM(id) {
  const iframe = document.createElement("iframe");

  iframe.className = "panel-iframe";
  iframe.name = id;
  iframe.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-forms allow-downloads",
  );
  iframe.setAttribute("allow", "fullscreen");

  const tile = document.createElement("div");
  tile.className = "tile";
  tile.dataset.tabId = id;

  const label = document.createElement("div");
  label.className = "tile-label";

  const labelSpan = document.createElement("span");
  labelSpan.textContent = browser.i18n.getMessage("newTab");

  const labelBtn = document.createElement("button");
  labelBtn.title = browser.i18n.getMessage("closeTab");
  labelBtn.textContent = "×";
  labelBtn.addEventListener("click", () => closeTab(id));

  label.appendChild(labelSpan);
  label.appendChild(labelBtn);

  const emptyScreen = document.createElement("div");
  emptyScreen.className = "empty-screen";

  emptyScreen.insertAdjacentHTML(
    "beforeend",
    '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><circle cx="24" cy="24" r="20"/><path d="M16 24h16M24 16v16" stroke-linecap="round"/></svg>',
  );

  const emptyText = document.createElement("p");
  emptyText.textContent = browser.i18n.getMessage("searchPlaceholder");
  emptyScreen.appendChild(emptyText);

  tile.appendChild(label);
  tile.appendChild(emptyScreen);
  tile.appendChild(iframe);
  contentArea.appendChild(tile);

  return {
    id,
    title: newTabText,
    url: "",
    history: [],
    histIndex: -1,
    zoom: 100,
    iframe,
    tile,
    emptyScreen,
  };
}

function createTab(url = "") {
  if (tabs.length >= MAX_TABS) {
    alert(browser.i18n.getMessage("tabLimitAlert", [MAX_TABS]));
    return null;
  }

  tabCounter++;
  const id = `tab-${tabCounter}`;
  const tab = buildTabDOM(id);
  tabs.push(tab);

  renderContent();
  switchTab(id);

  if (url) navigate(url, tab);
  saveSession();
  return tab;
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "OPEN_URL_IN_SIDEBAR") {
    const activeTab = getActiveTab();
    if (activeTab && (!activeTab.url || activeTab.url === "about:blank")) {
      navigate(msg.url, activeTab);
    } else {
      createTab(msg.url);
    }
    return;
  }

  if (msg.type === "NAVIGATED") {
    const tab = tabs.find((t) => t.id === msg.tabId);
    if (!tab) return;

    if (tab.history[tab.histIndex] !== msg.url) {
      tab.history = tab.history.slice(0, tab.histIndex + 1);
      tab.history.push(msg.url);
      tab.histIndex = tab.history.length - 1;
    }

    tab.url = msg.url;
    tab.title = msg.title;
    tab.emptyScreen.style.display =
      msg.url === "about:blank" || !msg.url ? "flex" : "none";

    updateTileLabels();
    renderTabBar();

    if (activeTabId === tab.id) {
      updateUrlBar(tab.url);
      updateNavButtons(tab);
    }
    saveSession();
  }
});

function navigate(input, tab = null) {
  tab = tab || getActiveTab();
  if (!tab) return;

  const url = resolveInput(input);

  tab.emptyScreen.style.display = "none";
  tab.iframe.src = url;
}

function resolveInput(input) {
  input = input.trim();

  if (!input) return "about:blank";
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(input)) return input;
  if (!input.includes(" ") && input.includes(".")) return `https://${input}`;

  return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`;
}

function goBack() {
  const tab = getActiveTab();
  if (!tab || tab.histIndex <= 0) return;
  tab.histIndex--;
  tab.iframe.src = tab.history[tab.histIndex];
  saveSession();
}

function goForward() {
  const tab = getActiveTab();
  if (!tab || tab.histIndex >= tab.history.length - 1) return;
  tab.histIndex++;
  tab.iframe.src = tab.history[tab.histIndex];
  saveSession();
}

function reload() {
  const tab = getActiveTab();
  if (!tab || !tab.url || tab.url === "about:blank") return;
  browser.runtime
    .sendMessage({ type: "RELOAD_TAB", tabId: tab.id })
    .catch(() => {
      tab.iframe.src = tab.url;
    });
}

function closeTab(id) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;

  tabs[index].tile.remove();
  tabs.splice(index, 1);

  if (tabs.length === 0) {
    createTab();
  } else {
    renderContent();

    if (activeTabId === id)
      switchTab(tabs[Math.min(index, tabs.length - 1)].id);
    else switchTab(activeTabId);
  }
  saveSession();
}

function switchTab(id) {
  activeTabId = id;
  const tab = getActiveTab();
  if (tab) {
    updateUrlBar(tab.url);
    updateZoomLabel(tab.zoom);
    updateNavButtons(tab);
  }
  renderTabBar();

  tabs.forEach((t) => {
    if (layoutMode === "tabbed") {
      t.tile.classList.toggle("active", t.id === activeTabId);
      t.tile.style.border = "";
    } else {
      t.tile.classList.add("active");
      t.tile.style.borderColor =
        t.id === activeTabId ? "var(--accent)" : "var(--border)";
    }
  });

  saveSession();
}

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

function toggleLayout() {
  layoutMode = layoutMode === "tabbed" ? "tiling" : "tabbed";
  btnLayout.title =
    layoutMode === "tabbed"
      ? browser.i18n.getMessage("switchToTiling")
      : browser.i18n.getMessage("switchToTabs");
  btnLayout.textContent = layoutMode === "tiling" ? "⊟" : "⊡";

  renderContent();
  switchTab(activeTabId);
  saveSession();
}

function renderContent() {
  document.querySelectorAll(".splitter").forEach((s) => s.remove());
  contentArea.removeAttribute("style");
  contentArea.className = `content-area ${layoutMode}`;

  tabs.forEach((tab) => {
    tab.tile.classList.remove("active");
    tab.tile.removeAttribute("style");
  });

  if (layoutMode === "tabbed") {
    const active = getActiveTab();
    if (active) active.tile.classList.add("active");
  } else {
    const count = tabs.length;
    tabs.forEach((tab) => tab.tile.classList.add("active"));

    if (count === 1) {
      contentArea.style.display = "grid";
      contentArea.style.gridTemplateColumns = "1fr";
    } else if (count === 2) {
      contentArea.style.display = "flex";
      contentArea.style.flexDirection = "column";
      tabs[0].tile.style.flex = "1";
      tabs[1].tile.style.flex = "1";
      contentArea.insertBefore(
        buildSplitter(tabs[0].tile, tabs[1].tile, "horizontal"),
        tabs[1].tile,
      );
    } else {
      contentArea.style.display = "grid";
      const cols = 2;
      const rows = Math.ceil(count / cols);
      contentArea.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      contentArea.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

      tabs.forEach((tab, index) => {
        if (index === count - 1 && count % 2 !== 0) {
          tab.tile.style.gridColumn = "1 / -1";
        } else {
          tab.tile.style.gridColumn = "";
        }
      });
    }
  }
}

function renderTabBar() {
  tabBar.innerHTML = "";
  const closeTitle = browser.i18n.getMessage("closeTab");

  tabs.forEach((tab) => {
    const el = document.createElement("div");
    el.className = `tab-item${tab.id === activeTabId ? " active" : ""}`;

    const titleSpan = document.createElement("span");
    titleSpan.className = "tab-title";
    titleSpan.title = tab.title;
    titleSpan.textContent = tab.title;

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.title = closeTitle;
    closeBtn.textContent = "×";

    el.appendChild(titleSpan);
    el.appendChild(closeBtn);

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    el.addEventListener("click", () => switchTab(tab.id));
    tabBar.appendChild(el);
  });
}

function updateTileLabels() {
  tabs.forEach((tab) => {
    const span = tab.tile.querySelector(".tile-label span");
    if (span) {
      span.textContent = tab.title;
      span.title = tab.title;
    }
  });
}

function buildSplitter(el1, el2, direction) {
  const splitter = document.createElement("div");
  splitter.className = `splitter${direction === "vertical" ? " vertical" : ""}`;
  if (direction === "horizontal") {
    splitter.style.width = "100%";
    splitter.style.height = "6px";
    splitter.style.cursor = "ns-resize";
  } else {
    splitter.style.height = "100%";
    splitter.style.width = "6px";
    splitter.style.cursor = "ew-resize";
  }

  let startPos = 0,
    startSize1 = 0,
    startSize2 = 0;
  const onMouseMove = (e) => {
    const delta =
      direction === "horizontal" ? e.clientY - startPos : e.clientX - startPos;
    const totalSize = startSize1 + startSize2;
    const newSize1 = Math.max(40, Math.min(totalSize - 40, startSize1 + delta));
    el1.style.flex = "none";
    el2.style.flex = "none";
    if (direction === "horizontal") {
      el1.style.height = `${newSize1}px`;
      el2.style.height = `${totalSize - newSize1}px`;
    } else {
      el1.style.width = `${newSize1}px`;
      el2.style.width = `${totalSize - newSize1}px`;
    }
  };
  const onMouseUp = () => {
    splitter.classList.remove("dragging");
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
  splitter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    splitter.classList.add("dragging");
    startPos = direction === "horizontal" ? e.clientY : e.clientX;
    startSize1 =
      direction === "horizontal"
        ? el1.getBoundingClientRect().height
        : el1.getBoundingClientRect().width;
    startSize2 =
      direction === "horizontal"
        ? el2.getBoundingClientRect().height
        : el2.getBoundingClientRect().width;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
  return splitter;
}

function setZoom(tab, zoom) {
  tab.zoom = Math.max(50, Math.min(200, zoom));
  const scale = tab.zoom / 100;
  tab.iframe.style.transformOrigin = "top left";
  tab.iframe.style.transform = `scale(${scale})`;
  tab.iframe.style.width = `${(1 / scale) * 100}%`;
  tab.iframe.style.height = `${(1 / scale) * 100}%`;
  if (activeTabId === tab.id) updateZoomLabel(tab.zoom);
  saveSession();
}

function updateUrlBar(url) {
  urlBar.value = url === "about:blank" ? "" : url || "";
}

function updateZoomLabel(zoom) {
  zoomLabel.textContent = `${zoom}%`;
}

function updateNavButtons(tab) {
  btnBack.disabled = !tab || tab.histIndex <= 0;
  btnForward.disabled = !tab || tab.histIndex >= tab.history.length - 1;
}

urlBar.addEventListener("keydown", (e) => {
  if (e.key === "Enter") navigate(urlBar.value);
});
urlBar.addEventListener("focus", () => urlBar.select());
btnBack.addEventListener("click", goBack);
btnForward.addEventListener("click", goForward);
btnReload.addEventListener("click", reload);
btnZoomOut.addEventListener("click", () => {
  const t = getActiveTab();
  if (t) setZoom(t, t.zoom - 10);
});
btnZoomIn.addEventListener("click", () => {
  const t = getActiveTab();
  if (t) setZoom(t, t.zoom + 10);
});
zoomLabel.addEventListener("click", () => {
  const t = getActiveTab();
  if (t) setZoom(t, 100);
});
btnLayout.addEventListener("click", toggleLayout);
btnNewTab.addEventListener("click", () => createTab());

btnBack.title = browser.i18n.getMessage("btnBackTitle");
btnForward.title = browser.i18n.getMessage("btnForwardTitle");
btnReload.title = browser.i18n.getMessage("btnReloadTitle");
urlBar.placeholder = browser.i18n.getMessage("searchPlaceholder");
btnZoomOut.title = browser.i18n.getMessage("btnZoomOutTitle");
btnZoomIn.title = browser.i18n.getMessage("btnZoomInTitle");
zoomLabel.title = browser.i18n.getMessage("zoomLabelTitle");
btnNewTab.title = browser.i18n.getMessage("btnNewTabTitle");

loadSession();
