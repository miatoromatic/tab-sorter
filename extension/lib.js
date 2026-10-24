"use strict";

// Shared by the background script (saving a window) and the merge page.
const TabSorter = (() => {
  const FORMAT = "tab-sorter";
  const VERSION = 1;
  const DATA_ELEMENT_ID = "tab-sorter-data";

  // Tabs with nothing worth revisiting. They are still closed, just not saved.
  const BLANK_URLS = new Set([
    "about:blank",
    "about:newtab",
    "about:home",
    "about:privatebrowsing",
  ]);

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

  function entryFromTab(tab, savedAt) {
    const url = unwrapReaderUrl(tab.url || "");
    if (!isWorthSaving(url)) return null;
    return { url, title: tab.title || url, savedAt };
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

  function renderEntry(entry) {
    const saved = entry.savedAt ? formatDate(entry.savedAt) : "";
    const tooltip = saved ? `${entry.url}\nSaved ${saved}` : entry.url;
    return (
      `<li><a href="${escapeHtml(entry.url)}" title="${escapeHtml(tooltip)}">` +
      `${escapeHtml(entry.title)}</a><span class="url">${escapeHtml(entry.url)}</span></li>`
    );
  }

  function renderGroup(group) {
    return (
      `<details class="group" open data-domain="${escapeHtml(group.name.toLowerCase())}">\n` +
      `<summary><span class="domain">${escapeHtml(group.name)}</span>` +
      `<span class="count">${group.entries.length}</span></summary>\n` +
      `<ul>\n${group.entries.map(renderEntry).join("\n")}\n</ul>\n</details>`
    );
  }

  // Builds the standalone HTML page. The entries are also embedded as JSON so the
  // merge page can read them back exactly instead of scraping links.
  function renderDocument(entries, { title, createdAt = new Date().toISOString(), mergedFrom = 0 }) {
    const groups = groupEntries(entries);
    const unique = groups.flatMap((group) => group.entries);
    const data = { format: FORMAT, version: VERSION, createdAt, entries: unique };
    // "<" escaped so a title containing </script> can't end the data block.
    const json = JSON.stringify(data).replace(/</g, "\\u003c");

    const stats = [
      `${unique.length} ${unique.length === 1 ? "tab" : "tabs"}`,
      `${groups.length} ${groups.length === 1 ? "domain" : "domains"}`,
      mergedFrom ? `merged from ${mergedFrom} files` : "",
      `saved ${formatDate(createdAt)}`,
    ].filter(Boolean);

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --bg: #f7f7f9; --card: #fff; --text: #1d1d21; --muted: #6b6b76;
    --border: #e2e2e8; --accent: #3b6fd8; --chip: #eef1f8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #17171b; --card: #222228; --text: #ececf1; --muted: #9a9aa6;
      --border: #34343c; --accent: #7fa4f0; --chip: #2c2f3a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 900px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .stats { color: var(--muted); margin: 0 0 16px; }
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .toolbar input {
    flex: 1 1 240px; padding: 8px 10px; font: inherit; color: inherit;
    background: var(--card); border: 1px solid var(--border); border-radius: 6px;
  }
  .toolbar button {
    padding: 8px 12px; font: inherit; color: inherit; cursor: pointer;
    background: var(--card); border: 1px solid var(--border); border-radius: 6px;
  }
  .group {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px; margin-bottom: 10px;
  }
  summary {
    display: flex; align-items: center; gap: 8px; padding: 10px 14px;
    cursor: pointer; font-weight: 600; list-style-position: inside;
  }
  .count {
    font-size: 0.8rem; font-weight: 500; color: var(--muted);
    background: var(--chip); border-radius: 999px; padding: 1px 8px;
  }
  ul { list-style: none; margin: 0; padding: 0 14px 10px; }
  li { padding: 6px 0; border-top: 1px solid var(--border); min-width: 0; }
  li a { color: var(--accent); text-decoration: none; overflow-wrap: anywhere; }
  li a:hover { text-decoration: underline; }
  li a:visited { color: var(--muted); }
  .url {
    display: block; font-size: 0.8rem; color: var(--muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="stats">${escapeHtml(stats.join(" · "))}</p>
<div class="toolbar">
  <input id="filter" type="search" placeholder="Filter by title, URL or domain…" autocomplete="off">
  <button type="button" id="expand">Expand all</button>
  <button type="button" id="collapse">Collapse all</button>
</div>
${groups.map(renderGroup).join("\n")}
</main>
<script type="application/json" id="${DATA_ELEMENT_ID}">${json}</script>
<script>
  const groups = document.querySelectorAll(".group");
  document.getElementById("filter").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    for (const group of groups) {
      const domainHit = group.dataset.domain.includes(query);
      let visible = 0;
      for (const item of group.querySelectorAll("li")) {
        const hit = !query || domainHit || item.textContent.toLowerCase().includes(query);
        item.hidden = !hit;
        if (hit) visible++;
      }
      group.hidden = visible === 0;
      if (query && visible) group.open = true;
    }
  });
  document.getElementById("expand").onclick = () => groups.forEach((g) => (g.open = true));
  document.getElementById("collapse").onclick = () => groups.forEach((g) => (g.open = false));
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
          return data.entries
            .filter((e) => e && typeof e.url === "string" && isSafeUrl(e.url))
            .map((e) => ({
              url: e.url,
              title: typeof e.title === "string" && e.title ? e.title : e.url,
              savedAt: typeof e.savedAt === "string" ? e.savedAt : data.createdAt || null,
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
      }))
      .filter((e) => isSafeUrl(e.url))
      .map((e) => ({ ...e, title: e.title || e.url }));
  }

  // Saves through the downloads API and resolves once the file is fully written.
  // Rejects if the user cancels the Save As dialog or the download fails.
  async function downloadHtml(html, filename, saveAs) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const id = await browser.downloads.download({
        url,
        filename,
        saveAs,
        conflictAction: "uniquify",
      });
      await waitForDownload(id);
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
    groupEntries,
    renderDocument,
    extractEntries,
    downloadHtml,
    timestamp,
  };
})();
