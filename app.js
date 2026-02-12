/**
 * Application State
 */
const AppState = {
  documents: [], // { file: File, name: string, id: string, arrayBuffer: ArrayBuffer }
  currentDocId: null,
  annotations: {}, // { docId: { pageNum: [ { type: 'path'|'text', ... } ] } }
  scores: {}, // { docId: { questionId: number } }
  rubric: {
    questions: [
      { id: 1, label: "Q1", max: 10 },
      { id: 2, label: "Q2", max: 10 },
      { id: 3, label: "Q3", max: 10 },
    ],
  },
  scale: 1.0,
  currentTool: "cursor", // cursor, text, pen, eraser
  penColor: "#ff0000",
  penWidth: 2,
  textSize: 14,
  defaultTextSize: 14,
  isDrawing: false,
  currentPath: null, // for temp drawing
  pendingBankText: null,

  // Panning state
  isPanning: false,
  panStart: { x: 0, y: 0 },
  scrollStart: { x: 0, y: 0 },

  // History for Undo/Redo
  history: {},

  // Annotation selection/dragging
  selectedAnnotation: null,
  dragOrigin: null,
  dragMoved: false,

  pendingRestoreDocs: null,

  // Annotation Bank (not saved in session)
  annotationBank: [],
};

// Utils
const generateId = () => Math.random().toString(36).substr(2, 9);
const TEXT_LINE_HEIGHT = 1.2;

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

const AUTOSAVE_KEY = "grader_autosave_v1";
let autosaveTimer = null;

function buildSessionSnapshot() {
  return {
    version: "1.0",
    rubric: AppState.rubric,
    documents: AppState.documents.map((d) => ({
      id: d.id,
      name: d.name,
    })),
    annotations: AppState.annotations,
    scores: AppState.scores,
    autosavedAt: new Date().toISOString(),
  };
}

function autosaveSession() {
  try {
    const snapshot = buildSessionSnapshot();
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
    updateAutosaveStatus(snapshot.autosavedAt);
  } catch (err) {
    console.warn("Autosave failed:", err);
  }
}

function updateAutosaveStatus(isoTime) {
  if (!els.autosaveStatus || !isoTime) return;
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return;
  els.autosaveStatus.textContent = date.toLocaleString();
}

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveSession, 300);
}

const getHistory = (docId, pageNum) => {
  if (!AppState.history[docId]) AppState.history[docId] = {};
  if (!AppState.history[docId][pageNum])
    AppState.history[docId][pageNum] = { undo: [], redo: [] };
  return AppState.history[docId][pageNum];
};

const saveStateForUndo = (docId, pageNum) => {
  const hist = getHistory(docId, pageNum);
  const currentAnns = JSON.parse(
    JSON.stringify(AppState.annotations[docId]?.[pageNum] || []),
  );
  hist.undo.push(currentAnns);
  hist.redo = [];
};

/**
 * DOM Elements
 */
const els = {
  fileInput: document.getElementById("file-input"),
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
};

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

function zoomIn() {
  AppState.scale += 0.1;
  updateZoomDisplay();
}

function zoomOut() {
  if (AppState.scale > 0.2) {
    AppState.scale -= 0.1;
    updateZoomDisplay();
  }
}

function updateZoomDisplay() {
  document.getElementById("zoom-level").textContent =
    Math.round(AppState.scale * 100) + "%";
  if (AppState.currentDocId) {
    renderPage(pageNum);
  }
}

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

function renderDocList() {
  els.docList.innerHTML = "";
  AppState.documents.forEach((doc) => {
    const li = document.createElement("li");
    li.className = `doc-item ${doc.id === AppState.currentDocId ? "active" : ""}`;
    li.textContent = doc.name;
    li.onclick = () => loadDocument(doc.id);

    const scores = AppState.scores[doc.id];
    const hasAnyScores = scores && Object.keys(scores).length > 0;
    const totalQuestions = AppState.rubric.questions.length;
    const answeredCount = scores ? Object.keys(scores).length : 0;
    const hasAllScores = totalQuestions > 0 && answeredCount === totalQuestions;

    if (hasAllScores) {
      li.classList.add("graded");
    } else if (hasAnyScores) {
      li.classList.add("partial");
    }

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

    const textSpan = document.createElement("span");
    textSpan.className = "annotation-bank-text";
    textSpan.textContent = text;
    textSpan.title = text; // Show full text on hover

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
      const screenX = containerRect.left + containerRect.width / 2;
      const screenY = containerRect.top + containerRect.height / 2;

      // Calculate canvas coordinates
      const canvasX = (screenX - rect.left) / AppState.scale;
      const canvasY = (screenY - rect.top) / AppState.scale;

      // Store the bank text and open text editor
      AppState.pendingBankText = text;
      createTextInput(screenX, screenY, canvasX, canvasY, pageNum, annotCanvas);

      // showToast("Click to position text", "info", 2000);
    };

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "annotation-bank-delete";
    deleteBtn.textContent = "×";
    deleteBtn.title = "Remove from bank";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      AppState.annotationBank.splice(index, 1);
      renderAnnotationBank();
      showToast("Removed from annotation bank", "info", 2000);
    };

    item.appendChild(textSpan);
    item.appendChild(deleteBtn);
    bankList.appendChild(item);
  });
}

