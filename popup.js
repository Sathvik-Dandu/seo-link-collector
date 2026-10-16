const STORAGE_KEY = "seoCollectorItems";
const SETTINGS_KEY = "seoCollectorSettings";
const UNDO_KEY = "seoCollectorClearUndo";
const DEFAULT_SETTINGS = { blankRowsEnabled: false, blankRowInterval: 10 };
const itemCount = document.getElementById("itemCount");
const itemStatus = document.getElementById("itemStatus");
const itemsList = document.getElementById("itemsList");
const emptyState = document.getElementById("emptyState");
const copyAllBtn = document.getElementById("copyAllBtn");
const copyClearBtn = document.getElementById("copyClearBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const randomizeBtn = document.getElementById("randomizeBtn");
const copySelectedBtn = document.getElementById("copySelectedBtn");
const selectAllBtn = document.getElementById("selectAllBtn");
const deselectAllBtn = document.getElementById("deselectAllBtn");
const selectedCount = document.getElementById("selectedCount");
const blankRowsEnabled = document.getElementById("blankRowsEnabled");
const blankRowInterval = document.getElementById("blankRowInterval");
const intervalError = document.getElementById("intervalError");
const toast = document.getElementById("toast");
const bulkToggleBtn = document.getElementById("bulkToggleBtn");
const bulkPanel = document.getElementById("bulkPanel");
const bulkInput = document.getElementById("bulkInput");
const bulkCancelBtn = document.getElementById("bulkCancelBtn");
const bulkSubmitBtn = document.getElementById("bulkSubmitBtn");

let items = [];
let settings = { ...DEFAULT_SETTINGS };
let selectedIds = new Set();
let toastTimer;
let undoExpiryTimer;
let undoToken;

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
    try {
        const result = await chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY, UNDO_KEY]);
        const undo = result[UNDO_KEY];
        if (undo && (!Number.isFinite(undo.expiresAt) || undo.expiresAt <= Date.now() || !Array.isArray(undo.items))) {
            await chrome.storage.local.remove(UNDO_KEY);
            try {
                await chrome.alarms.clear("seoCollectorClearUndoExpiry");
            } catch (error) {
                console.error("Unable to clear expired undo alarm:", error);
            }
        } else if (undo) {
            undoToken = undo.token;
        }
        items = normalizeItems(result[STORAGE_KEY]);
        settings = normalizeSettings(result[SETTINGS_KEY]);
        blankRowsEnabled.checked = settings.blankRowsEnabled;
        blankRowInterval.value = settings.blankRowInterval;
        blankRowInterval.disabled = !settings.blankRowsEnabled;
        if (items.some((item, index) => item.id !== result[STORAGE_KEY]?.[index]?.id)) {
            await saveItems(items);
        }
        render();
        if (undoToken) showUndoToast(undo.message || "All links cleared", undo.expiresAt);
    } catch (error) {
        console.error("Unable to load collector data:", error);
        showToast("Unable to load saved items");
    }
}

function normalizeItems(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && typeof item.value === "string").map(item => ({
        ...item,
        id: typeof item.id === "string" && item.id ? item.id : `legacy-${crypto.randomUUID()}`,
        type: item.type === "url" ? "url" : "text"
    }));
}

function normalizeSettings(value) {
    const interval = Number(value?.blankRowInterval);
    return {
        blankRowsEnabled: value?.blankRowsEnabled === true,
        blankRowInterval: Number.isInteger(interval) && interval > 0 ? interval : DEFAULT_SETTINGS.blankRowInterval
    };
}

