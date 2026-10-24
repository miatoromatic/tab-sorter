"use strict";

// Shared by the background script (saving a window) and the merge page.
const TabSorter = (() => {
  const FORMAT = "tab-sorter";
  const VERSION = 2;
  const DATA_ELEMENT_ID = "tab-sorter-data";
  const ICON_SIZE = 32;
  const ICON_TIMEOUT_MS = 4000;
  const SAVED_FILES_KEY = "savedFiles";

  // Tabs with nothing worth revisiting. They are still closed, just not saved.
  const BLANK_URLS = new Set([
    "about:blank",
    "about:newtab",
    "about:home",
    "about:privatebrowsing",
  ]);

  // Icons are only ever embedded as base64 PNGs; anything else is dropped so a
  // merged file can't inject CSS through the icon rules.
  const ICON_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

  // Reader view wraps the real page: about:reader?url=https%3A%2F%2F...
  function unwrapReaderUrl(url) {
    if (!url.startsWith("about:reader?")) return url;
    const inner = new URLSearchParams(url.slice("about:reader?".length)).get("url");
    return inner || url;
  }

  function isWorthSaving(url) {
    return Boolean(url) && !BLANK_URLS.has(url) && !url.startsWith("moz-extension:");
  }

  // Never let a merged file smuggle in script links.
  function isSafeUrl(url) {
    try {
      const { protocol } = new URL(url);
      return protocol !== "javascript:" && protocol !== "data:";
    } catch {
      return false;
    }
  }

  function validIcon(icon) {
    return typeof icon === "string" && ICON_PATTERN.test(icon) ? icon : null;
  }

  function entryFromTab(tab, savedAt, icons = new Map()) {
    const url = unwrapReaderUrl(tab.url || "");
    if (!isWorthSaving(url)) return null;
    return { url, title: tab.title || url, savedAt, icon: icons.get(tab.favIconUrl) || null };
  }

  // Fetches a favicon and shrinks it to a small PNG data URL so the saved file
  // shows icons offline without contacting the sites again.
  async function iconToDataUrl(src) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ICON_TIMEOUT_MS);
    try {
      const response = await fetch(src, { signal: controller.signal, cache: "force-cache" });
      if (!response.ok) return null;
      const objectUrl = URL.createObjectURL(await response.blob());
      try {
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = ICON_SIZE;
        canvas.getContext("2d").drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
        return validIcon(canvas.toDataURL("image/png"));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      return null; // unreachable, timed out or not an image: fall back to a letter badge
    } finally {
      clearTimeout(timer);
    }
  }

  // Map of favIconUrl -> PNG data URL for every tab icon that could be loaded.
  async function collectIcons(tabs) {
    const sources = [...new Set(tabs.map((tab) => tab.favIconUrl).filter(Boolean))];
    const icons = new Map();
    await Promise.all(
      sources.map(async (src) => {
        const icon = await iconToDataUrl(src);
        if (icon) icons.set(src, icon);
      }),
    );
    return icons;
  }

  // Sort key that keeps subdomains of one site together (docs.google.com next to
  // mail.google.com) without shipping the public suffix list. Handles the common
  // two-part country suffixes like co.uk and com.au.
  function siteKey(host) {
    if (/^[\d.]+$/.test(host) || host.startsWith("[")) return host;
    const labels = host.split(".");
    let keep = 2;
    if (labels.length > 2 && labels.at(-1).length === 2 && labels.at(-2).length <= 3) {
      keep = 3;
    }
    return labels.slice(-keep).join(".");
  }

  // Returns the group a URL belongs to. `site` is null for non-web groups,
  // which sort after all the websites.
  function groupOf(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { name: "Other", site: null };
    }
    switch (parsed.protocol) {
      case "http:":
      case "https:":
      case "ftp:": {
        const host = parsed.hostname.replace(/^www\./, "");
        return host ? { name: host, site: siteKey(host) } : { name: "Other", site: null };
      }
      case "file:":
        return { name: "Local files", site: null };
      default:
        return { name: `${parsed.protocol} pages`, site: null };
    }
  }

  function compareGroups(a, b) {
    if ((a.site === null) !== (b.site === null)) return a.site === null ? 1 : -1;
    return (a.site || "").localeCompare(b.site || "") || a.name.localeCompare(b.name);
  }

  // Drops duplicate URLs (first one wins) and groups the rest by domain.
  // Entries keep their original order inside each group.
  function groupEntries(entries) {
    const seen = new Set();
    const groups = new Map();
    for (const entry of entries) {
      if (seen.has(entry.url)) continue;
      seen.add(entry.url);
      const { name, site } = groupOf(entry.url);
      if (!groups.has(name)) groups.set(name, { name, site, entries: [] });
      groups.get(name).entries.push(entry);
    }
    return [...groups.values()].sort(compareGroups);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }

  // Local time, safe for file names: 2026-10-24_0815
  function timestamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
      `${pad(date.getHours())}${pad(date.getMinutes())}`
    );
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  // Colored letter shown when a site has no usable icon.
  function letterBadge(name) {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.codePointAt(0)) % 360;
    const letter = (name.match(/[\p{L}\p{N}]/u) || ["?"])[0].toUpperCase();
    return `<span class="icon letter" style="--hue:${hash}" aria-hidden="true">${escapeHtml(letter)}</span>`;
  }

  function renderIcon(icon, fallbackName, iconIds) {
    return icon && iconIds.has(icon)
      ? `<span class="icon i${iconIds.get(icon)}" aria-hidden="true"></span>`
      : letterBadge(fallbackName);
  }

  function renderEntry(entry, index, group, iconIds) {
    const saved = entry.savedAt ? formatDate(entry.savedAt) : "";
    const tooltip = saved ? `${entry.url}\nSaved ${saved}` : entry.url;
    return (
      `<li data-index="${index}">${renderIcon(entry.icon, group.name, iconIds)}` +
      `<div class="text"><a href="${escapeHtml(entry.url)}" title="${escapeHtml(tooltip)}">` +
      `${escapeHtml(entry.title)}</a><span class="url">${escapeHtml(entry.url)}</span></div>` +
      `<button type="button" class="delete" title="Remove this link" aria-label="Remove this link">×</button></li>`
    );
  }

  function renderGroup(group, firstIndex, iconIds) {
    const groupIcon = (group.entries.find((entry) => entry.icon) || {}).icon;
    const items = group.entries.map((entry, i) => renderEntry(entry, firstIndex + i, group, iconIds));
    return (
      `<details class="group" open data-domain="${escapeHtml(group.name.toLowerCase())}">\n` +
      `<summary>${renderIcon(groupIcon, group.name, iconIds)}` +
      `<span class="domain">${escapeHtml(group.name)}</span>` +
      `<span class="count">${group.entries.length}</span>` +
      `<button type="button" class="delete" title="Remove this whole group" ` +
      `aria-label="Remove the ${escapeHtml(group.name)} group">×</button></summary>\n` +
      `<ul>\n${items.join("\n")}\n</ul>\n</details>`
    );
  }

  // The saved page's own stylesheet and script, inlined into every file.
  let pageAssets;
  function loadPageAssets() {
    pageAssets ??= Promise.all(
      ["saved-page.css", "saved-page.js"].map((name) =>
        fetch(browser.runtime.getURL(name)).then((response) => response.text()),
      ),
    ).then(([css, js]) => ({ css, js }));
    return pageAssets;
  }

  // Builds the standalone HTML page. The entries are also embedded as JSON so the
  // merge page can read them back exactly instead of scraping links.
  async function renderDocument(entries, { title, createdAt = new Date().toISOString(), mergedFrom = 0 }) {
    const { css, js } = await loadPageAssets();
    const groups = groupEntries(entries);
    const unique = groups.flatMap((group) => group.entries);

    // Each distinct icon is stored once, as a CSS class, however many links use it.
    const icons = [...new Set(unique.map((entry) => entry.icon).filter(validIcon))];
    const iconIds = new Map(icons.map((icon, i) => [icon, i]));
    const iconCss = icons.map((icon, i) => `.i${i}{background-image:url("${icon}")}`).join("\n");

    const data = {
      format: FORMAT,
      version: VERSION,
      createdAt,
      icons,
      entries: unique.map(({ url, title: entryTitle, savedAt, icon }) => ({
        url,
        title: entryTitle,
        savedAt,
        icon: iconIds.has(icon) ? iconIds.get(icon) : null,
      })),
    };
    // "<" escaped so a title containing </script> can't end the data block.
    const json = JSON.stringify(data).replace(/</g, "\\u003c");

    let index = 0;
    const groupHtml = groups.map((group) => {
      const html = renderGroup(group, index, iconIds);
      index += group.entries.length;
      return html;
    });

    const extraStats = [mergedFrom ? `merged from ${mergedFrom} files` : "", `saved ${formatDate(createdAt)}`]
      .filter(Boolean)
      .map((text) => ` · ${escapeHtml(text)}`)
      .join("");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${css}
</style>
<style id="icons">
${iconCss}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="stats"><span id="stat-tabs">${plural(unique.length, "tab")}</span> · <span id="stat-domains">${plural(groups.length, "domain")}</span>${extraStats}</p>
<p id="notice" role="status" hidden></p>
<div class="toolbar">
  <input id="filter" type="search" placeholder="Filter by title, URL or domain…" autocomplete="off">
  <button type="button" id="expand">Expand all</button>
  <button type="button" id="collapse">Collapse all</button>
</div>
${groupHtml.join("\n")}
</main>
<div id="savebar" hidden>
  <span id="savebar-text"></span>
  <button type="button" id="undo">Undo</button>
  <button type="button" id="save" class="primary">Save changes</button>
</div>
<script type="application/json" id="${DATA_ELEMENT_ID}">${json}</script>
<script>
${js}
</script>
</body>
</html>
`;
  }

  // Reads entries back out of a saved page. Falls back to collecting every link,
  // so other HTML files (e.g. a Firefox bookmarks export) can be merged in too.
  function extractEntries(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const dataElement = doc.getElementById(DATA_ELEMENT_ID);
    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent);
        if (data && data.format === FORMAT && Array.isArray(data.entries)) {
          const icons = Array.isArray(data.icons) ? data.icons : [];
          return data.entries
            .filter((e) => e && typeof e.url === "string" && isSafeUrl(e.url))
            .map((e) => ({
              url: e.url,
              title: typeof e.title === "string" && e.title ? e.title : e.url,
              savedAt: typeof e.savedAt === "string" ? e.savedAt : data.createdAt || null,
              icon: Number.isInteger(e.icon) ? validIcon(icons[e.icon]) : null,
            }));
        }
      } catch {
        // Damaged data block: fall through to scraping the links.
      }
    }
    return [...doc.querySelectorAll("a[href]")]
      .map((a) => ({
        url: a.getAttribute("href").trim(),
        title: a.textContent.trim(),
        savedAt: null,
        icon: validIcon(a.getAttribute("icon")), // bookmarks exports carry icons this way
      }))
      .filter((e) => isSafeUrl(e.url))
      .map((e) => ({ ...e, title: e.title || e.url }));
  }

  // Paths as Firefox reports them (C:\Users\...) and as file: URLs give them
  // (/C:/Users/...) in one comparable form.
  function normalizePath(path) {
    const slashed = path.replace(/\\/g, "/");
    const windows = slashed.match(/^\/?([A-Za-z]:\/.*)$/);
    return windows ? windows[1].toLowerCase() : slashed;
  }

  // Files the add-on wrote into Downloads/tab-sorter/ are remembered so that a
  // saved page can later ask to be overwritten with an edited version.
  async function rememberSavedFile(absolutePath) {
    const name = absolutePath.split(/[\\/]/).pop();
    const { [SAVED_FILES_KEY]: files = {} } = await browser.storage.local.get(SAVED_FILES_KEY);
    files[normalizePath(absolutePath)] = `tab-sorter/${name}`;
    await browser.storage.local.set({ [SAVED_FILES_KEY]: files });
  }

  async function savedFileFor(absolutePath) {
    const { [SAVED_FILES_KEY]: files = {} } = await browser.storage.local.get(SAVED_FILES_KEY);
    return files[normalizePath(absolutePath)] || null;
  }

  // Saves through the downloads API and resolves with the finished download item.
  // Rejects if the user cancels the Save As dialog or the download fails.
  async function downloadHtml(html, filename, { saveAs = false, conflictAction = "uniquify" } = {}) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const id = await browser.downloads.download({ url, filename, saveAs, conflictAction });
      await waitForDownload(id);
      const [item] = await browser.downloads.search({ id });
      // Only files saved without a dialog are known to be in Downloads/tab-sorter/.
      if (!saveAs && item) await rememberSavedFile(item.filename);
      return item;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function waitForDownload(id) {
    return new Promise((resolve, reject) => {
      const settle = (state) => {
        if (state === "complete") {
          browser.downloads.onChanged.removeListener(listener);
          resolve();
        } else if (state === "interrupted") {
          browser.downloads.onChanged.removeListener(listener);
          reject(new Error("The download was interrupted."));
        }
      };
      const listener = (delta) => {
        if (delta.id === id && delta.state) settle(delta.state.current);
      };
      browser.downloads.onChanged.addListener(listener);
      // Small files can finish before the listener is attached.
      browser.downloads.search({ id }).then(([item]) => item && settle(item.state));
    });
  }

  return {
    entryFromTab,
    collectIcons,
    groupEntries,
    renderDocument,
    extractEntries,
    downloadHtml,
    normalizePath,
    savedFileFor,
    timestamp,
  };
})();
