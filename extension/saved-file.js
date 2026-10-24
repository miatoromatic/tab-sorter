"use strict";

// Content script for local files. On a page saved by Tab Sorter it relays the
// page's "Save changes" request to the background script, which can overwrite
// the file; web pages themselves have no way to write to disk.
if (document.getElementById("tab-sorter-data")) {
  document.documentElement.dataset.tabSorterAddon = "1";

  window.addEventListener("message", async (event) => {
    const message = event.data;
    if (event.source !== window || !message || message.type !== "tab-sorter:save") return;
    if (typeof message.html !== "string") return;
    let result;
    try {
      result = await browser.runtime.sendMessage({ type: "overwrite-saved-file", html: message.html });
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    window.postMessage({ ...result, type: "tab-sorter:saved", id: message.id }, "*");
  });
}
