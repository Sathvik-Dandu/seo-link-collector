const STORAGE_KEY = "seoCollectorItems";
const SHUFFLE_STATE_KEY = "seoCollectorShuffleState";
const UNDO_KEY = "seoCollectorClearUndo";
const UNDO_TTL_MS = 120_000;
const UNDO_ALARM = "seoCollectorClearUndoExpiry";
let addQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === "install" || details.reason === "update") {
        createContextMenus();
    }
});

function createContextMenus() {
    chrome.contextMenus.removeAll(() => {
        const removeError = chrome.runtime.lastError;
        if (removeError) {
            console.error("Unable to reset SEO Collector context menus:", removeError.message);
            return;
        }

        [
            { id: "addLink", title: "🔗 Add to SEO Collector", contexts: ["link"] },
            { id: "addText", title: "📝 Add Text to SEO Collector", contexts: ["selection"] },
            { id: "addPage", title: "🌐 Add Page to SEO Collector", contexts: ["page"] }
        ].forEach(menu => {
            chrome.contextMenus.create(menu, () => {
                const createError = chrome.runtime.lastError;
                if (createError) console.error(`Unable to create context menu ${menu.id}:`, createError.message);
            });
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

/* =========================================
   KEYBOARD SHORTCUTS
========================================= */
chrome.commands.onCommand.addListener(async command => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const url = tab?.url || "";

        if (!isCollectableUrl(url)) return;

        if (command === "add-current-url") {
            await addItem(url, "url");
            return;
        }

        if (command === "copy-current-url") {
            await chrome.scripting.executeScript({
                target: {
                    tabId: tab.id
                },
                args: [url],
                func: async currentUrl => {
                    await navigator.clipboard.writeText(currentUrl);
                }
            });
        }
    } catch (error) {
        console.error("Unable to handle SEO Collector keyboard command:", error);
    }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !String(message.type || "").startsWith("seoCollector:")) return false;

    runCollectionMutation(async () => {
        if (message.type === "seoCollector:bulkAdd") return addBulkItems(message.urls);
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const items = normalizeStoredItems(result[STORAGE_KEY]);

        if (message.type === "seoCollector:delete") {
            const next = items.filter(item => item.id !== message.id);
            await chrome.storage.local.set({ [STORAGE_KEY]: next });
            return { items: next };
        }
        if (message.type === "seoCollector:removeCopied") {
            const ids = new Set(Array.isArray(message.ids) ? message.ids : []);
            const next = items.filter(item => !ids.has(item.id));
            await chrome.storage.local.set({ [STORAGE_KEY]: next });
            return { items: next };
        }
        if (message.type === "seoCollector:clear") {
            const ids = new Set(Array.isArray(message.ids) ? message.ids : items.map(item => item.id));
            const cleared = items.filter(item => ids.has(item.id));
            if (!cleared.length) return { items, cleared: [] };
            const next = items.filter(item => !ids.has(item.id));
            const undo = {
                token: crypto.randomUUID(),
                expiresAt: Date.now() + UNDO_TTL_MS,
                message: message.undoMessage === "Links copied and cleared" ? "Links copied and cleared" : "All links cleared",
                items: cleared
            };
            await chrome.storage.local.set({ [STORAGE_KEY]: next, [UNDO_KEY]: undo });
            await scheduleUndoExpiry(undo.expiresAt);
            return { items: next, cleared, undoToken: undo.token, undoExpiresAt: undo.expiresAt };
        }
        if (message.type === "seoCollector:undoClear") {
            const stored = await chrome.storage.local.get(UNDO_KEY);
            const undo = stored[UNDO_KEY];
            if (!undo || undo.token !== message.token || undo.expiresAt <= Date.now() || !Array.isArray(undo.items)) {
                if (undo?.token === message.token) {
                    await chrome.storage.local.remove(UNDO_KEY);
                    await clearUndoExpiry();
                }
                return { restored: false, items };
            }
            const currentResult = await chrome.storage.local.get(STORAGE_KEY);
            const current = normalizeStoredItems(currentResult[STORAGE_KEY]);
            const ids = new Set(current.map(item => item.id));
            const values = new Set(current.map(item => item.value.toLowerCase()));
            const restored = [];
            for (const item of undo.items) {
                const valueKey = item.value.toLowerCase();
                if (ids.has(item.id) || values.has(valueKey)) continue;
                restored.push(item);
                ids.add(item.id);
                values.add(valueKey);
            }
            // Restore the saved sequence first, then retain links added while it was cleared.
            const next = [...restored, ...current];
            await chrome.storage.local.set({ [STORAGE_KEY]: next });
            await chrome.storage.local.remove(UNDO_KEY);
            await clearUndoExpiry();
            return { restored: restored.length > 0, items: next };
        }
        if (message.type === "seoCollector:expireUndo") {
            const stored = await chrome.storage.local.get(UNDO_KEY);
            if (stored[UNDO_KEY]?.token === message.token && stored[UNDO_KEY].expiresAt <= Date.now()) {
                await chrome.storage.local.remove(UNDO_KEY);
                await clearUndoExpiry();
            }
            return { expired: true };
        }
        if (message.type === "seoCollector:shuffle") {
            const order = Array.isArray(message.ids) ? message.ids : [];
            const byId = new Map(items.map(item => [item.id, item]));
            const next = order.map(id => byId.get(id)).filter(Boolean);
            const included = new Set(next.map(item => item.id));
            next.push(...items.filter(item => !included.has(item.id)));
            const shuffleState = {
                lastOrderIds: next.map(item => item.id),
                lastMode: ["quick", "smart", "again"].includes(message.mode) ? message.mode : "quick",
                shuffledAt: Date.now()
            };
            await chrome.storage.local.set({
                [STORAGE_KEY]: next,
                [SHUFFLE_STATE_KEY]: shuffleState
            });
            return { items: next };
        }
        throw new Error("Unsupported collection operation");
    }).then(sendResponse, error => {
        console.error("Unable to update collected items:", error);
        sendResponse({ error: error.message || "Unable to update collection" });
    });
    return true;
});

// Remove expired temporary undo data when the worker starts. The popup also
// expires its visible Undo action; this check covers a popup closed meanwhile.
chrome.runtime.onStartup.addListener(async () => {
    const result = await chrome.storage.local.get(UNDO_KEY);
    const undo = result[UNDO_KEY];
    if (!undo) return;
    if (!Number.isFinite(undo.expiresAt) || undo.expiresAt <= Date.now()) {
        await chrome.storage.local.remove(UNDO_KEY);
        await clearUndoExpiry();
    } else {
        await scheduleUndoExpiry(undo.expiresAt);
    }
});

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== UNDO_ALARM) return;
    runCollectionMutation(async () => {
        const result = await chrome.storage.local.get(UNDO_KEY);
        if (result[UNDO_KEY]?.expiresAt <= Date.now()) await chrome.storage.local.remove(UNDO_KEY);
    }).catch(error => console.error("Unable to expire cleared-link backup:", error));
});

