/**
 * Initialization & Event Listeners
 */
document.addEventListener("DOMContentLoaded", async () => {
    renderRubricInputs();
    renderRubricConfig();
    renderAnnotationBank();

    const autosavedRaw = localStorage.getItem(AUTOSAVE_KEY);
    if (autosavedRaw) {
        try {
            const autosaved = JSON.parse(autosavedRaw);
            if (autosaved.autosavedAt) {
                updateAutosaveStatus(autosaved.autosavedAt);
            }
            const shouldRestore = await showConfirmModal(
                "autosave-restore-modal",
                "autosave-restore-btn",
                "autosave-restore-cancel",
            );
            if (shouldRestore) {
                await applySession(autosaved, { allowFolderPicker: false });
            }
        } catch (err) {
            console.warn("Failed to read autosave:", err);
        }
    }

    // Global Keyboard Shortcuts
    document.addEventListener("keydown", (e) => {
        const tag = e.target && e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;

        const hasModifier = e.ctrlKey || e.metaKey;
        if (hasModifier && e.code === "KeyZ" && !e.shiftKey) {
            e.preventDefault();
            undo();
        }
        if (
            hasModifier &&
            (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey))
        ) {
            e.preventDefault();
            redo();
        }

        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            const key = e.key.toLowerCase();
            if (key === "e") {
                const eraserBtn = document.querySelector(
                    '.tool-btn[data-tool="eraser"]',
                );
                if (eraserBtn) eraserBtn.click();
            }
            if (key === "p") {
                const penBtn = document.querySelector('.tool-btn[data-tool="pen"]');
                if (penBtn) penBtn.click();
            }
            if (key === "t") {
                const textBtn = document.querySelector('.tool-btn[data-tool="text"]');
                if (textBtn) textBtn.click();
            }
            if (key === "c") {
                const cursorBtn = document.querySelector(
                    '.tool-btn[data-tool="cursor"]',
                );
                if (cursorBtn) cursorBtn.click();
            }
        }
    });

    if (els.restoreModalBtn) {
        els.restoreModalBtn.addEventListener("click", async () => {
            if (!AppState.pendingRestoreDocs || !AppState.pendingRestoreDocs.length) {
                return;
            }
            try {
                await restoreSessionDocumentsFromFolder(AppState.pendingRestoreDocs);
                AppState.pendingRestoreDocs = null;
                els.restoreModal.classList.add("hidden");
            } catch (err) {
                showToast("Folder selection was canceled", "warning");
            }
        });
    }

    if (els.restoreModalCancel) {
        els.restoreModalCancel.addEventListener("click", () => {
            els.restoreModal.classList.add("hidden");
        });
    }

    // Zoom with Ctrl+Scroll (Global)
    window.addEventListener(
        "wheel",
        (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                if (e.deltaY < 0) {
                    zoomIn();
                } else {
                    zoomOut();
                }
            }
        },
        { passive: false },
    );
});

function undo() {
    if (!AppState.currentDocId) return;
    const hist = getHistory(AppState.currentDocId, pageNum);
    if (hist.undo.length === 0) return;

    const currentAnns = JSON.parse(
        JSON.stringify(
            AppState.annotations[AppState.currentDocId]?.[pageNum] || [],
        ),
    );
    hist.redo.push(currentAnns);

    const prevAnns = hist.undo.pop();
    AppState.annotations[AppState.currentDocId][pageNum] = prevAnns;

    const pageContainer = document.querySelector(".page-wrapper");
    if (pageContainer) {
        const annotCanvas = pageContainer.querySelector(".annotation-layer");
        drawAnnotations(annotCanvas, pageNum);
    }

    scheduleAutosave();
}

function redo() {
    if (!AppState.currentDocId) return;
    const hist = getHistory(AppState.currentDocId, pageNum);
    if (hist.redo.length === 0) return;

    const currentAnns = JSON.parse(
        JSON.stringify(
            AppState.annotations[AppState.currentDocId]?.[pageNum] || [],
        ),
    );
    hist.undo.push(currentAnns);

    const nextAnns = hist.redo.pop();
    AppState.annotations[AppState.currentDocId][pageNum] = nextAnns;

    const pageContainer = document.querySelector(".page-wrapper");
    if (pageContainer) {
        const annotCanvas = pageContainer.querySelector(".annotation-layer");
        drawAnnotations(annotCanvas, pageNum);
    }

    scheduleAutosave();
}

