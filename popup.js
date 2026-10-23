const STORAGE_KEY = "seoCollectorItems";
const SETTINGS_KEY = "seoCollectorSettings";
const UNDO_KEY = "seoCollectorClearUndo";
const SHUFFLE_STATE_KEY = "seoCollectorShuffleState";
const UNDO_TTL_MS = 120_000;
const TWO_LEVEL_PUBLIC_SUFFIXES = new Set(["co.uk", "org.uk", "gov.uk", "ac.uk", "net.uk", "com.au", "net.au", "org.au", "co.jp", "co.in", "com.br"]);
const DEFAULT_SETTINGS = { blankRowsEnabled: false, blankRowInterval: 10 };
const itemCount = document.getElementById("itemCount");
const itemStatus = document.getElementById("itemStatus");
const itemsList = document.getElementById("itemsList");
const emptyState = document.getElementById("emptyState");
const copyAllBtn = document.getElementById("copyAllBtn");
const quickPasteBtn = document.getElementById("quickPasteBtn");
const copyClearBtn = document.getElementById("copyClearBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const randomizeBtn = document.getElementById("randomizeBtn");
const shuffleMode = document.getElementById("shuffleMode");
const copySelectedBtn = document.getElementById("copySelectedBtn");
const selectAllBtn = document.getElementById("selectAllBtn");
const deselectAllBtn = document.getElementById("deselectAllBtn");
const selectedCount = document.getElementById("selectedCount");
const blankRowsEnabled = document.getElementById("blankRowsEnabled");
const blankRowInterval = document.getElementById("blankRowInterval");
const intervalError = document.getElementById("intervalError");
const toast = document.getElementById("toast");
const clearConfirmDialog = document.getElementById("clearConfirmDialog");
const clearConfirmCount = document.getElementById("clearConfirmCount");
const clearCancelBtn = document.getElementById("clearCancelBtn");
const clearConfirmBtn = document.getElementById("clearConfirmBtn");
const bulkToggleBtn = document.getElementById("bulkToggleBtn");
const bulkPanel = document.getElementById("bulkPanel");
const bulkInput = document.getElementById("bulkInput");
const bulkCancelBtn = document.getElementById("bulkCancelBtn");
const bulkSubmitBtn = document.getElementById("bulkSubmitBtn");
const shortcutsBtn = document.getElementById("shortcutsBtn");
const shortcutsDialog = document.getElementById("shortcutsDialog");
const shortcutsCloseBtn = document.getElementById("shortcutsCloseBtn");

let items = [];
let settings = { ...DEFAULT_SETTINGS };
let selectedIds = new Set();
let toastTimer;
let undoExpiryTimer;
let undoCountdownTimer;
let undoToken;
let clearInProgress = false;
const app = document.querySelector(".app");

shortcutsBtn.addEventListener("click", () => {
    shortcutsDialog.showModal();
    shortcutsCloseBtn.focus();
});
shortcutsCloseBtn.addEventListener("click", () => shortcutsDialog.close());
shortcutsDialog.addEventListener("click", event => {
    if (event.target === shortcutsDialog) shortcutsDialog.close();
});

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
    quickPasteBtn.disabled = items.length === 0;
    copyClearBtn.disabled = items.length === 0;
    clearAllBtn.disabled = items.length === 0;
    clearConfirmCount.textContent = `${items.length} collected ${items.length === 1 ? "item" : "items"}`;
    if (!items.length && clearConfirmDialog.open && !clearInProgress) clearConfirmDialog.close();
    randomizeBtn.disabled = items.length < 2;
    shuffleMode.disabled = items.length < 2;
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

quickPasteBtn.addEventListener("click", async () => {
    const current = await getItems();
    if (await writeClipboard(current)) showToast("Links copied. Press Ctrl+V to paste.");
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
    if (!current.length) return;
    clearConfirmCount.textContent = `${current.length} collected ${current.length === 1 ? "item" : "items"}`;
    clearConfirmDialog.showModal();
    clearCancelBtn.focus();
});

clearCancelBtn.addEventListener("click", () => {
    if (!clearInProgress) clearConfirmDialog.close();
});

clearConfirmDialog.addEventListener("click", event => {
    if (event.target === clearConfirmDialog && !clearInProgress) clearConfirmDialog.close();
});

clearConfirmBtn.addEventListener("click", async () => {
    if (clearInProgress) return;
    clearInProgress = true;
    clearConfirmBtn.disabled = true;
    clearCancelBtn.disabled = true;
    clearAllBtn.disabled = true;
    let undoExpiresAt;
    try {
        const current = await getItems();
        if (!current.length) {
            clearConfirmDialog.close();
            return;
        }
        const response = await requestCollectionMutation("clear", {
            ids: current.map(item => item.id),
            undoMessage: "All links cleared"
        });
        items = response.items;
        if (!response.cleared?.length) {
            render();
            clearConfirmDialog.close();
            return;
        }
        undoToken = response.undoToken;
        undoExpiresAt = response.undoExpiresAt;
    } catch (error) {
        console.error("Clear error:", error);
        showToast("Unable to clear items");
    } finally {
        clearInProgress = false;
        clearConfirmBtn.disabled = false;
        clearCancelBtn.disabled = false;
        clearAllBtn.disabled = items.length === 0;
    }
    clearConfirmDialog.close();
    if (!undoExpiresAt) return;
    selectedIds.clear();
    render();
    showUndoToast("All links cleared", undoExpiresAt);
});

randomizeBtn.addEventListener("click", async () => {
    const current = await getItems();
    if (current.length < 2) return;
    const selectedMode = shuffleMode.value;
    try {
        const shuffleData = await chrome.storage.local.get(SHUFFLE_STATE_KEY);
        const stateOrder = shuffleData[SHUFFLE_STATE_KEY]?.lastOrderIds;
        const previousOrder = buildPreviousOrder(current, stateOrder);
        let shuffled;
        if (selectedMode === "smart") {
            shuffled = smartShuffle(current);
        } else if (selectedMode === "again") {
            shuffled = shuffleAgain(current, previousOrder);
        } else {
            // Quick Shuffle is exactly one Fisher–Yates pass.
            shuffled = fisherYates(current);
        }
        const response = await requestCollectionMutation("shuffle", {
            ids: shuffled.map(item => item.id),
            mode: selectedMode
        });
        items = response.items;
        render();
        animateShuffle();
        showToast(selectedMode === "smart" ? "Smart shuffle complete" : "Links randomized");
    } catch (error) {
        console.error("Randomize error:", error);
        showToast("Unable to randomize links. Try again.");
    }
});

function fisherYates(source) {
    const shuffled = [...source];
    for (let index = shuffled.length - 1; index > 0; index--) {
        const swapIndex = secureRandomIndex(index + 1);
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

// Rejection sampling avoids modulo bias when turning secure random words into indices.
function secureRandomIndex(maxExclusive) {
    const range = 0x1_0000_0000;
    const limit = range - (range % maxExclusive);
    const word = new Uint32Array(1);
    do {
        crypto.getRandomValues(word);
    } while (word[0] >= limit);
    return word[0] % maxExclusive;
}

function buildPreviousOrder(source, lastOrderIds) {
    const currentIds = new Set(source.map(item => item.id));
    const stored = [];
    const seen = new Set();
    if (Array.isArray(lastOrderIds)) {
        for (const id of lastOrderIds) {
            if (currentIds.has(id) && !seen.has(id)) {
                stored.push(id);
                seen.add(id);
            }
        }
    }
    stored.push(...source.filter(item => !seen.has(item.id)).map(item => item.id));
    return stored;
}

function shuffleAgain(source, previousOrderIds) {
    if (source.length < 2) return [...source];
    const previous = previousOrderIds.join("\u0000");
    // A fixed candidate budget prevents retries from growing without bound.
    for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = fisherYates(source);
        if (candidate.map(item => item.id).join("\u0000") !== previous) return candidate;
    }
    // If sampling repeated the same ordering each time, swap a pair to guarantee a fresh order.
    const fallback = fisherYates(source);
    [fallback[0], fallback[1]] = [fallback[1], fallback[0]];
    return fallback;
}

// Choose the least-adjacent-similarity permutation from a size-bounded sample.
function smartShuffle(source) {
    if (source.length < 2) return [...source];
    const descriptors = new Map(source.map(item => [item.id, describeUrlSimilarity(item)]));
    const candidateCount = Math.max(2, Math.min(48, Math.floor(400_000 / source.length)));
    let best = null;
    let bestScore = Infinity;
    for (let attempt = 0; attempt < candidateCount; attempt++) {
        const candidate = fisherYates(source);
        let score = 0;
        for (let index = 1; index < candidate.length; index++) {
            score += adjacentSimilarity(descriptors.get(candidate[index - 1].id), descriptors.get(candidate[index].id));
        }
        if (score < bestScore) {
            best = candidate;
            bestScore = score;
        }
    }
    return best || fisherYates(source);
}

function describeUrlSimilarity(item) {
    if (item.type !== "url") return { isUrl: false };
    try {
        const url = new URL(item.value);
        const host = url.hostname.toLowerCase().replace(/^www\./, "");
        const labels = host.split(".").filter(Boolean);
        const suffix = labels.slice(-2).join(".");
        const isIpAddress = host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
        const baseDomain = isIpAddress ? host : labels.length > 2 && TWO_LEVEL_PUBLIC_SUFFIXES.has(suffix)
            ? labels.slice(-3).join(".")
            : labels.length > 1 ? suffix : host;
        const segments = url.pathname.split("/").filter(Boolean);
        const pathShape = segments.map(segment => {
            if (/^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,})$/i.test(segment)) return ":id";
            const extension = segment.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
            return extension ? `:file.${extension}` : segment.toLowerCase();
        }).join("/");
        const queryShape = [...new Set([...url.searchParams.keys()])].sort().join("&");
        return { isUrl: true, host, baseDomain, pathShape, segmentCount: segments.length, queryShape };
    } catch {
        return { isUrl: false };
    }
}

