# SEO Link Collector

A Chrome extension for collecting SEO submission URLs and text using the browser's right-click menu.

## Features

- Add links from right-click menu
- Add selected text
- Add current page URL
- Persistent Chrome storage
- Duplicate prevention
- Delete individual items
- Copy all items
- Copy an individual item or a selected group
- Shuffle the saved order before copying
- Quick Shuffle, Smart Shuffle, and Shuffle Again modes
- Two-minute Undo with a live countdown after clearing
- Optionally insert a blank Google Sheets row after a chosen number of items
- Copy and clear the collection after a successful clipboard write
- Google Sheets compatible
- No backend
- No login
- No external API

## Installation

1. Open Chrome.
2. Go to chrome://extensions/
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the SEO-Link-Collector folder.
6. Pin the extension if desired.

## Usage

Right-click a submitted link.

Choose:

SEO Link Collector
    -> Add Link to Collector

The link is saved automatically.

Open the extension popup to see all collected items.

Click Copy All.

Open Google Sheets.

Select the first cell.

Press Ctrl + V.

Each collected item will appear on a separate row.

Use the checkboxes to select items and **Copy Selected** to copy only those rows. **Randomize** shuffles the saved collection order. The blank-row option is off by default; enable it and choose a positive interval to add an empty spreadsheet row between groups. **Copy & Clear** removes copied entries only after the clipboard write succeeds.

Each item also has its own copy and delete controls. Selection is temporary and lasts only while the popup is open. The blank-row preference and collection order are saved locally.

Choose **Quick Shuffle** for one Fisher–Yates pass. **Smart Shuffle** compares a bounded set of candidate orders and favors fewer adjacent links with similar hosts or URL paths; it reduces visible grouping, but does not increase statistical randomness. **Shuffle Again** generates a fresh order and avoids the last saved order when another order is available. Each shuffle preserves the original item records and their selected state.

After **Clear All** or **Copy & Clear**, use **Undo** within two minutes to restore the removed links. The countdown resumes at its stored remaining time if the popup is reopened. A later clear replaces the earlier undo backup.

Click **Bulk Add** above the collection to paste links from text or spreadsheet cells. HTTP and HTTPS URLs are extracted in their original order; existing and repeated URLs are skipped.

## Storage

The extension uses:

chrome.storage.local

No data is sent to an external server.
