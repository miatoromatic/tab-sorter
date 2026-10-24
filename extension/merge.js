"use strict";

const loaded = []; // { name, entries }

const drop = document.getElementById("drop");
const picker = document.getElementById("picker");
const statusText = document.getElementById("status");
const mergeButton = document.getElementById("merge");

function showStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.className = isError ? "error" : "muted";
}

function allEntries() {
  return loaded.flatMap((file) => file.entries);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function render() {
  document.getElementById("loaded").hidden = loaded.length === 0;

  const fileList = document.getElementById("files");
  fileList.replaceChildren(
    ...loaded.map((file, index) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = file.name;
      const count = document.createElement("span");
      count.className = file.entries.length ? "muted" : "error";
      count.textContent = file.entries.length ? plural(file.entries.length, "link") : "no links found";
      const remove = document.createElement("button");
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        loaded.splice(index, 1);
        render();
      });
      item.append(name, count, remove);
      return item;
    }),
  );

  const entries = allEntries();
  const groups = TabSorter.groupEntries(entries);
  const unique = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const duplicates = entries.length - unique;
  document.getElementById("summary").textContent =
    `${plural(unique, "link")} across ${plural(groups.length, "domain")}` +
    (duplicates ? ` (${plural(duplicates, "duplicate")} removed)` : "");

  document.getElementById("domains").replaceChildren(
    ...groups.map((group) => {
      const item = document.createElement("li");
      item.textContent = `${group.name} · ${group.entries.length}`;
      return item;
    }),
  );

  mergeButton.disabled = unique === 0;
}

async function addFiles(fileList) {
  // Copy first: the FileList is live and empties when the picker is reset.
  for (const file of [...fileList]) {
    try {
      loaded.push({ name: file.name, entries: TabSorter.extractEntries(await file.text()) });
    } catch (error) {
      showStatus(`Couldn't read ${file.name}: ${error.message}`, true);
    }
  }
  render();
}

picker.addEventListener("change", () => {
  addFiles(picker.files);
  picker.value = "";
});

drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("over");
  addFiles(event.dataTransfer.files);
});

document.getElementById("clear").addEventListener("click", () => {
  loaded.length = 0;
  showStatus("");
  render();
});

mergeButton.addEventListener("click", async () => {
  mergeButton.disabled = true;
  showStatus("Saving…");
  try {
    const options = await loadOptions();
    const stamp = TabSorter.timestamp();
    const html = await TabSorter.renderDocument(allEntries(), {
      title: `Tabs merged ${stamp}`,
      mergedFrom: loaded.length,
    });
    await TabSorter.downloadHtml(html, `tab-sorter/tabs-merged-${stamp}.html`, { saveAs: options.saveAs });
    showStatus("Merged file saved. You can delete the originals if you no longer need them.");
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    mergeButton.disabled = false;
  }
});
