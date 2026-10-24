"use strict";

const saveButton = document.getElementById("save");
const countText = document.getElementById("count");
const statusText = document.getElementById("status");

let windowId;
let options;

async function updateCount() {
  const tabs = await browser.tabs.query({ windowId });
  const count = tabs.filter((tab) => !(options.skipPinned && tab.pinned)).length;
  countText.textContent = `${count} ${count === 1 ? "tab" : "tabs"} in this window will be saved and closed.`;
  saveButton.disabled = count === 0;
}

function showStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.className = isError ? "error" : "muted";
}

async function init() {
  windowId = (await browser.windows.getCurrent()).id;
  options = await loadOptions();

  for (const name of Object.keys(DEFAULT_OPTIONS)) {
    const checkbox = document.getElementById(name);
    checkbox.checked = options[name];
    checkbox.addEventListener("change", async () => {
      options[name] = checkbox.checked;
      await browser.storage.local.set({ [name]: checkbox.checked });
      updateCount();
    });
  }
  await updateCount();
}

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  showStatus("Saving…");
  // If a Save As dialog opens, this popup closes; the background keeps going.
  const result = await browser.runtime.sendMessage({ type: "save-window", windowId });
  if (result && result.ok) {
    window.close();
  } else {
    showStatus((result && result.error) || "Something went wrong.", true);
    updateCount();
  }
});

document.getElementById("merge").addEventListener("click", async () => {
  await browser.tabs.create({ url: browser.runtime.getURL("merge.html") });
  window.close();
});

init().catch((error) => showStatus(error.message, true));
