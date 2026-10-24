"use strict";

// Settings shared by the popup, the background script and the merge page.
const DEFAULT_OPTIONS = {
  skipPinned: true, // leave pinned tabs open and out of the file
  keepWindowOpen: true, // open a blank tab so the window survives closing every tab
  saveAs: false, // ask where to save instead of using Downloads/tab-sorter/
};

function loadOptions() {
  return browser.storage.local.get(DEFAULT_OPTIONS);
}