// File Handling
els.fileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files).filter(
        (f) =>
            f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    for (const file of files) {
        const arrayBuffer = await file.arrayBuffer();

        let existingDocId = null;
        if (window.sessionRestoredDocs) {
            const found = window.sessionRestoredDocs.find(
                (d) => d.name === file.name,
            );
            if (found) existingDocId = found.id;
        }

        const doc = {
            id: existingDocId || file.name,
            name: file.name,
            file: file,
            arrayBuffer: arrayBuffer,
        };

        if (!existingDocId) {
            if (!AppState.annotations[doc.id]) AppState.annotations[doc.id] = {};
            if (!AppState.scores[doc.id]) AppState.scores[doc.id] = {};
        }

        const existingIdx = AppState.documents.findIndex(
            (d) => d.name === doc.name,
        );
        if (existingIdx >= 0) {
            AppState.documents[existingIdx] = doc;
        } else {
            AppState.documents.push(doc);
        }
    }
    renderDocList();
    if (!AppState.currentDocId && AppState.documents.length > 0) {
        loadDocument(AppState.documents[0].id);
    }
});

// Session file input handler
els.sessionInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const session = JSON.parse(text);

        if (AppState.documents.length > 0) {
            const missing = await mergeSessionIntoState(session, {
                promptRubric: true,
            });

            if (missing.length > 0) {
                AppState.pendingRestoreDocs = missing;
                if (els.restoreModal) {
                    els.restoreModal.classList.remove("hidden");
                }
            } else {
                showToast("Session merged successfully", "success", 3000);
            }

            renderRubricInputs();
            renderDocList();
            scheduleAutosave();
        } else {
            await applySession(session, { allowFolderPicker: false });
        }
    } catch (err) {
        console.error(err);
        showToast("Error loading session: " + err.message, "error", 6000);
    }

    // Clear the input so the same file can be loaded again
    e.target.value = "";
});

// Navigation
document.getElementById("prev-page").addEventListener("click", () => {
    if (pageNum <= 1) return;
    pageNum--;
    renderPage(pageNum);
});
document.getElementById("next-page").addEventListener("click", () => {
    if (pageNum >= pdfDoc.numPages) return;
    pageNum++;
    renderPage(pageNum);
});
document.getElementById("zoom-in").addEventListener("click", zoomIn);
document.getElementById("zoom-out").addEventListener("click", zoomOut);

// Tools
document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
        document
            .querySelectorAll(".tool-btn[data-tool]")
            .forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        AppState.currentTool = e.target.dataset.tool;

        // Update cursor style
        if (AppState.currentTool === "cursor") {
            els.viewerContainer.style.cursor = "grab";
        } else {
            els.viewerContainer.style.cursor = "crosshair";
        }
    });
});
// Pen color and text size controls (only if they exist)
const penColorInput = document.getElementById("pen-color");
if (penColorInput) {
    penColorInput.addEventListener("change", (e) => (AppState.penColor = e.target.value));
}

const textSizeInput = document.getElementById("default-text-size");
if (textSizeInput) {
    textSizeInput.addEventListener("change", (e) => {
        const size = parseInt(e.target.value) || 14;
        AppState.defaultTextSize = Math.max(6, Math.min(72, size));
    });
}

// File search functionality
const fileSearchInput = document.getElementById("file-search");
if (fileSearchInput) {
    fileSearchInput.addEventListener("input", (e) => {
        const searchText = e.target.value.toLowerCase();
        const docItems = document.querySelectorAll(".doc-item");

        docItems.forEach((item) => {
            const nameEl = item.querySelector(".doc-item-name");
            if (!nameEl) return;
            const fileName = nameEl.textContent.toLowerCase();
            if (fileName.startsWith(searchText)) {
                item.style.display = "";
            } else {
                item.style.display = "none";
            }
        });
    });
}

// Global Panning Listeners
window.addEventListener("mousemove", (e) => {
    if (AppState.isPanning) {
        const dx = e.clientX - AppState.panStart.x;
        const dy = e.clientY - AppState.panStart.y;

        els.viewerContainer.scrollLeft = AppState.scrollStart.x - dx;
        els.viewerContainer.scrollTop = AppState.scrollStart.y - dy;
    }
});