/**
 * PDF Viewer Logic
 */
let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let currentLoadingId = null;

async function loadDocument(id) {
  if (AppState.currentDocId === id && pdfDoc) return;

  const loadId = Date.now();
  currentLoadingId = loadId;

  try {
    AppState.currentDocId = id;
    renderDocList();
    renderRubricInputs();

    const doc = AppState.documents.find((d) => d.id === id);
    if (!doc) throw new Error("Document not found");

    // Clear viewer immediately to show change
    els.viewerWrapper.innerHTML = '<div style="padding:2rem;">Loading...</div>';

    // Clone to prevent detachment
    const data = new Uint8Array(doc.arrayBuffer.slice(0));
    const loadedPdf = await pdfjsLib.getDocument({ data }).promise;

    if (currentLoadingId !== loadId) return; // Stale request

    pdfDoc = loadedPdf;
    document.getElementById("page-info").textContent =
      `Page ${pageNum} / ${pdfDoc.numPages}`;
    pageNum = 1;
    renderPage(pageNum);
  } catch (e) {
    console.error("Error loading document:", e);
    if (currentLoadingId === loadId) {
      els.viewerWrapper.innerHTML = `<div style="padding:2rem; color:red;">Error loading document: ${e.message}</div>`;
    }
  }
}

async function renderPage(num) {
  pageRendering = true;
  const wrapper = els.viewerWrapper;
  wrapper.innerHTML = "";

  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: AppState.scale });

  // Container
  const pageContainer = document.createElement("div");
  pageContainer.className = "page-wrapper";
  pageContainer.style.width = `${viewport.width}px`;
  pageContainer.style.height = `${viewport.height}px`;

  // Canvas for PDF
  const canvas = document.createElement("canvas");
  canvas.className = "pdf-canvas";
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");

  // Canvas for Annotations
  const annotCanvas = document.createElement("canvas");
  annotCanvas.className = "annotation-layer";
  annotCanvas.width = viewport.width;
  annotCanvas.height = viewport.height;

  setupAnnotationEvents(annotCanvas, num);

  pageContainer.appendChild(canvas);
  pageContainer.appendChild(annotCanvas);
  wrapper.appendChild(pageContainer);

  // Render PDF
  const renderContext = {
    canvasContext: ctx,
    viewport: viewport,
  };
  await page.render(renderContext).promise;

  drawAnnotations(annotCanvas, num);

  pageRendering = false;
  document.getElementById("page-info").textContent =
    `Page ${num} / ${pdfDoc.numPages}`;
}

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

/**
 * Annotation Logic
 */
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
document
  .getElementById("pen-color")
  .addEventListener("change", (e) => (AppState.penColor = e.target.value));

document.getElementById("default-text-size").addEventListener("change", (e) => {
  const size = parseInt(e.target.value) || 14;
  AppState.defaultTextSize = Math.max(6, Math.min(72, size));
});

