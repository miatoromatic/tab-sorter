"use strict";

// Runs inside each saved HTML file: filtering, removing links, and saving the
// edited file. Removed links are only hidden until "Save changes" so they can
// be undone.
(() => {
  const data = JSON.parse(document.getElementById("tab-sorter-data").textContent);
  const groups = [...document.querySelectorAll(".group")];
  const filter = document.getElementById("filter");
  const notice = document.getElementById("notice");
  const saveBar = document.getElementById("savebar");
  const saveButton = document.getElementById("save");
  const undoStack = []; // one array of <li> elements per click

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const liveItems = (root) => [...root.querySelectorAll("li:not(.removed)")];
  const unsavedCount = () => undoStack.reduce((sum, items) => sum + items.length, 0);

  function showNotice(text) {
    notice.textContent = text;
    notice.hidden = !text;
  }

  function applyFilter() {
    const query = filter.value.trim().toLowerCase();
    for (const group of groups) {
      const domainHit = group.dataset.domain.includes(query);
      let visible = 0;
      for (const item of liveItems(group)) {
        const hit = !query || domainHit || item.textContent.toLowerCase().includes(query);
        item.hidden = !hit;
        if (hit) visible++;
      }
      group.hidden = visible === 0;
      if (query && visible) group.open = true;
    }
  }

  function refresh() {
    for (const group of groups) {
      const count = liveItems(group).length;
      group.querySelector(".count").textContent = count;
      group.classList.toggle("removed", count === 0);
    }
    const tabs = liveItems(document).length;
    const domains = groups.filter((group) => !group.classList.contains("removed")).length;
    document.getElementById("stat-tabs").textContent = plural(tabs, "tab");
    document.getElementById("stat-domains").textContent = plural(domains, "domain");

    const unsaved = unsavedCount();
    saveBar.hidden = unsaved === 0;
    document.getElementById("savebar-text").textContent = `${plural(unsaved, "link")} removed`;
    applyFilter();
  }

  function remove(items) {
    if (!items.length) return;
    items.forEach((item) => item.classList.add("removed"));
    undoStack.push(items);
    showNotice("");
    refresh();
  }

  function undo() {
    const items = undoStack.pop();
    if (!items) return;
    items.forEach((item) => item.classList.remove("removed"));
    refresh();
  }

  // The page as it should be written to disk: removed links dropped, filter
  // state cleared, and the embedded data rewritten to match.
  function buildHtml() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("li.removed, .group.removed").forEach((el) => el.remove());
    clone.querySelectorAll(".group, li").forEach((el) => el.removeAttribute("hidden"));
    clone.querySelectorAll(".group").forEach((el) => el.setAttribute("open", ""));
    clone.querySelector("#savebar").setAttribute("hidden", "");
    clone.querySelector("#notice").setAttribute("hidden", "");
    clone.removeAttribute("data-tab-sorter-addon");

    const entries = [];
    clone.querySelectorAll(".group li").forEach((item, index) => {
      entries.push(data.entries[Number(item.dataset.index)]);
      item.dataset.index = index;
    });
    const json = JSON.stringify({ ...data, entries }).replace(/</g, "\\u003c");
    clone.querySelector("#tab-sorter-data").textContent = json;
    return `<!doctype html>\n${clone.outerHTML}\n`;
  }

  // Asks the add-on (through its content script) to overwrite this file.
  function saveWithAddon(html) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => finish({ ok: false, error: "The add-on didn't respond." }), 15000);
      function finish(result) {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(result);
      }
      function onMessage(event) {
        if (event.data && event.data.type === "tab-sorter:saved" && event.data.id === id) {
          finish(event.data);
        }
      }
      window.addEventListener("message", onMessage);
      window.postMessage({ type: "tab-sorter:save", id, html }, "*");
    });
  }

  function downloadCopy(html) {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = decodeURIComponent(location.pathname.split("/").pop() || "tabs.html");
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function save() {
    const html = buildHtml();
    saveButton.disabled = true;
    try {
      const addonPresent = document.documentElement.dataset.tabSorterAddon === "1";
      const result = addonPresent
        ? await saveWithAddon(html)
        : { ok: false, error: "The Tab Sorter add-on isn't loaded, so this file can't be updated in place." };
      if (result.ok) {
        undoStack.length = 0;
        location.reload();
        return;
      }
      if (!result.wroteCopy) downloadCopy(html);
      showNotice(
        `${result.error} An edited copy was saved to your downloads instead; ` +
          "you can delete this file once you've checked it.",
      );
      undoStack.length = 0;
      refresh();
    } finally {
      saveButton.disabled = false;
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button.delete");
    if (!button) return;
    event.preventDefault(); // stops the group's <summary> from toggling
    const item = button.closest("li");
    remove(item ? [item] : liveItems(button.closest(".group")));
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "z" && event.target !== filter) {
      event.preventDefault();
      undo();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (unsavedCount()) event.preventDefault();
  });

  filter.addEventListener("input", applyFilter);
  document.getElementById("expand").onclick = () => groups.forEach((g) => (g.open = true));
  document.getElementById("collapse").onclick = () => groups.forEach((g) => (g.open = false));
  document.getElementById("undo").onclick = undo;
  saveButton.onclick = save;
})();