/**
 * Add an item to Chrome storage.
 */
async function addItem(value, type) {
    return runCollectionMutation(async () => {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const items = normalizeStoredItems(result[STORAGE_KEY]);
        if (items.some(item => item.value.toLowerCase() === value.toLowerCase())) return;

        items.push({ id: crypto.randomUUID(), value, type, createdAt: Date.now() });
        await chrome.storage.local.set({ [STORAGE_KEY]: items });
        return { items };
    });
}

function runCollectionMutation(mutation) {
    const operation = addQueue.then(mutation);
    addQueue = operation.catch(error => console.error("Collection update failed:", error));
    return operation;
}

async function scheduleUndoExpiry(expiresAt) {
    try {
        await chrome.alarms.create(UNDO_ALARM, { when: expiresAt });
    } catch (error) {
        console.error("Unable to schedule undo-backup cleanup:", error);
    }
}

async function clearUndoExpiry() {
    try {
        await chrome.alarms.clear(UNDO_ALARM);
    } catch (error) {
        console.error("Unable to clear undo-backup alarm:", error);
    }
}

function normalizeStoredItems(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && typeof item.value === "string").map(item => ({
        ...item,
        id: typeof item.id === "string" && item.id ? item.id : `legacy-${crypto.randomUUID()}`
    }));
}

async function addBulkItems(values) {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const items = normalizeStoredItems(result[STORAGE_KEY]);
    const knownValues = new Set(items.map(item => item.value.toLowerCase()));
    let duplicates = 0;
    const addedItems = [];

    for (const rawValue of Array.isArray(values) ? values : []) {
        const value = typeof rawValue === "string" ? rawValue.trim() : "";
        if (!isCollectableUrl(value)) continue;
        const key = value.toLowerCase();
        if (knownValues.has(key)) {
            duplicates++;
            continue;
        }
        knownValues.add(key);
        const item = { id: crypto.randomUUID(), value, type: "url", createdAt: Date.now() };
        items.push(item);
        addedItems.push(item);
    }

    if (addedItems.length) await chrome.storage.local.set({ [STORAGE_KEY]: items });
    return { added: addedItems.length, duplicates, items };
}

/**
 * Show the current collection size on the extension icon.
 */
async function updateBadge(count) {
    await chrome.action.setBadgeText({
        text: count > 0 ? String(count) : ""
    });

    await chrome.action.setBadgeBackgroundColor({
        color: "#2458A6"
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

/**
 * Determine whether a page URL can be collected.
 */
function isCollectableUrl(value) {
    return isUrl(value);
}

chrome.storage.local.get(STORAGE_KEY, result => {
    const items = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];

    updateBadge(items.length);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
        return;
    }

    const items = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue : [];

    updateBadge(items.length);
});