function adjacentSimilarity(left, right) {
    if (!left?.isUrl || !right?.isUrl) return 0;
    let score = 0;
    if (left.host === right.host) score += 6;
    else if (left.baseDomain === right.baseDomain) score += 2;
    if (left.pathShape === right.pathShape) score += 4;
    if (left.segmentCount === right.segmentCount) score += 1;
    if (left.queryShape && left.queryShape === right.queryShape) score += 1;
    return score;
}

function animateShuffle() {
    itemsList.classList.remove("shuffle-feedback");
    void itemsList.offsetWidth;
    itemsList.classList.add("shuffle-feedback");
}

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
        const expiredToken = undoToken;
        undoToken = undefined;
        clearUndoTimers();
        app.classList.remove("undo-active");
        requestCollectionMutation("expireUndo", { token: expiredToken }).catch(error => console.error("Undo backup cleanup error:", error));
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
            clearUndoTimers();
            app.classList.remove("undo-active");
            items = response.items;
            toast.replaceChildren(document.createTextNode(response.restored ? "Links restored" : "No links to restore"));
            toast.classList.add("show");
            render();
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
        } catch (error) {
            console.error("Undo clear error:", error);
            undoToken = undefined;
            clearUndoTimers();
            app.classList.remove("undo-active");
            toast.replaceChildren(document.createTextNode("Unable to restore links"));
            toast.classList.add("show");
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
        }
    });
    const content = document.createElement("div");
    content.className = "undo-toast-content";
    const messageText = document.createElement("span");
    messageText.className = "undo-message";
    messageText.textContent = message;
    const countdown = document.createElement("span");
    countdown.className = "undo-countdown";
    countdown.setAttribute("role", "timer");
    countdown.setAttribute("aria-live", "off");
    content.append(messageText, countdown, undoButton);
    const progress = document.createElement("div");
    progress.className = "undo-progress";
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", "Undo time remaining");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", String(UNDO_TTL_MS));
    const progressValue = document.createElement("span");
    progress.appendChild(progressValue);
    toast.replaceChildren(content, progress);
    toast.classList.add("show");
    app.classList.add("undo-active");
    clearTimeout(toastTimer);
    clearUndoTimers();
    const updateCountdown = () => {
        if (undoToken !== token) return;
        const remaining = Math.max(0, expiresAt - Date.now());
        countdown.textContent = formatUndoCountdown(remaining);
        progressValue.style.width = `${Math.min(100, (remaining / UNDO_TTL_MS) * 100)}%`;
        progress.setAttribute("aria-valuenow", String(remaining));
        if (!remaining) expireUndoToast(token);
    };
    updateCountdown();
    undoCountdownTimer = setInterval(updateCountdown, 250);
    undoExpiryTimer = setTimeout(() => expireUndoToast(token), remainingMs);
}

function formatUndoCountdown(remainingMs) {
    const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
    return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function expireUndoToast(token) {
    if (undoToken !== token) return;
    undoToken = undefined;
    clearUndoTimers();
    app.classList.remove("undo-active");
    toast.classList.remove("show");
    requestCollectionMutation("expireUndo", { token }).catch(error => console.error("Undo backup cleanup error:", error));
}

function clearUndoTimers() {
    clearTimeout(undoExpiryTimer);
    clearInterval(undoCountdownTimer);
    undoExpiryTimer = undefined;
    undoCountdownTimer = undefined;
}

window.addEventListener("pagehide", clearUndoTimers);

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
