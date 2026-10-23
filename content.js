(function () {
    let hoveredLink;

    function isHttpUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === "http:" || url.protocol === "https:";
        } catch {
            return false;
        }
    }

    function isEditable(element) {
        return element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement ||
            element?.isContentEditable === true ||
            element?.closest?.("[contenteditable='true']");
    }

    function isPasteDestination(element) {
        if (isEditable(element)) return true;
        if (location.hostname !== "docs.google.com") return false;
        return element?.closest?.("[role='gridcell'],[role='textbox']") ||
            document.activeElement?.closest?.("[role='gridcell'],[role='textbox']");
    }

    function notify(message) {
        const existing = document.getElementById("seo-collector-shortcut-notice");
        existing?.remove();
        const notice = document.createElement("div");
        notice.id = "seo-collector-shortcut-notice";
        notice.textContent = message;
        Object.assign(notice.style, {
            position: "fixed",
            right: "16px",
            bottom: "16px",
            zIndex: "2147483647",
            padding: "9px 13px",
            borderRadius: "7px",
            background: "#17243a",
            color: "#fff",
            font: "600 12px -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif",
            boxShadow: "0 4px 16px rgba(15,23,42,.24)"
        });
        document.documentElement.appendChild(notice);
        window.setTimeout(() => notice.remove(), 2200);
    }

    document.addEventListener("pointerover", event => {
        const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
        const href = anchor?.href || "";
        hoveredLink = anchor && isHttpUrl(href) ? href : undefined;
    }, true);

    document.addEventListener("pointerout", event => {
        if (!event.relatedTarget || !(event.relatedTarget instanceof Node) ||
            !event.relatedTarget.closest?.("a[href]")) {
            hoveredLink = undefined;
        }
    }, true);

    window.addEventListener("keydown", event => {
        if (event.isComposing || event.repeat || event.getModifierState?.("AltGraph")) return;

        if (event.ctrlKey && event.altKey && !isEditable(event.target)) {
            event.preventDefault();
            if (!hoveredLink) return;
            chrome.runtime.sendMessage({ type: "seoCollector:hoveredLink", url: hoveredLink }, response => {
                if (chrome.runtime.lastError || !response) {
                    notify("Unable to add link");
                } else if (response.duplicate) {
                    notify("Already collected");
                } else if (response.added) {
                    notify("Link added to SEO Collector");
                }
            });
            return;
        }

        if (event.ctrlKey && event.code === "Space" && isPasteDestination(event.target)) {
            event.preventDefault();
            chrome.runtime.sendMessage({ type: "seoCollector:quickPaste" }, response => {
                if (chrome.runtime.lastError || !response?.text) {
                    notify(response?.message || "Unable to prepare links");
                    return;
                }
                navigator.clipboard.writeText(response.text).then(() => {
                    notify("Links copied. Press Ctrl+V to paste here.");
                }).catch(() => notify("Clipboard access was blocked. Use Copy All in the extension."));
            });
        }
    }, true);

    window.addEventListener("keyup", event => {
    }, true);

    window.addEventListener("blur", () => {
        hoveredLink = undefined;
    });
})();