function setupAnnotationEvents(canvas, pNum) {
  const ctx = canvas.getContext("2d");
  let isEraserActive = false;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  canvas.addEventListener("mousedown", (e) => {
    if (!AppState.currentDocId) return;

    const pos = getPos(e);

    if (e.button === 2) {
      AppState.isPanning = true;
      AppState.panStart = { x: e.clientX, y: e.clientY };
      AppState.scrollStart = {
        x: els.viewerContainer.scrollLeft,
        y: els.viewerContainer.scrollTop,
      };
      els.viewerContainer.style.cursor = "grabbing";
      return;
    }

    // Cursor Tool: Move vs Pan
    if (AppState.currentTool === "cursor") {
      // Check hit
      const hit = findAnnotationAt(pos.x, pos.y, pNum);

      if (hit) {
        // Start Moving
        AppState.isDraggingAnnotation = true;
        AppState.selectedAnnotation = hit; // ref to the object in array
        AppState.dragStart = { x: pos.x, y: pos.y };
        AppState.dragOrigin = { x: pos.x, y: pos.y };
        AppState.dragMoved = false;
        AppState.dragUndoSaved = false;
        els.viewerContainer.style.cursor = "move";
      } else {
        // Start Panning
        AppState.isPanning = true;
        AppState.panStart = { x: e.clientX, y: e.clientY };
        AppState.scrollStart = {
          x: els.viewerContainer.scrollLeft,
          y: els.viewerContainer.scrollTop,
        };
        els.viewerContainer.style.cursor = "grabbing";
      }
      return;
    }

    saveStateForUndo(AppState.currentDocId, pNum); // For other tools

    if (AppState.currentTool === "pen") {
      AppState.isDrawing = true;
      AppState.currentPath = {
        type: "path",
        color: AppState.penColor,
        width: AppState.penWidth,
        points: [{ x: pos.x, y: pos.y }],
      };
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.strokeStyle = AppState.penColor;
      ctx.lineWidth = AppState.penWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    } else if (AppState.currentTool === "text") {
      createTextInput(e.clientX, e.clientY, pos.x, pos.y, pNum, canvas);
    } else if (AppState.currentTool === "eraser") {
      AppState.isDrawing = true;
      isEraserActive = true;
      eraseAt(pos.x, pos.y, pNum, canvas);
    }
  });

  // Double-click to edit text annotations
  canvas.addEventListener("mousemove", (e) => {
    const pos = getPos(e);

    // Move Annotation Logic
    if (AppState.currentTool === "cursor") {
      // Hover effect
      if (!AppState.isPanning && !AppState.isDraggingAnnotation) {
        const hit = findAnnotationAt(pos.x, pos.y, pNum);
        els.viewerContainer.style.cursor = hit ? "move" : "grab";
      }

      if (AppState.isDraggingAnnotation && AppState.selectedAnnotation) {
        const dx = pos.x - AppState.dragStart.x;
        const dy = pos.y - AppState.dragStart.y;
        const scale = AppState.scale;

        if (!AppState.dragMoved && AppState.dragOrigin) {
          const moved = Math.hypot(
            pos.x - AppState.dragOrigin.x,
            pos.y - AppState.dragOrigin.y,
          );
          if (moved > 2) {
            AppState.dragMoved = true;
            if (!AppState.dragUndoSaved) {
              saveStateForUndo(AppState.currentDocId, pNum);
              AppState.dragUndoSaved = true;
            }
          }
        }

        if (!AppState.dragMoved) return;

        // Convert delta to unscaled coords
        const dxUnscaled = dx / scale;
        const dyUnscaled = dy / scale;

        const ann = AppState.selectedAnnotation;
        if (ann.type === "text") {
          ann.x += dxUnscaled;
          ann.y += dyUnscaled;
        } else if (ann.type === "path") {
          ann.points.forEach((p) => {
            p.x += dxUnscaled;
            p.y += dyUnscaled;
          });
        }

        AppState.dragStart = { x: pos.x, y: pos.y };
        drawAnnotations(canvas, pNum);
      }
      return;
    }

    if (!AppState.isDrawing) return;

    if (AppState.currentTool === "pen") {
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      if (AppState.currentPath) {
        AppState.currentPath.points.push({ x: pos.x, y: pos.y });
      }
    } else if (AppState.currentTool === "eraser" && isEraserActive) {
      eraseAt(pos.x, pos.y, pNum, canvas);
    }
  });

  canvas.addEventListener("mouseup", (e) => {
    if (AppState.isDraggingAnnotation) {
      const shouldEditText =
        !AppState.dragMoved &&
        AppState.selectedAnnotation &&
        AppState.selectedAnnotation.type === "text";

      AppState.isDraggingAnnotation = false;
      AppState.dragOrigin = null;
      AppState.dragMoved = false;
      AppState.dragUndoSaved = false;
      const annotation = AppState.selectedAnnotation;
      AppState.selectedAnnotation = null;
      els.viewerContainer.style.cursor = "grab";

      if (shouldEditText) {
        editTextAnnotation(e.clientX, e.clientY, annotation, pNum, canvas);
      } else if (annotation) {
        scheduleAutosave();
      }
    }
    if (AppState.isDrawing) {
      AppState.isDrawing = false;
      isEraserActive = false;
      if (AppState.currentTool === "pen" && AppState.currentPath) {
        saveAnnotation(pNum, AppState.currentPath);
        AppState.currentPath = null;
      }
    }
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

function getTextBounds(annotation, scale) {
  const fontSize = annotation.size * scale;
  const lines = (annotation.text || "").split("\n");
  const lineHeight = fontSize * TEXT_LINE_HEIGHT;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  const tx = annotation.x * scale;
  const ty = annotation.y * scale;

  lines.forEach((line) => {
    const width = line.length * fontSize * 0.6;
    const isHebrew = /[\u0590-\u05FF]/.test(line);
    const lineLeft = isHebrew ? tx - width : tx;
    const lineRight = isHebrew ? tx : tx + width;
    left = Math.min(left, lineLeft);
    right = Math.max(right, lineRight);
  });

  if (!lines.length) {
    left = tx;
    right = tx;
  }

  return {
    left,
    right,
    top: ty,
    bottom: ty + lineHeight * Math.max(lines.length, 1),
  };
}

function findAnnotationAt(x, y, pNum) {
  const docId = AppState.currentDocId;
  const anns = AppState.annotations[docId]?.[pNum] || [];
  const scale = AppState.scale;
  const hitRadius = 10 * scale;

  // Check from top (end of array) to bottom
  for (let i = anns.length - 1; i >= 0; i--) {
    const a = anns[i];
    if (a.type === "path") {
      for (let pt of a.points) {
        const px = pt.x * scale;
        const py = pt.y * scale;
        const dist = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
        if (dist < hitRadius) return a;
      }
    } else if (a.type === "text") {
      const bounds = getTextBounds(a, scale);
      if (
        x >= bounds.left &&
        x <= bounds.right &&
        y >= bounds.top &&
        y <= bounds.bottom
      ) {
        return a;
      }
    }
  }
  return null;
}

function eraseAt(x, y, pNum, canvas) {
  const docId = AppState.currentDocId;
  const anns = AppState.annotations[docId]?.[pNum] || [];
  const scale = AppState.scale;
  const eraserRadius = 10 * scale;

  let changed = false;
  for (let i = anns.length - 1; i >= 0; i--) {
    const a = anns[i];
    let hit = false;

    if (a.type === "path") {
      for (let pt of a.points) {
        const px = pt.x * scale;
        const py = pt.y * scale;
        const dist = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
        if (dist < eraserRadius) {
          hit = true;
          break;
        }
      }
    } else if (a.type === "text") {
      const bounds = getTextBounds(a, scale);
      if (
        x >= bounds.left &&
        x <= bounds.right &&
        y >= bounds.top &&
        y <= bounds.bottom
      ) {
        hit = true;
      }
    }

    if (hit) {
      anns.splice(i, 1);
      changed = true;
    }
  }

  if (changed) {
    drawAnnotations(canvas, pNum);
    scheduleAutosave();
  }
}

function openTextEditor({
  screenX,
  screenY,
  canvasX,
  canvasY,
  pNum,
  canvas,
  annotation,
}) {
  const wrapper = document.createElement("div");
  wrapper.className = "text-editor-overlay";
  wrapper.style.left = screenX + "px";
  wrapper.style.top = screenY + "px";

  const input = document.createElement("textarea");
  input.className = "text-input-overlay";
  input.dir = "auto";
  input.value = annotation ? annotation.text : AppState.pendingBankText || "";

  // Clear pending bank text after using it
  if (AppState.pendingBankText) {
    AppState.pendingBankText = null;
  }

  const controls = document.createElement("div");
  controls.className = "text-editor-controls";

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = annotation?.color || AppState.penColor;

  const sizeInput = document.createElement("input");
  sizeInput.type = "number";
  sizeInput.min = "6";
  sizeInput.max = "72";
  sizeInput.value = annotation?.size || AppState.defaultTextSize;
  sizeInput.className = "text-size-input";

  const sizeLabel = document.createElement("span");
  sizeLabel.textContent = "Size";

  const addToBankBtn = document.createElement("button");
  addToBankBtn.textContent = "Add to Bank";
  addToBankBtn.className = "add-to-bank-btn";
  addToBankBtn.type = "button";
  addToBankBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const text = input.value.trim();
    if (text && !AppState.annotationBank.includes(text)) {
      AppState.annotationBank.push(text);
      renderAnnotationBank();
      showToast("Added to annotation bank", "success", 2000);
    } else if (text && AppState.annotationBank.includes(text)) {
      showToast("Already in annotation bank", "info", 2000);
    }
  });

  controls.appendChild(colorInput);
  controls.appendChild(sizeLabel);
  controls.appendChild(sizeInput);
  controls.appendChild(addToBankBtn);

  wrapper.appendChild(input);
  wrapper.appendChild(controls);
  document.body.appendChild(wrapper);

  const closeEditor = ({ applyChanges }) => {
    document.removeEventListener("mousedown", handleOutsideClick, true);

    if (applyChanges) {
      const text = input.value.replace(/\r\n/g, "\n");
      const size = Math.max(
        6,
        parseFloat(sizeInput.value) || AppState.defaultTextSize,
      );
      const color = colorInput.value || AppState.penColor;

      if (text.trim()) {
        saveStateForUndo(AppState.currentDocId, pNum);
        if (annotation) {
          annotation.text = text.trim();
          annotation.color = color;
          annotation.size = size;
        } else {
          saveAnnotation(pNum, {
            type: "text",
            text: text.trim(),
            x: canvasX,
            y: canvasY,
            color,
            size: size * AppState.scale,
          });
        }

        AppState.penColor = color;
        drawAnnotations(canvas, pNum);
        scheduleAutosave();
      }
    }

    document.body.removeChild(wrapper);

    if (!annotation) {
      AppState.currentTool = "cursor";
      document
        .querySelectorAll(".tool-btn[data-tool]")
        .forEach((b) => b.classList.remove("active"));
      const cursorBtn = document.querySelector('.tool-btn[data-tool="cursor"]');
      if (cursorBtn) cursorBtn.classList.add("active");
      els.viewerContainer.style.cursor = "grab";
    }
  };

  const handleOutsideClick = (e) => {
    if (!wrapper.contains(e.target)) {
      closeEditor({ applyChanges: true });
    }
  };

  document.addEventListener("mousedown", handleOutsideClick, true);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      closeEditor({ applyChanges: true });
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeEditor({ applyChanges: false });
    } else if (e.key === "Delete" && annotation) {
      e.preventDefault();
      // Delete the annotation
      saveStateForUndo(AppState.currentDocId, pNum);
      const annots = AppState.annotations[AppState.currentDocId]?.[pNum];
      if (annots) {
        const index = annots.indexOf(annotation);
        if (index > -1) {
          annots.splice(index, 1);
        }
      }
      drawAnnotations(canvas, pNum);
      scheduleAutosave();
      closeEditor({ applyChanges: false });
      // showToast("Text annotation deleted", "info", 2000);
    }
  });

  setTimeout(() => {
    input.focus();
    if (annotation) input.select();
  }, 10);
}

