const STORAGE_KEY = "seoCollectorItems";

const itemCount = document.getElementById("itemCount");
const itemStatus = document.getElementById("itemStatus");
const itemsList = document.getElementById("itemsList");
const emptyState = document.getElementById("emptyState");
const copyAllBtn = document.getElementById("copyAllBtn");
const copyClearBtn = document.getElementById("copyClearBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const toast = document.getElementById("toast");

document.addEventListener("DOMContentLoaded", loadItems);

async function loadItems() {
    try {
        const items = await getItems();
        renderItems(items);
    } catch (error) {
        console.error("Unable to load items:", error);
    }
}

function renderItems(items) {
    itemsList.innerHTML = "";
    itemCount.textContent = items.length;

    const hasItems = items.length > 0;
    emptyState.style.display = hasItems ? "none" : "flex";
    itemsList.style.display = hasItems ? "flex" : "none";
    itemStatus.textContent = hasItems
        ? `${items.length} ${items.length === 1 ? "item" : "items"} saved`
        : "No items yet";

    copyAllBtn.disabled = !hasItems;
    copyClearBtn.disabled = !hasItems;
    clearAllBtn.disabled = !hasItems;

    if (!hasItems) {
        return;
    }

    items.forEach((item, index) => {
        const itemElement = document.createElement("div");
        itemElement.className = "item";

        const number = document.createElement("div");
        number.className = "item-number";
        number.textContent = index + 1;

        const icon = document.createElement("div");
        icon.className = "item-type";
        icon.textContent = item.type === "url" ? "🔗" : "📝";

        const content = document.createElement("div");
        content.className = "item-content";

        const value = document.createElement("div");
        value.className = "item-value";
        value.textContent = item.value;
        value.title = item.value;

        const typeLabel = document.createElement("div");
        typeLabel.className = "item-type-label";
        typeLabel.textContent = item.type === "url" ? "URL" : "TEXT";

        content.append(value, typeLabel);

        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-item";
        deleteButton.textContent = "🗑";
        deleteButton.title = "Delete item";
        deleteButton.addEventListener("click", () => deleteItem(item.id));

        itemElement.append(number, icon, content, deleteButton);
        itemsList.appendChild(itemElement);
    });
}

async function deleteItem(id) {
    try {
        const items = (await getItems()).filter(item => item.id !== id);
        await chrome.storage.local.set({ [STORAGE_KEY]: items });
        renderItems(items);
        showToast("Item deleted");
    } catch (error) {
        console.error("Delete error:", error);
    }
}

copyAllBtn.addEventListener("click", async () => {
    const items = await getItems();
    if (!items.length) {
        return;
    }

    const plainText = items.map(item => item.value).join("\n");
    const htmlContent = items.map(item => {
        const text = escapeHtml(item.value);
        return item.type === "url"
            ? `<div><a href="${escapeAttribute(item.value)}">${text}</a></div>`
            : `<div>${text}</div>`;
    }).join("");

    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/plain": new Blob([plainText], { type: "text/plain" }),
                "text/html": new Blob([htmlContent], { type: "text/html" })
            })
        ]);
        showToast(`${items.length} ${items.length === 1 ? "item" : "items"} copied`);
    } catch (error) {
        try {
            await navigator.clipboard.writeText(plainText);
            showToast(`${items.length} ${items.length === 1 ? "item" : "items"} copied`);
        } catch (fallbackError) {
            console.error("Clipboard error:", fallbackError);
            showToast("Unable to copy items");
        }
    }
});

copyClearBtn.addEventListener("click", async () => {
    const items = await getItems();
    if (!items.length) {
        return;
    }

    try {
        await navigator.clipboard.writeText(items.map(item => item.value).join("\n"));
        await chrome.storage.local.set({ [STORAGE_KEY]: [] });
        renderItems([]);
        showToast(`${items.length} ${items.length === 1 ? "item" : "items"} copied & cleared`);
    } catch (error) {
        console.error("Copy & Clear error:", error);
        showToast("Unable to copy items");
    }
});

clearAllBtn.addEventListener("click", async () => {
    const items = await getItems();
    if (!items.length || !confirm(`Delete all ${items.length} collected items?`)) {
        return;
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    renderItems([]);
    showToast("All items cleared");
});

async function getItems() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttribute(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2200);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
        return;
    }

    const items = Array.isArray(changes[STORAGE_KEY].newValue)
        ? changes[STORAGE_KEY].newValue
        : [];
    renderItems(items);
});
