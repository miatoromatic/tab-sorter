"use strict";

// The work happens here rather than in the popup: the popup closes as soon as
// the Save As dialog takes focus or the window goes away.
browser.runtime.onMessage.addListener((message, sender) => {
  if (!message) return undefined;
  const fail = (error) => ({ ok: false, error: error.message });
  if (message.type === "save-window") {
    return saveWindow(message.windowId).catch(fail);
  }
  // From saved-file.js, on behalf of an edited saved page.
  if (message.type === "overwrite-saved-file" && sender.tab && typeof message.html === "string") {
    return overwriteSavedFile(message.html, sender.url).catch(fail);
  }
  return undefined;
});

async function saveWindow(windowId) {
  const options = await loadOptions();
  const tabs = await browser.tabs.query({ windowId });
  const targets = tabs.filter((tab) => !(options.skipPinned && tab.pinned));
  if (!targets.length) return { ok: false, error: "There are no tabs to save." };

  const savedAt = new Date().toISOString();
  const icons = options.saveIcons ? await TabSorter.collectIcons(targets) : new Map();
  const entries = targets.map((tab) => TabSorter.entryFromTab(tab, savedAt, icons)).filter(Boolean);
  if (!entries.length) {
    return { ok: false, error: "Only blank or internal pages are open, so nothing was saved." };
  }

  const stamp = TabSorter.timestamp(new Date(savedAt));
  const html = await TabSorter.renderDocument(entries, { title: `Tabs saved ${stamp}`, createdAt: savedAt });
  // Throws if the user cancels the Save As dialog, so no tab is closed unsaved.
  await TabSorter.downloadHtml(html, `tab-sorter/tabs-${stamp}.html`, { saveAs: options.saveAs });

  if (options.keepWindowOpen && targets.length === tabs.length) {
    await browser.tabs.create({ windowId, active: true });
  }
  await browser.tabs.remove(targets.map((tab) => tab.id));
  return { ok: true, saved: entries.length, closed: targets.length };
}

// Only files this add-on itself wrote into Downloads/tab-sorter/ can be
// overwritten, and only by the page that was loaded from that file.
async function overwriteSavedFile(html, pageUrl) {
  const path = decodeURIComponent(new URL(pageUrl).pathname);
  const filename = await TabSorter.savedFileFor(path);
  if (!filename) {
    return {
      ok: false,
      error: "This file wasn't saved by Tab Sorter into Downloads/tab-sorter (or it was moved), so it can't be updated in place.",
    };
  }
  const item = await TabSorter.downloadHtml(html, filename, { conflictAction: "overwrite" });
  if (TabSorter.normalizePath(item.filename) !== TabSorter.normalizePath(path)) {
    // The downloads folder changed since the file was saved.
    return { ok: false, wroteCopy: true, error: `Your downloads folder has changed, so the edit was saved as ${item.filename}.` };
  }
  return { ok: true };
}