function createTextInput(screenX, screenY, canvasX, canvasY, pNum, canvas) {
  openTextEditor({
    screenX,
    screenY,
    canvasX,
    canvasY,
    pNum,
    canvas,
  });
}

function editTextAnnotation(screenX, screenY, annotation, pNum, canvas) {
  openTextEditor({
    screenX,
    screenY,
    pNum,
    canvas,
    annotation,
  });
}

function saveAnnotation(pNum, annot) {
  if (!AppState.annotations[AppState.currentDocId][pNum]) {
    AppState.annotations[AppState.currentDocId][pNum] = [];
  }
  const scale = AppState.scale;
  const newAnnot = JSON.parse(JSON.stringify(annot));

  if (newAnnot.type === "path") {
    newAnnot.points = newAnnot.points.map((p) => ({
      x: p.x / scale,
      y: p.y / scale,
    }));
    newAnnot.width = newAnnot.width / scale;
  } else if (newAnnot.type === "text") {
    newAnnot.x = newAnnot.x / scale;
    newAnnot.y = newAnnot.y / scale;
    newAnnot.size = newAnnot.size / scale;
  }

  AppState.annotations[AppState.currentDocId][pNum].push(newAnnot);
  scheduleAutosave();
}

function drawAnnotations(canvas, pNum) {
  const ctx = canvas.getContext("2d");
  const anns = AppState.annotations[AppState.currentDocId]?.[pNum] || [];
  const scale = AppState.scale;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  anns.forEach((a) => {
    if (a.type === "path") {
      ctx.beginPath();
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width * scale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (a.points.length > 0) {
        ctx.moveTo(a.points[0].x * scale, a.points[0].y * scale);
        for (let i = 1; i < a.points.length; i++) {
          ctx.lineTo(a.points[i].x * scale, a.points[i].y * scale);
        }
      }
      ctx.stroke();
    } else if (a.type === "text") {
      ctx.save();
      const fontSize = a.size * scale;
      ctx.font = `${fontSize}px Arial`;
      ctx.fillStyle = a.color;
      const lines = (a.text || "").split("\n");
      const baseX = a.x * scale;
      const baseY = a.y * scale + fontSize;
      lines.forEach((line, index) => {
        if (/[\u0590-\u05FF]/.test(line)) {
          ctx.direction = "rtl";
          ctx.textAlign = "start";
        } else {
          ctx.direction = "ltr";
          ctx.textAlign = "start";
        }
        ctx.fillText(line, baseX, baseY + index * fontSize * TEXT_LINE_HEIGHT);
      });
      ctx.restore();
    }
  });
}

