(function () {
    let hoveredLink;
    let pointerPosition;

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
        const isTextInput = element instanceof HTMLInputElement &&
            ["text", "search", "url", "tel", "email", "password"].includes(element.type);
        return isTextInput ||
            element instanceof HTMLTextAreaElement ||
            element?.isContentEditable === true ||
            element?.closest?.("[contenteditable='true']");
    }

    function editableRoot(element) {
        let root = element instanceof Element ? element : null;
        while (root?.parentElement?.isContentEditable && root.isContentEditable) root = root.parentElement;
        return root;
    }

    function captureSelection(target, selectAll = false) {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            return selectAll
                ? { start: 0, end: target.value.length }
                : { start: target.selectionStart, end: target.selectionEnd };
        }
        const editor = editableRoot(target);
        const selection = window.getSelection();
        if (!selection) return undefined;
        let range;
        if (selectAll && editor instanceof Element) {
            range = document.createRange();
            range.selectNodeContents(editor);
        } else if (selection.rangeCount) {
            range = selection.getRangeAt(0).cloneRange();
        } else {
            return undefined;
        }
        return { range: range.cloneRange() };
    }

    function insertTextAtSelection(target, text, selectionState) {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            const start = selectionState?.start;
            const end = selectionState?.end;
            if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
            target.setRangeText(text, start, end, "end");
            target.dispatchEvent(new InputEvent("input", {
                bubbles: true,
                inputType: "insertFromPaste",
                data: text
            }));
            return true;
        }

        const editor = editableRoot(target);
        if (!(editor instanceof Element)) return false;
        editor.focus();
        const selection = window.getSelection();
        if (selectionState?.range && selection) {
            selection.removeAllRanges();
            selection.addRange(selectionState.range);
        }
        if (document.execCommand("insertText", false, text)) return true;

        if (!selection || !selection.rangeCount) return false;
        const range = selection.getRangeAt(0);
        if (!editor.contains(range.commonAncestorContainer)) return false;
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        editor.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertFromPaste",
            data: text
        }));
        return true;
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

    const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

    function cleanUrlCandidate(value) {
        let candidate = value;
        // Sentence punctuation and closing delimiters are usually outside a URL.
        while (/[.,!?;:'"\]}]$/.test(candidate)) candidate = candidate.slice(0, -1);
        while (candidate.endsWith(")") && (candidate.match(/\(/g) || []).length < (candidate.match(/\)/g) || []).length) candidate = candidate.slice(0, -1);
        try {
            const parsed = new URL(candidate);
            if (parsed.protocol === "http:" || parsed.protocol === "https:") return candidate;
        } catch { /* Not a valid absolute HTTP(S) URL. */ }
        return "";
    }

    function caretAtPoint({ x, y }) {
        if (document.caretPositionFromPoint) {
            const position = document.caretPositionFromPoint(x, y);
            if (position) return { node: position.offsetNode, offset: position.offset };
        }
        if (document.caretRangeFromPoint) {
            const range = document.caretRangeFromPoint(x, y);
            if (range) return { node: range.startContainer, offset: range.startOffset };
        }
        return null;
    }

    function extractUrlAtPointer() {
        if (!pointerPosition) return { error: "Move the pointer over text containing a URL first" };
        const caret = caretAtPoint(pointerPosition);
        if (!caret || (caret.node.nodeType !== Node.TEXT_NODE && caret.node.nodeType !== Node.ELEMENT_NODE)) {
            return { error: "No URL found under the pointer" };
        }
        let element = caret.node.nodeType === Node.ELEMENT_NODE ? caret.node : caret.node.parentElement;
        let context = null;
        let matches = [];
        while (element && element !== document.documentElement) {
            const text = element.textContent || "";
            const found = [...text.matchAll(URL_PATTERN)].map(match => ({
                raw: match[0], start: match.index, end: match.index + match[0].length
            })).filter(match => cleanUrlCandidate(match.raw));
            if (found.length) {
                context = element;
                matches = found;
                break;
            }
            element = element.parentElement;
        }
        if (!context || !matches.length) return { error: "No HTTP or HTTPS URL found in the text under the pointer" };

        let cursorOffset;
        try {
            const range = document.createRange();
            range.selectNodeContents(context);
            range.setEnd(caret.node, Math.min(caret.offset, caret.node.nodeType === Node.TEXT_NODE ? caret.node.length : caret.node.childNodes.length));
            cursorOffset = range.toString().length;
        } catch {
            cursorOffset = matches[0].start;
        }
        const ranked = matches.map(match => ({
            url: cleanUrlCandidate(match.raw),
            distance: cursorOffset < match.start ? match.start - cursorOffset : cursorOffset > match.end ? cursorOffset - match.end : 0
        })).sort((a, b) => a.distance - b.distance);
        if (ranked.length > 1 && ranked[0].distance === ranked[1].distance && ranked[0].url !== ranked[1].url) {
            return { error: "More than one URL is equally close to the pointer; move over the intended URL" };
        }
        return { url: ranked[0].url };
    }

    function collectUrlUnderPointer() {
        const result = extractUrlAtPointer();
        if (!result.url) {
            notify(result.error);
            return;
        }
        if (!chrome.runtime?.sendMessage) {
            notify("SEO Link Collector is unavailable. Reload the extension and try again.");
            return;
        }
        try {
            chrome.runtime.sendMessage({ type: "seoCollector:hoveredLink", url: result.url }, response => {
                const error = chrome.runtime.lastError;
                if (error || !response || response.error) notify("Unable to add URL. Please try again.");
                else if (response.duplicate) notify("Already collected");
                else if (response.added) notify("URL added to SEO Collector");
                else notify("URL was not added");
            });
        } catch (error) {
            console.error("Unable to send extracted URL to SEO Collector:", error);
            notify("Unable to add URL. Please try again.");
        }
    }

    async function pasteFromClipboard(target) {
        if (!isPasteDestination(target)) {
            notify("Focus a text field before using Ctrl+Space");
            return { ok: false };
        }
        const selectionState = captureSelection(target, true);
        let text;
        try {
            text = await navigator.clipboard.readText();
        } catch (error) {
            console.error("Unable to read system clipboard:", error);
            notify("Clipboard access was blocked. Use Ctrl+V instead.");
            return { ok: false };
        }
        if (!text) {
            notify("The system clipboard is empty");
            return { ok: false };
        }
        try {
            if (!insertTextAtSelection(target, text, selectionState)) {
                notify("This editor blocked text insertion. Use Ctrl+V instead.");
                return { ok: false };
            }
            return { ok: true };
        } catch (error) {
            console.error("Unable to insert clipboard text:", error);
            notify("This editor blocked text insertion. Use Ctrl+V instead.");
            return { ok: false };
        }
    }

    document.addEventListener("pointerover", event => {
        pointerPosition = { x: event.clientX, y: event.clientY };
        const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
        const href = anchor?.href || "";
        hoveredLink = anchor && isHttpUrl(href) ? href : undefined;
    }, true);

    document.addEventListener("pointermove", event => {
        pointerPosition = { x: event.clientX, y: event.clientY };
    }, true);

    document.addEventListener("pointerout", event => {
        if (!event.relatedTarget || !(event.relatedTarget instanceof Node) ||
            !event.relatedTarget.closest?.("a[href]")) {
            hoveredLink = undefined;
        }
    }, true);

    let ctrlSpacePasteActive = false;
    window.addEventListener("keydown", async event => {
        if (event.isComposing || event.repeat || event.getModifierState?.("AltGraph")) return;

        if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.code === "KeyZ" && !isEditable(event.target)) {
            event.preventDefault();
            collectUrlUnderPointer();
            return;
        }

        if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.key?.toLowerCase() !== "z" && !isEditable(event.target)) {
            event.preventDefault();
            if (!hoveredLink) return;
            try {
                chrome.runtime.sendMessage({ type: "seoCollector:hoveredLink", url: hoveredLink }, response => {
                    if (chrome.runtime.lastError || !response || response.error) {
                    notify("Unable to add link");
                    } else if (response.duplicate) {
                        notify("Already collected");
                    } else if (response.added) {
                        notify("Link added to SEO Collector");
                    }
                });
            } catch (error) {
                console.error("Unable to send hovered link to SEO Collector:", error);
                notify("Unable to add link");
            }
            return;
        }

        if (event.ctrlKey && event.code === "Space" && isPasteDestination(event.target)) {
            event.preventDefault();
            if (ctrlSpacePasteActive) return;
            ctrlSpacePasteActive = true;
            try {
                await pasteFromClipboard(event.target);
            } finally {
                ctrlSpacePasteActive = false;
            }
        }
    }, true);

    window.addEventListener("blur", () => {
        hoveredLink = undefined;
    });
})();
