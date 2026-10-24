# Tab Sorter

A Firefox add-on that saves every tab in a window to a single HTML file, grouped
by domain, and then closes those tabs. A merge page combines several saved files
into one, so you can fold multiple windows together later.

## Features

- **Save & close**: one click in the toolbar popup saves the current window's
  tabs to `Downloads/tab-sorter/tabs-<date>_<time>.html` and closes them.
  - Tabs are grouped by domain (`www.` is ignored). Subdomains of the same
    site sit next to each other (`docs.google.com` beside `mail.google.com`).
  - Duplicate URLs are saved once. Reader-view tabs are saved as the original
    page. Blank tabs (new tab, `about:blank`) are closed but not saved.
  - If the file can't be written, or you cancel the Save As dialog, no tabs
    are closed.
- **Saved page**: a standalone HTML file with a filter box and collapsible
  domain sections. It works offline and needs nothing installed to open it.
- **Merge**: "Merge saved files…" in the popup opens a page where you pick or
  drop several saved files. Their links are combined by domain, duplicates are
  removed, and a new `tabs-merged-<date>_<time>.html` is saved. The originals
  are not changed. Other HTML files with links, such as a Firefox bookmarks
  export, can be merged in as well.

### Options (in the popup)

| Option | Default | Effect |
| --- | --- | --- |
| Leave pinned tabs open | on | Pinned tabs are neither saved nor closed. |
| Keep the window open | on | If every tab in the window would close, a new tab is opened first so the window (or Firefox itself, if it's your only window) stays open. |
| Ask where to save each file | off | Shows a Save As dialog instead of saving to `Downloads/tab-sorter/`. |

## Installing

### Quick test (until Firefox restarts)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `extension/manifest.json`.

### Permanent install

Release Firefox only installs signed add-ons. Signing is free and you can keep
the add-on private:

1. Zip the **contents** of the `extension/` folder (so `manifest.json` is at
   the zip's root), or run `npx web-ext build --source-dir extension`.
2. At <https://addons.mozilla.org/developers/addon/submit/distribution>, pick
   **On your own** (unlisted) and upload the zip.
3. Download the signed `.xpi` you get back and drag it into Firefox.

The add-on ID in `manifest.json` (`tab-sorter@miatoromatic`) must be unique on
addons.mozilla.org. Change it if the upload says it's taken.

On Firefox Developer Edition, Nightly or ESR you can skip signing instead: set
`xpinstall.signatures.required` to `false` in `about:config`, then install the
unsigned zip from `about:addons` → gear menu → **Install Add-on From File…**

## Files

| File | Purpose |
| --- | --- |
| `extension/manifest.json` | Add-on manifest (permissions: `tabs`, `downloads`, `storage`) |
| `extension/background.js` | Saves the window and closes the tabs |
| `extension/lib.js` | Grouping, HTML rendering and reading saved files, shared with the merge page |
| `extension/options.js` | Option defaults and loading |
| `extension/popup.html`, `popup.js` | Toolbar popup |
| `extension/merge.html`, `merge.js` | Merge page |

Each saved file also embeds its links as JSON in a
`<script type="application/json" id="tab-sorter-data">` block. The merge page
reads that data rather than scraping the visible links.