function render() {
    const ids = new Set(items.map(item => item.id));
    selectedIds = new Set([...selectedIds].filter(id => ids.has(id)));
    itemsList.replaceChildren();
    itemCount.textContent = String(items.length);
    emptyState.hidden = items.length > 0;
    itemsList.hidden = items.length === 0;
    itemStatus.textContent = items.length ? `${items.length} ${items.length === 1 ? "item" : "items"} saved` : "No items yet";
    copyAllBtn.disabled = items.length === 0;
    copyClearBtn.disabled = items.length === 0;
    clearAllBtn.disabled = items.length === 0;
    randomizeBtn.disabled = items.length < 2;
    selectedCount.textContent = `${selectedIds.size} selected`;
    copySelectedBtn.disabled = selectedIds.size === 0;
    selectAllBtn.disabled = items.length === 0 || selectedIds.size === items.length;
    deselectAllBtn.disabled = selectedIds.size === 0;

    items.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = `item${selectedIds.has(item.id) ? " selected" : ""}`;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "item-check";
        checkbox.checked = selectedIds.has(item.id);
        checkbox.setAttribute("aria-label", `Select item ${index + 1}`);
        checkbox.addEventListener("change", () => {
            checkbox.checked ? selectedIds.add(item.id) : selectedIds.delete(item.id);
            render();
        });
        const number = document.createElement("span");
        number.className = "item-number";
        number.textContent = String(index + 1);
        const content = document.createElement("div");
        content.className = "item-content";
        const value = document.createElement("div");
        value.className = "item-value";
        value.textContent = item.value;
        value.title = item.value;
        const label = document.createElement("div");
        label.className = "item-type-label";
        label.textContent = item.type === "url" ? "URL" : "TEXT";
        content.append(value, label);
        const copyButton = makeIconButton("copy-item", "Copy item", '<rect x="7" y="7" width="10" height="11" rx="2"/><path d="M13 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"/>');
        copyButton.addEventListener("click", async event => {
            event.stopPropagation();
            if (await writeClipboard([item], false)) showToast("Copied");
        });
        const deleteButton = makeIconButton("delete-item", "Delete item", '<path d="M4 5h12M8 5V3h4v2m3 0-.7 11H5.7L5 5m3 3v5m4-5v5"/>');
        deleteButton.addEventListener("click", async event => {
            event.stopPropagation();
            await deleteItem(item.id);
        });
        row.append(checkbox, number, content, copyButton, deleteButton);
        itemsList.appendChild(row);
    });
}

