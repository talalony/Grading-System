/**
 * DOM Elements
 */
const els = {
    fileInput: document.getElementById("file-input"),
    sessionInput: document.getElementById("session-input"),
    docList: document.getElementById("doc-list"),
    viewerContainer: document.getElementById("viewer-container"),
    viewerWrapper: document.getElementById("viewer-wrapper"),
    questionsContainer: document.getElementById("questions-container"),
    totalScoreVal: document.getElementById("total-score-val"),
    maxTotalScore: document.getElementById("max-total-score"),
    rubricConfig: document.getElementById("rubric-config"),
    gradingInputs: document.getElementById("grading-inputs"),
    rubricList: document.getElementById("rubric-questions-list"),
    restoreModal: document.getElementById("restore-modal"),
    restoreModalBtn: document.getElementById("restore-modal-btn"),
    restoreModalCancel: document.getElementById("restore-modal-cancel"),
    autosaveStatus: document.getElementById("autosave-status"),
    exportOptionsModal: document.getElementById("export-options-modal"),
    exportSkipSummaryBtn: document.getElementById("export-skip-summary-btn"),
    exportPickLocationBtn: document.getElementById("export-pick-location-btn"),
    exportInstructionBar: document.getElementById("export-instruction-bar"),
    gradeSummaryPreview: document.getElementById("grade-summary-preview"),
};

// Toast Notification System
function showToast(message, type = "info", duration = 4000) {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    const icon =
        {
            success: "✓",
            error: "✕",
            warning: "⚠",
            info: "ℹ",
        }[type] || "ℹ";

    toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-message">${message}</span>`;

    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add("toast-show"), 10);

    setTimeout(() => {
        toast.classList.remove("toast-show");
        setTimeout(() => document.body.removeChild(toast), 300);
    }, duration);
}