window.addEventListener("mouseup", () => {
    if (AppState.isPanning) {
        AppState.isPanning = false;
        els.viewerContainer.style.cursor = "grab";
    }
});

// Config Panel
document
    .getElementById("toggle-rubric-config")
    .addEventListener("click", () => {
        els.gradingInputs.classList.toggle("hidden");
        els.rubricConfig.classList.toggle("visible");
        if (els.rubricConfig.classList.contains("visible")) {
            renderRubricConfig();
        }
    });

document.getElementById("save-rubric-btn").addEventListener("click", () => {
    els.rubricConfig.classList.remove("visible");
    els.gradingInputs.classList.remove("hidden");
    renderRubricInputs();
});

document.getElementById("add-question-btn").addEventListener("click", () => {
    const nextNum = AppState.rubric.questions.length + 1;
    const id = Date.now();
    AppState.rubric.questions.push({
        id,
        label: `Q${nextNum}`,
        max: 10,
    });
    renderRubricConfig();
    scheduleAutosave();
});

document.getElementById("remove-question-btn").addEventListener("click", () => {
    if (AppState.rubric.questions.length > 1) {
        AppState.rubric.questions.pop();
        renderRubricConfig();
        renderRubricInputs();
        scheduleAutosave();
    } else {
        showToast("Must have at least one question", "warning", 2000);
    }
});

/**
 * Persistence & Finalization
 */
document.getElementById("save-session-btn").addEventListener("click", () => {
    const session = buildSessionSnapshot();
    const blob = new Blob([JSON.stringify(session, null, 2)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "grading_session.json";
    a.click();
});


document
    .getElementById("load-session-input")
    .addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        let missingDocs = [];
        for (const file of files) {
            const text = await file.text();
            const session = JSON.parse(text);
            const missing = await mergeSessionIntoState(session, {
                promptRubric: true,
            });
            missingDocs = missingDocs.concat(missing);
        }

        if (missingDocs.length) {
            AppState.pendingRestoreDocs = missingDocs;
            if (els.restoreModal) {
                els.restoreModal.classList.remove("hidden");
            }
        }

        renderRubricInputs();
        renderDocList();
        scheduleAutosave();
    });

document.getElementById("finalize-btn").addEventListener("click", () => {
    if (!AppState.currentDocId) return;
    if (!window.fontkit) {
        showToast("Error: Font library not loaded. Please refresh the page.", "error");
        return;
    }
    AppState.pendingExportMode = "single";
    if (els.exportOptionsModal) els.exportOptionsModal.classList.remove("hidden");
});

document.getElementById("finalize-all-btn").addEventListener("click", () => {
    if (!AppState.documents.length) return;
    if (!window.fontkit) {
        showToast("Error: Font library not loaded. Please refresh the page.", "error");
        return;
    }
    AppState.pendingExportMode = "all";
    if (els.exportOptionsModal) els.exportOptionsModal.classList.remove("hidden");
});

if (els.exportSkipSummaryBtn) {
    els.exportSkipSummaryBtn.addEventListener("click", () => {
        els.exportOptionsModal.classList.add("hidden");
        executeExport(null);
    });
}

if (els.exportPickLocationBtn) {
    els.exportPickLocationBtn.addEventListener("click", () => {
        els.exportOptionsModal.classList.add("hidden");
        startGradeSummaryPlacement();
    });
}

let isPlacingSummary = false;

