"use strict";

// The work happens here rather than in the popup: the popup closes as soon as
// the Save As dialog takes focus or the window goes away.
browser.runtime.onMessage.addListener((message) => {
  if (message && message.type === "save-window") {
    return saveWindow(message.windowId).catch((error) => ({ ok: false, error: error.message }));
  }
  return undefined;
});

async function saveWindow(windowId) {
  const options = await loadOptions();
  const tabs = await browser.tabs.query({ windowId });
  const targets = tabs.filter((tab) => !(options.skipPinned && tab.pinned));
  if (!targets.length) return { ok: false, error: "There are no tabs to save." };

  const savedAt = new Date().toISOString();
  const entries = targets.map((tab) => TabSorter.entryFromTab(tab, savedAt)).filter(Boolean);
  if (!entries.length) {
    return { ok: false, error: "Only blank or internal pages are open, so nothing was saved." };
  }

  const stamp = TabSorter.timestamp(new Date(savedAt));
  const html = TabSorter.renderDocument(entries, { title: `Tabs saved ${stamp}`, createdAt: savedAt });
  // Throws if the user cancels the Save As dialog, so no tab is closed unsaved.
  await TabSorter.downloadHtml(html, `tab-sorter/tabs-${stamp}.html`, options.saveAs);

  if (options.keepWindowOpen && targets.length === tabs.length) {
    await browser.tabs.create({ windowId, active: true });
  }
  await browser.tabs.remove(targets.map((tab) => tab.id));
  return { ok: true, saved: entries.length, closed: targets.length };
}