/**
 * Grading Logic
 */
function renderRubricInputs() {
  const container = els.questionsContainer;
  container.innerHTML = "";
  let totalMax = 0;

  const currentScores = AppState.scores[AppState.currentDocId] || {};

  AppState.rubric.questions.forEach((q, idx) => {
    totalMax += parseInt(q.max);
    const div = document.createElement("div");
    div.className = "question-item";
    div.innerHTML = `
            <div style="flex:1;">
                <strong>${q.label}</strong> <small class="text-gray-500">/${q.max}</small>
            </div>
            <input type="number" class="score-input" 
                min="0" max="${q.max}" 
                data-qid="${q.id}" 
                tabindex="${idx + 1}"
                value="${currentScores[q.id] || ""}">
        `;
    container.appendChild(div);
  });

  els.maxTotalScore.textContent = totalMax;
  updateTotal();

  container.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      const qid = e.target.dataset.qid;
      // Validate
      const q = AppState.rubric.questions.find((x) => x.id == qid);
      if (val > q.max) e.target.style.borderColor = "red";
      else e.target.style.borderColor = "#e5e7eb";

      if (!isNaN(val)) {
        if (!AppState.scores[AppState.currentDocId])
          AppState.scores[AppState.currentDocId] = {};
        AppState.scores[AppState.currentDocId][qid] = val;
      } else {
        delete AppState.scores[AppState.currentDocId][qid]; // remove if empty
      }
      updateTotal();
      renderDocList(); // update "graded" status
      scheduleAutosave();
    });
  });
}