async function startGradeSummaryPlacement() {
    isPlacingSummary = true;
    els.exportInstructionBar.classList.remove("hidden");
    els.gradeSummaryPreview.classList.remove("hidden");

    if (typeof pageNum !== 'undefined' && pageNum !== 1) {
        pageNum = 1;
        if (typeof renderPage === 'function') {
            await renderPage(1);
        }
    }

    let firstDoc = AppState.pendingExportMode === "all" ? AppState.documents[0] : AppState.documents.find((d) => d.id === AppState.currentDocId);
    let sampleScores = AppState.scores[firstDoc?.id] || {};
    let sampleTotal = 0;

    const rubricLines = AppState.rubric.questions.map((q) => {
        let sc = sampleScores[q.id] || 0;
        sampleTotal += sc;
        return `${q.label}: ${sc}`;
    });
    const maxTotal = AppState.rubric.questions.reduce((acc, q) => acc + q.max, 0);
    rubricLines.push("", `Total: ${sampleTotal} / ${maxTotal}`);

    els.gradeSummaryPreview.querySelector(".preview-content").innerHTML = rubricLines.join("<br>");

    const container = document.getElementById("viewer-container");
    container.style.cursor = "crosshair";

    const onMouseMove = (e) => {
        if (!isPlacingSummary) return;

        const size = AppState.defaultTextSize || 14;
        const scaledSize = size * AppState.scale;

        els.gradeSummaryPreview.style.left = (e.clientX + 10) + "px"; // Slight offset
        els.gradeSummaryPreview.style.top = (e.clientY + 10) + "px";
        els.gradeSummaryPreview.style.fontSize = scaledSize + "px";
        els.gradeSummaryPreview.style.lineHeight = "1.5";
    };

    const onClick = (e) => {
        if (!isPlacingSummary) return;
        const pageWrapper = e.target.closest(".page-wrapper");
        if (!pageWrapper) return;

        const annotCanvas = pageWrapper.querySelector(".annotation-layer");
        if (!annotCanvas) return;

        const rect = annotCanvas.getBoundingClientRect();

        // Calculate canvas coordinates based on click position
        // Preview is offset by 10px and has 10px padding, making text start at +20
        const previewX = e.clientX + 20;
        const previewY = e.clientY + 20;

        const canvasX = (previewX - rect.left) / AppState.scale;
        const canvasY = (previewY - rect.top) / AppState.scale;

        e.preventDefault();
        e.stopPropagation();

        cleanup();

        executeExport({ x: canvasX, y: canvasY });
    };

    const onKeyDown = (e) => {
        if (e.key === "Escape" && isPlacingSummary) {
            cleanup();
            AppState.pendingExportMode = null;
            showToast("Export canceled.", "info", 3000);
        }
    };

    const cleanup = () => {
        isPlacingSummary = false;
        els.exportInstructionBar.classList.add("hidden");
        els.gradeSummaryPreview.classList.add("hidden");
        container.style.cursor = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKeyDown);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown);
}

async function executeExport(summaryPos = null) {
    const isAll = AppState.pendingExportMode === "all";
    const docsToExport = isAll ? AppState.documents : [AppState.documents.find((d) => d.id === AppState.currentDocId)];
    if (!docsToExport[0]) return;

    const btn = isAll ? document.getElementById("finalize-all-btn") : document.getElementById("finalize-btn");
    const originalContent = isAll ? btn.innerHTML : btn.textContent;

    if (isAll) {
        btn.innerHTML = '<span class="material-icons spin">autorenew</span> Saving...';
    } else {
        btn.textContent = "⏳ Processing...";
    }
    btn.disabled = true;

    try {
        if (isAll && window.showDirectoryPicker) {
            const dirHandle = await window.showDirectoryPicker();
            for (const doc of docsToExport) {
                const pdfBytes = await buildGradedPdfBytes(doc, summaryPos);
                const fileName = `graded_${doc.name}`;
                const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(new Blob([pdfBytes], { type: "application/pdf" }));
                await writable.close();
            }
        } else {
            for (const doc of docsToExport) {
                const pdfBytes = await buildGradedPdfBytes(doc, summaryPos);
                const blob = new Blob([pdfBytes], { type: "application/pdf" });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `graded_${doc.name}`;
                link.click();
            }
        }
    } catch (e) {
        console.error(e);
        showToast("Error exporting: " + e.message, "error", 6000);
    } finally {
        if (isAll) {
            btn.innerHTML = originalContent;
        } else {
            btn.textContent = originalContent;
        }
        btn.disabled = false;
        AppState.pendingExportMode = null;
    }
}

document.getElementById("export-csv-btn").addEventListener("click", () => {
    const rows = [
        ["ID", "Grade", ...AppState.rubric.questions.map((q) => q.label)],
    ];
    AppState.documents.forEach((doc) => {
        const id = doc.name.replace(/\.[^/.]+$/, "");
        const scores = AppState.scores[doc.id] || {};
        let total = 0;
        const qScores = AppState.rubric.questions.map((q) => {
            const s = scores[q.id] || 0;
            total += s;
            return s;
        });
        rows.push([id, total, ...qScores]);
    });

    const csvContent =
        "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "grades.csv");
    document.body.appendChild(link);
    link.click();
});
