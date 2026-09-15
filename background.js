const STORAGE_KEY = "seoCollectorItems";

/**
 * Create the context menu items when the extension is installed.
 */
chrome.runtime.onInstalled.addListener(() => {
    createContextMenus();
});

/**
 * Also recreate menus when the service worker starts.
 */
chrome.runtime.onStartup.addListener(() => {
    createContextMenus();
});

function createContextMenus() {
    chrome.contextMenus.removeAll(() => {

        // Add link directly from the context menu
        chrome.contextMenus.create({
            id: "addLink",
            title: "🔗 Add to SEO Collector",
            contexts: ["link"]
        });

        // Add selected text directly from the context menu
        chrome.contextMenus.create({
            id: "addText",
            title: "📝 Add Text to SEO Collector",
            contexts: ["selection"]
        });

        // Add the current page directly from the context menu
        chrome.contextMenus.create({
            id: "addPage",
            title: "🌐 Add Page to SEO Collector",
            contexts: ["page"]
        });
    });
}

/**
 * Handle right-click menu actions.
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {

    let value = "";
    let type = "text";

    // User right-clicked a link
    if (info.menuItemId === "addLink") {
        value = info.linkUrl || "";
        type = "url";
    }

    // User selected text
    else if (info.menuItemId === "addText") {
        value = info.selectionText || "";
        type = isUrl(value) ? "url" : "text";
    }

    // User right-clicked on page itself
    else if (info.menuItemId === "addPage") {
        value = tab?.url || "";
        type = "url";
    }

    if (!value.trim()) {
        return;
    }

    await addItem(value.trim(), type);
});

/**
 * Add an item to Chrome storage.
 */
async function addItem(value, type) {

    const result = await chrome.storage.local.get(STORAGE_KEY);

    const items = result[STORAGE_KEY] || [];

    // Check duplicates
    const duplicate = items.some(
        item => item.value.toLowerCase() === value.toLowerCase()
    );

    if (duplicate) {
        return;
    }

    const newItem = {
        id: crypto.randomUUID(),
        value: value,
        type: type,
        createdAt: Date.now()
    };

    items.push(newItem);

    await chrome.storage.local.set({
        [STORAGE_KEY]: items
    });

    await updateBadge(items.length);
}

/**
 * Show the current collection size on the extension icon.
 */
async function updateBadge(count) {
    await chrome.action.setBadgeText({
        text: count > 0 ? String(count) : ""
    });

    await chrome.action.setBadgeBackgroundColor({
        color: "#111827"
    });
}

/**
 * Determine whether a string is a URL.
 */
function isUrl(value) {

    try {
        const url = new URL(value);

        return (
            url.protocol === "http:" ||
            url.protocol === "https:"
        );

    } catch {
        return false;
    }
}

chrome.storage.local.get(STORAGE_KEY, result => {
    const items = result[STORAGE_KEY] || [];

    updateBadge(items.length);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
        return;
    }

    const items = changes[STORAGE_KEY].newValue || [];

    updateBadge(items.length);
});