function updateTotal() {
  if (!AppState.currentDocId) {
    els.totalScoreVal.textContent = 0;
    return;
  }
  const scores = AppState.scores[AppState.currentDocId] || {};
  let sum = 0;
  Object.values(scores).forEach((v) => (sum += v));
  els.totalScoreVal.textContent = sum;
}

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
  const id = Date.now();
  AppState.rubric.questions.push({
    id,
    label: `Q${AppState.rubric.questions.length + 1}`,
    max: 10,
  });
  renderRubricConfig();
  scheduleAutosave();
});

function renderRubricConfig() {
  els.rubricList.innerHTML = "";
  AppState.rubric.questions.forEach((q, idx) => {
    const div = document.createElement("div");
    div.className = "question-item";
    div.innerHTML = `
            <span style="width:80px; font-weight:600;">${q.label}</span>
            <input type="number" value="${q.max}" style="width:50px;" oninput="updateRubricMax(${idx}, this.value)">
            <button class="btn btn-secondary" style="width:auto; padding:2px 8px; margin:0;" onclick="removeQuestion(${idx})">X</button>
        `;
    els.rubricList.appendChild(div);
  });
}

window.updateRubricMax = (idx, val) => {
  const parsed = parseInt(val);
  AppState.rubric.questions[idx].max = Number.isNaN(parsed) ? 0 : parsed;
  scheduleAutosave();
};
window.removeQuestion = (idx) => {
  AppState.rubric.questions.splice(idx, 1);
  renderRubricConfig();
  scheduleAutosave();
};

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

async function restoreSessionDocumentsFromFolder(docMetas) {
  if (!window.showDirectoryPicker || !docMetas.length) return;

  const dirHandle = await window.showDirectoryPicker();
  const existingByName = new Set(AppState.documents.map((doc) => doc.name));

  const missing = [];
  for (const docMeta of docMetas) {
    try {
      if (existingByName.has(docMeta.name)) {
        continue;
      }
      const fileHandle = await dirHandle.getFileHandle(docMeta.name);
      const pdfFile = await fileHandle.getFile();
      const arrayBuffer = await pdfFile.arrayBuffer();

      AppState.documents.push({
        id: docMeta.id,
        name: docMeta.name,
        file: pdfFile,
        arrayBuffer,
      });
    } catch (err) {
      missing.push(docMeta.name);
    }
  }

  renderDocList();
  if (AppState.documents.length > 0) {
    loadDocument(AppState.documents[0].id);
  }

  if (missing.length) {
    showToast(
      `Session loaded, but ${missing.length} PDF${missing.length > 1 ? "s" : ""} not found in folder: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}`,
      "warning",
      6000,
    );
  }
}

function rubricsEqual(a, b) {
  if (!a || !b) return false;
  if (!Array.isArray(a.questions) || !Array.isArray(b.questions)) return false;
  if (a.questions.length !== b.questions.length) return false;
  for (let i = 0; i < a.questions.length; i++) {
    const left = a.questions[i];
    const right = b.questions[i];
    if (left.id !== right.id) return false;
    if (left.label !== right.label) return false;
    if (left.max !== right.max) return false;
  }
  return true;
}

async function mergeSessionIntoState(
  session,
  options = { promptRubric: true },
) {
  const normalized = normalizeSessionData(session);

  if (options.promptRubric && session.rubric) {
    const differs = !rubricsEqual(AppState.rubric, session.rubric);
    if (differs) {
      const replace = await showConfirmModal(
        "rubric-conflict-modal",
        "rubric-conflict-btn",
        "rubric-conflict-cancel",
      );
      if (replace) {
        AppState.rubric = session.rubric;
      }
    }
  } else if (session.rubric) {
    AppState.rubric = session.rubric;
  }

  Object.entries(normalized.annotations).forEach(([docId, pages]) => {
    if (!AppState.annotations[docId]) AppState.annotations[docId] = {};
    Object.entries(pages).forEach(([pageNum, anns]) => {
      if (!AppState.annotations[docId][pageNum]) {
        AppState.annotations[docId][pageNum] = [];
      }
      AppState.annotations[docId][pageNum] = AppState.annotations[docId][
        pageNum
      ].concat(anns || []);
    });
  });

  Object.entries(normalized.scores).forEach(([docId, scores]) => {
    if (!AppState.scores[docId]) AppState.scores[docId] = {};
    Object.entries(scores || {}).forEach(([qid, val]) => {
      if (AppState.scores[docId][qid] === undefined) {
        AppState.scores[docId][qid] = val;
      }
    });
  });

  window.sessionRestoredDocs = window.sessionRestoredDocs || [];
  const existingSessionNames = new Set(
    window.sessionRestoredDocs.map((doc) => doc.name),
  );
  normalized.documents.forEach((doc) => {
    if (!existingSessionNames.has(doc.name)) {
      window.sessionRestoredDocs.push(doc);
      existingSessionNames.add(doc.name);
    }
  });

  const loadedNames = new Set(AppState.documents.map((doc) => doc.name));
  return normalized.documents.filter((doc) => !loadedNames.has(doc.name));
}