// Confirmation Modal Helpers
function showConfirmModal(modalId, confirmButtonId, cancelButtonId) {
    return new Promise((resolve) => {
        const modal = document.getElementById(modalId);
        const confirmBtn = document.getElementById(confirmButtonId);
        const cancelBtn = document.getElementById(cancelButtonId);

        modal.classList.remove("hidden");

        const cleanup = () => {
            modal.classList.add("hidden");
            confirmBtn.removeEventListener("click", onConfirm);
            cancelBtn.removeEventListener("click", onCancel);
        };

        const onConfirm = () => {
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        confirmBtn.addEventListener("click", onConfirm);
        cancelBtn.addEventListener("click", onCancel);
    });
}

function updateAutosaveStatus(isoTime) {
    if (!els.autosaveStatus || !isoTime) return;
    const date = new Date(isoTime);
    if (Number.isNaN(date.getTime())) return;
    els.autosaveStatus.textContent = date.toLocaleString();
}

function updateZoomDisplay() {
    document.getElementById("zoom-level").textContent =
        Math.round(AppState.scale * 100) + "%";
    if (AppState.currentDocId) {
        renderPage(pageNum);
    }
}

function renderDocList() {
    els.docList.innerHTML = "";
    AppState.documents.forEach((doc) => {
        const li = document.createElement("li");
        li.className = `doc-item ${doc.id === AppState.currentDocId ? "active" : ""}`;
        li.onclick = () => {
            loadDocument(doc.id);
            const searchInput = document.getElementById("file-search");
            if (searchInput && searchInput.value) {
                searchInput.value = "";
                searchInput.dispatchEvent(new Event("input"));
            }
        };

        const icon = document.createElement("span");
        icon.className = "material-icons";
        icon.textContent = "picture_as_pdf";

        const content = document.createElement("div");
        content.className = "doc-item-content";

        const name = document.createElement("p");
        name.className = "doc-item-name";
        name.textContent = doc.name;

        const meta = document.createElement("p");
        meta.className = "doc-item-meta";

        const scores = AppState.scores[doc.id];
        const hasAnyScores = scores && Object.keys(scores).length > 0;
        const totalQuestions = AppState.rubric.questions.length;
        const answeredCount = scores ? Object.keys(scores).length : 0;
        const hasAllScores = totalQuestions > 0 && answeredCount === totalQuestions;

        if (hasAllScores) {
            meta.innerHTML = '<span class="material-icons" style="font-size: 14px; vertical-align: middle; color: #10b981;">check_circle</span> Graded';
            li.classList.add("graded");
        } else if (hasAnyScores) {
            meta.innerHTML = '<span class="material-icons" style="font-size: 14px; vertical-align: middle; color: #f59e0b;">remove_circle</span> Partial';
            li.classList.add("partial");
        } else {
            meta.textContent = "Not graded";
        }

        content.appendChild(name);
        content.appendChild(meta);
        li.appendChild(icon);
        li.appendChild(content);
        els.docList.appendChild(li);
    });
}

function renderAnnotationBank() {
    const bankList = document.getElementById("annotation-bank-list");
    if (!bankList) return;

    bankList.innerHTML = "";

    if (AppState.annotationBank.length === 0) {
        bankList.innerHTML =
            '<div class="annotation-bank-empty">No annotations saved yet</div>';
        return;
    }

    AppState.annotationBank.forEach((text, index) => {
        const item = document.createElement("div");
        item.className = "annotation-bank-item";

        item.onclick = () => {
            // Place text on the current page
            if (!AppState.currentDocId || !pdfDoc) {
                showToast("Please open a document first", "warning", 2000);
                return;
            }

            const annotCanvas = document.querySelector(".annotation-layer");
            if (!annotCanvas) {
                showToast("No page loaded", "warning", 2000);
                return;
            }

            // Get the center of the visible canvas area
            const rect = annotCanvas.getBoundingClientRect();
            const container = document.getElementById("viewer-container");
            const containerRect = container.getBoundingClientRect();

            // Calculate center of visible area in screen coordinates
            let screenX = containerRect.left + containerRect.width / 2;
            let screenY = containerRect.top + containerRect.height / 2;

            // Estimate text width to center the annotation
            if (annotCanvas) {
                const ctx = annotCanvas.getContext('2d');
                if (ctx) {
                    const fontSize = (AppState.defaultTextSize || 14) * AppState.scale;
                    ctx.font = `${fontSize}px Arial`; // Match default font
                    const metrics = ctx.measureText(text);
                    const width = metrics.width;
                    screenX -= width / 2;
                }
            }

            // Calculate canvas coordinates
            const canvasX = (screenX - rect.left) / AppState.scale;
            const canvasY = (screenY - rect.top) / AppState.scale;

            // Store the bank text and open text editor
            AppState.pendingBankText = text;
            createTextInput(screenX, screenY, canvasX, canvasY, pageNum, annotCanvas);
        };

        const textContent = document.createElement("p");
        textContent.className = "annotation-bank-text";
        textContent.dir = "auto";
        textContent.textContent = text;

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "annotation-bank-delete";
        deleteBtn.innerHTML = '<span class="material-icons">delete_outline</span>';
        deleteBtn.title = "Remove from bank";
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            AppState.annotationBank.splice(index, 1);
            renderAnnotationBank();
            showToast("Removed from annotation bank", "info", 2000);
        };

        item.appendChild(textContent);
        item.appendChild(deleteBtn);
        bankList.appendChild(item);
    });
}

function updateTotal() {
    if (!AppState.currentDocId) {
        els.totalScoreVal.textContent = 0;
        const inlineDisplay = document.getElementById("total-score-display-inline");
        if (inlineDisplay) inlineDisplay.textContent = "-- / 0";
        return;
    }
    const scores = AppState.scores[AppState.currentDocId] || {};
    let sum = 0;
    Object.values(scores).forEach((v) => (sum += v));
    els.totalScoreVal.textContent = sum;

    // Update inline display if it exists
    const inlineDisplay = document.getElementById("total-score-display-inline");
    if (inlineDisplay) {
        const maxTotal = AppState.rubric.questions.reduce((acc, q) => acc + q.max, 0);
        inlineDisplay.textContent = `${sum} / ${maxTotal}`;
    }
}