function makeIconButton(className, label, icon) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `icon-button ${className}`;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${icon}</svg>`;
    return button;
}

async function getItems() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeItems(result[STORAGE_KEY]);
}

async function saveItems(nextItems) {
    items = nextItems;
    await chrome.storage.local.set({ [STORAGE_KEY]: nextItems });
    render();
}

function requestCollectionMutation(type, payload = {}) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: `seoCollector:${type}`, ...payload }, response => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) return reject(new Error(runtimeError.message));
            if (!response || response.error) return reject(new Error(response?.error || "No response from collector"));
            resolve(response);
        });
    });
}

async function deleteItem(id) {
    try {
        const response = await requestCollectionMutation("delete", { id });
        items = response.items;
        selectedIds.delete(id);
        render();
        showToast("Item deleted");
    } catch (error) {
        console.error("Delete error:", error);
        showToast("Unable to delete item");
    }
}

async function writeClipboard(sourceItems, formatted = true) {
    if (!sourceItems.length) return false;
    if (formatted && blankRowsEnabled.checked && !validateInterval()) {
        showToast("Enter a valid blank-row interval");
        blankRowInterval.focus();
        return false;
    }
    const values = sourceItems.map(item => item.value);
    const interval = Number(blankRowInterval.value);
    const useBlankRows = formatted && blankRowsEnabled.checked && Number.isInteger(interval) && interval > 0;
    const plainText = formatRows(values, useBlankRows ? interval : 0);
    const htmlContent = sourceItems.map((item, index) => {
        const row = `<div>${item.type === "url" ? `<a href="${escapeAttribute(item.value)}">${escapeHtml(item.value)}</a>` : escapeHtml(item.value)}</div>`;
        return useBlankRows && (index + 1) % interval === 0 && index < sourceItems.length - 1 ? `${row}<div><br></div>` : row;
    }).join("");
    try {
        if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
            await navigator.clipboard.write([new ClipboardItem({
                "text/plain": new Blob([plainText], { type: "text/plain" }),
                "text/html": new Blob([htmlContent], { type: "text/html" })
            })]);
        } else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(plainText);
        } else {
            throw new Error("Clipboard API is unavailable");
        }
        return true;
    } catch (error) {
        try {
            if (!navigator.clipboard?.writeText) throw error;
            await navigator.clipboard.writeText(plainText);
            return true;
        } catch (fallbackError) {
            console.error("Clipboard error:", fallbackError);
            showToast("Unable to copy items");
            return false;
        }
    }
}

function formatRows(values, interval) {
    const rows = [];
    values.forEach((value, index) => {
        rows.push(value);
        if (interval && (index + 1) % interval === 0 && index < values.length - 1) rows.push("");
    });
    return rows.join("\n");
}

copyAllBtn.addEventListener("click", async () => {
    const current = await getItems();
    if (await writeClipboard(current)) showToast(`${current.length} ${current.length === 1 ? "item" : "items"} copied`);
});

copySelectedBtn.addEventListener("click", async () => {
    const current = await getItems();
    const chosen = current.filter(item => selectedIds.has(item.id));
    if (await writeClipboard(chosen)) showToast(`${chosen.length} selected ${chosen.length === 1 ? "item" : "items"} copied`);
});

copyClearBtn.addEventListener("click", async () => {
    const snapshot = await getItems();
    if (!(await writeClipboard(snapshot))) return;
    let undoExpiresAt;
    try {
        const response = await requestCollectionMutation("clear", {
            ids: snapshot.map(item => item.id),
            undoMessage: "Links copied and cleared"
        });
        items = response.items;
        if (!response.cleared?.length) return;
        undoToken = response.undoToken;
        undoExpiresAt = response.undoExpiresAt;
    } catch (error) {
        console.error("Copy & Clear storage error:", error);
        return;
    }
    selectedIds.clear();
    render();
    showUndoToast("Links copied and cleared", undoExpiresAt);
});

clearAllBtn.addEventListener("click", async () => {
    const current = await getItems();
    if (!current.length || !confirm(`Delete all ${current.length} collected items?`)) return;
    let undoExpiresAt;
    try {
        const response = await requestCollectionMutation("clear", {
            ids: current.map(item => item.id),
            undoMessage: "All links cleared"
        });
        items = response.items;
        if (!response.cleared?.length) return;
        undoToken = response.undoToken;
        undoExpiresAt = response.undoExpiresAt;
    } catch (error) {
        console.error("Clear error:", error);
        showToast("Unable to clear items");
        return;
    }
    selectedIds.clear();
    render();
    showUndoToast("All links cleared", undoExpiresAt);
});

randomizeBtn.addEventListener("click", async () => {
    const shuffled = await getItems();
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    try {
        await requestCollectionMutation("shuffle", { ids: shuffled.map(item => item.id) });
        showToast("Links randomized");
    } catch (error) {
        console.error("Randomize error:", error);
        showToast("Unable to randomize links");
    }
});

bulkToggleBtn.addEventListener("click", () => {
    bulkPanel.hidden = !bulkPanel.hidden;
    bulkToggleBtn.setAttribute("aria-expanded", String(!bulkPanel.hidden));
    bulkToggleBtn.textContent = bulkPanel.hidden ? "Bulk Add" : "Close Bulk Add";
    if (!bulkPanel.hidden) bulkInput.focus();
});

bulkCancelBtn.addEventListener("click", () => closeBulkPanel(true));

bulkPanel.addEventListener("submit", async event => {
    event.preventDefault();
    const parsed = extractBulkUrls(bulkInput.value);
    if (!parsed.urls.length) {
        showToast(parsed.invalid ? "No valid HTTP/HTTPS URLs found. Review the pasted text." : "No HTTP/HTTPS URLs found.");
        bulkInput.focus();
        return;
    }

    bulkSubmitBtn.disabled = true;
    try {
        const result = await requestCollectionMutation("bulkAdd", { urls: parsed.urls });
        items = result.items;
        render();
        const invalid = parsed.invalid;
        showToast(`Added ${result.added}. Skipped ${result.duplicates} duplicates and ${invalid} invalid.`);
        if (result.added > 0 || result.duplicates > 0) closeBulkPanel(true);
    } catch (error) {
        console.error("Bulk Add error:", error);
        showToast("Unable to add links. Your text is still here.");
    } finally {
        bulkSubmitBtn.disabled = false;
    }
});

function closeBulkPanel(clearInput) {
    bulkPanel.hidden = true;
    bulkToggleBtn.setAttribute("aria-expanded", "false");
    bulkToggleBtn.textContent = "Bulk Add";
    if (clearInput) bulkInput.value = "";
}

function extractBulkUrls(text) {
    const urls = [];
    let invalid = 0;
    const urlLike = /\b(?:https?|ftp):\/\/(?:(?!https?:\/\/)[^\s<>"']+)/gi;
    for (const match of text.matchAll(urlLike)) {
        const candidate = trimUrlPunctuation(match[0]);
        if (isHttpUrl(candidate)) urls.push(candidate);
        else invalid++;
    }
    // Bare www links look like URL entries but are not accepted without HTTP(S).
    for (const match of text.matchAll(/\bwww\.[^\s<>"']+/gi)) {
        const candidate = trimUrlPunctuation(match[0]);
        if (!isHttpUrl(candidate)) invalid++;
    }
    return { urls, invalid };
}

function trimUrlPunctuation(value) {
    let candidate = value.trim().replace(/[.,;:!?]+$/g, "");
    const pairs = [[")", "("], ["]", "["], ["}", "{"]];
    for (const [closing, opening] of pairs) {
        while (candidate.endsWith(closing) &&
            [...candidate].filter(char => char === closing).length > [...candidate].filter(char => char === opening).length) {
            candidate = candidate.slice(0, -1);
        }
    }
    return candidate;
}

function isHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
    } catch {
        return false;
    }
}

selectAllBtn.addEventListener("click", () => { selectedIds = new Set(items.map(item => item.id)); render(); });
deselectAllBtn.addEventListener("click", () => { selectedIds.clear(); render(); });

blankRowsEnabled.addEventListener("change", async () => {
    blankRowInterval.disabled = !blankRowsEnabled.checked;
    settings = { ...settings, blankRowsEnabled: blankRowsEnabled.checked };
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    validateInterval();
});

blankRowInterval.addEventListener("input", validateInterval);
blankRowInterval.addEventListener("change", async () => {
    if (!validateInterval()) return;
    settings = { ...settings, blankRowInterval: Number(blankRowInterval.value) };
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
});

function validateInterval() {
    const value = Number(blankRowInterval.value);
    const valid = Number.isInteger(value) && value > 0;
    intervalError.hidden = valid || !blankRowsEnabled.checked;
    blankRowInterval.setAttribute("aria-invalid", String(!valid && blankRowsEnabled.checked));
    return valid;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttribute(text) {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function showToast(message) {
    // Keep the two-minute undo action visible and actionable if another notice occurs.
    if (undoToken) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
}

function showUndoToast(message, expiresAt) {
    const remainingMs = Math.max(0, expiresAt - Date.now());
    if (!remainingMs) {
        undoToken = undefined;
        return;
    }
    toast.replaceChildren(document.createTextNode(`${message} `));
    const undoButton = document.createElement("button");
    undoButton.type = "button";
    undoButton.className = "toast-undo";
    undoButton.textContent = "Undo";
    undoButton.setAttribute("aria-label", "Undo clearing links");
    const token = undoToken;
    undoButton.addEventListener("click", async () => {
        if (!token || token !== undoToken) return;
        undoButton.disabled = true;
        try {
            const response = await requestCollectionMutation("undoClear", { token });
            undoToken = undefined;
            clearTimeout(undoExpiryTimer);
            items = response.items;
            render();
            toast.textContent = response.restored ? "Links restored" : "No links to restore";
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
        } catch (error) {
            console.error("Undo clear error:", error);
            undoToken = undefined;
            toast.textContent = "Unable to restore links";
            clearTimeout(undoExpiryTimer);
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
        }
    });
    toast.appendChild(undoButton);
    toast.classList.add("show");
    clearTimeout(toastTimer);
    clearTimeout(undoExpiryTimer);
    undoExpiryTimer = setTimeout(async () => {
        try {
            await requestCollectionMutation("expireUndo", { token });
        } catch (error) {
            console.error("Undo backup cleanup error:", error);
        }
        if (undoToken === token) {
            undoToken = undefined;
            if (toast.querySelector(".toast-undo")) toast.classList.remove("show");
        }
    }, remainingMs);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[STORAGE_KEY]) {
        items = normalizeItems(changes[STORAGE_KEY].newValue);
        render();
    }
    if (changes[SETTINGS_KEY]) {
        settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
        blankRowsEnabled.checked = settings.blankRowsEnabled;
        blankRowInterval.value = settings.blankRowInterval;
        blankRowInterval.disabled = !settings.blankRowsEnabled;
        validateInterval();
    }
});