function normalizeSessionData(session) {
  const docs = (session.documents || []).map((doc) => ({ ...doc }));
  const idMap = {};

  docs.forEach((doc) => {
    const newId = doc.name;
    if (doc.id && doc.id !== newId) idMap[doc.id] = newId;
    doc.id = newId;
  });

  const remapKeys = (obj) => {
    const next = {};
    Object.keys(obj || {}).forEach((key) => {
      const mapped = idMap[key] || key;
      next[mapped] = obj[key];
    });
    return next;
  };

  return {
    documents: docs,
    annotations: remapKeys(session.annotations || {}),
    scores: remapKeys(session.scores || {}),
  };
}

async function applySession(session, options = { allowFolderPicker: false }) {
  const normalized = normalizeSessionData(session);
  AppState.rubric = session.rubric;
  AppState.annotations = normalized.annotations;
  AppState.scores = normalized.scores;

  const oldDocs = normalized.documents;
  window.sessionRestoredDocs = oldDocs;

  AppState.pendingRestoreDocs = oldDocs;
  if (oldDocs.length && els.restoreModal) {
    els.restoreModal.classList.remove("hidden");
  }

  if (
    options.allowFolderPicker &&
    window.showDirectoryPicker &&
    oldDocs.length
  ) {
    try {
      await restoreSessionDocumentsFromFolder(oldDocs);
      AppState.pendingRestoreDocs = null;
      if (els.restoreModal) {
        els.restoreModal.classList.add("hidden");
      }
    } catch (err) {
      showToast(
        "Folder selection canceled. Use the Restore PDFs button to try again.",
        "info",
      );
    }
  } else if (oldDocs.length) {
    // Modal is visible and prompts for folder selection.
  } else {
    showToast(
      "Session loaded. Please re-open the PDF files to continue working.",
      "info",
      5000,
    );
  }

  renderRubricInputs();
  scheduleAutosave();
}

function prepareHebrewForPdf(text) {
  // Convert logical-order Hebrew to visual order, but keep LTR runs readable.
  return (text || "")
    .split("\n")
    .map((line) => fixHebrewVisual(line))
    .join("\n");
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function drawMixedText(page, text, options) {
  const {
    x,
    y,
    size,
    color,
    hebrewFont,
    latinFont,
    lineHeight = 1.2,
  } = options;

  const lines = (text || "").split("\n");
  lines.forEach((line, index) => {
    const lineY = y - index * size * lineHeight;
    const hasHebrew = /[\u0590-\u05FF]/.test(line);

    if (!hasHebrew) {
      page.drawText(line, {
        x,
        y: lineY,
        size,
        font: latinFont,
        color,
      });
      return;
    }

    const visualLine = fixHebrewVisual(line);
    const runs = visualLine.match(/[\u0590-\u05FF]+|[^\u0590-\u05FF]+/g) || [];
    let cursorX = x;
    if (hasHebrew) {
      const totalWidth = runs.reduce((sum, run) => {
        const runFont = /[\u0590-\u05FF]/.test(run) ? hebrewFont : latinFont;
        return sum + runFont.widthOfTextAtSize(run, size);
      }, 0);
      cursorX = x - totalWidth;
    }

    runs.forEach((run) => {
      const runFont = /[\u0590-\u05FF]/.test(run) ? hebrewFont : latinFont;
      page.drawText(run, {
        x: cursorX,
        y: lineY,
        size,
        font: runFont,
        color,
      });
      cursorX += runFont.widthOfTextAtSize(run, size);
    });
  });
}

async function loadExportFonts(pdfDoc) {
  pdfDoc.registerFontkit(window.fontkit);

  const fontUrl = "./NotoSans-Regular.ttf";
  let fontBytes = null;
  if (window.HEBREW_FONT_BASE64) {
    fontBytes = base64ToUint8Array(window.HEBREW_FONT_BASE64);
  } else {
    const response = await fetch(fontUrl);
    if (!response.ok) throw new Error("Font fetch failed");
    fontBytes = await response.arrayBuffer();
  }

  const hebrewFont = await pdfDoc.embedFont(fontBytes, { subset: false });
  const latinFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  return { hebrewFont, latinFont };
}

async function buildGradedPdfBytes(docStruct) {
  const { PDFDocument, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.load(docStruct.arrayBuffer.slice(0));

  const { hebrewFont, latinFont } = await loadExportFonts(pdfDoc);

  const pages = pdfDoc.getPages();
  const docAnns = AppState.annotations[docStruct.id] || {};

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { height } = page.getSize();
    const anns = docAnns[i + 1] || [];

    anns.forEach((a) => {
      if (a.type === "path") {
        for (let k = 0; k < a.points.length - 1; k++) {
          page.drawLine({
            start: {
              x: a.points[k].x,
              y: height - a.points[k].y,
            },
            end: {
              x: a.points[k + 1].x,
              y: height - a.points[k + 1].y,
            },
            thickness: a.width,
            color: rgb(
              parseInt(a.color.slice(1, 3), 16) / 255,
              parseInt(a.color.slice(3, 5), 16) / 255,
              parseInt(a.color.slice(5, 7), 16) / 255,
            ),
          });
        }
      } else if (a.type === "text") {
        drawMixedText(page, a.text, {
          x: a.x,
          y: height - a.y - a.size,
          size: a.size,
          hebrewFont,
          latinFont,
          color: rgb(
            parseInt(a.color.slice(1, 3), 16) / 255,
            parseInt(a.color.slice(3, 5), 16) / 255,
            parseInt(a.color.slice(5, 7), 16) / 255,
          ),
        });
      }
    });
  }

  return pdfDoc.save();
}

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

document.getElementById("finalize-btn").addEventListener("click", async () => {
  if (!AppState.currentDocId) return;

  if (!window.fontkit) {
    showToast(
      "Error: Font library not loaded. Please refresh the page.",
      "error",
    );
    return;
  }

  const btn = document.getElementById("finalize-btn");
  const originalText = btn.textContent;
  btn.textContent = "⏳ Processing...";
  btn.disabled = true;

  try {
    const docStruct = AppState.documents.find(
      (d) => d.id === AppState.currentDocId,
    );
    if (!docStruct) throw new Error("Document not found");

    const pdfBytes = await buildGradedPdfBytes(docStruct);

    const blob = new Blob([pdfBytes], {
      type: "application/pdf",
    });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `graded_${docStruct.name}`;
    link.click();
  } catch (e) {
    console.error(e);
    showToast("Error generating PDF: " + e.message, "error", 6000);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
});

document
  .getElementById("finalize-all-btn")
  .addEventListener("click", async () => {
    if (!AppState.documents.length) return;

    if (!window.fontkit) {
      showToast(
        "Error: Font library not loaded. Please refresh the page.",
        "error",
      );
      return;
    }

    const btn = document.getElementById("finalize-all-btn");
    const originalText = btn.textContent;
    btn.textContent = "⏳ Saving...";
    btn.disabled = true;

    try {
      if (window.showDirectoryPicker) {
        const dirHandle = await window.showDirectoryPicker();
        for (const doc of AppState.documents) {
          const pdfBytes = await buildGradedPdfBytes(doc);
          const fileName = `graded_${doc.name}`;
          const fileHandle = await dirHandle.getFileHandle(fileName, {
            create: true,
          });
          const writable = await fileHandle.createWritable();
          await writable.write(
            new Blob([pdfBytes], { type: "application/pdf" }),
          );
          await writable.close();
        }
      } else {
        for (const doc of AppState.documents) {
          const pdfBytes = await buildGradedPdfBytes(doc);
          const blob = new Blob([pdfBytes], { type: "application/pdf" });
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = `graded_${doc.name}`;
          link.click();
        }
      }
    } catch (e) {
      console.error(e);
      showToast("Error exporting PDFs: " + e.message, "error", 6000);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

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

function fixHebrewVisual(text) {
  if (!text) return "";

  // Check if contains Hebrew
  const hasHebrew = /[\u0590-\u05FF]/.test(text);
  if (!hasHebrew) return text; // No need to process pure English

  const tokenRegex =
    /\d+(?:[.,:/\-]\d+)+|[\u0590-\u05FF]+|[A-Za-z0-9]+|\s+|[^\u0590-\u05FFA-Za-z0-9\s]+/g;
  const tokens = text.match(tokenRegex) || [text];

  const bracketMap = {
    "(": ")",
    ")": "(",
    "[": "]",
    "]": "[",
    "{": "}",
    "}": "{",
  };

  return tokens
    .reverse()
    .map((token) =>
      Array.from(token)
        .map((char) => bracketMap[char] || char)
        .join(""),
    )
    .join("");
}
