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
  isDrawing: false,
  currentPath: null, // for temp drawing

  // Panning state
  isPanning: false,
  panStart: { x: 0, y: 0 },
  scrollStart: { x: 0, y: 0 },

  // History for Undo/Redo
  history: {},

  pendingRestoreDocs: null,
};

// Utils
const generateId = () => Math.random().toString(36).substr(2, 9);

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

  const autosavedRaw = localStorage.getItem(AUTOSAVE_KEY);
  if (autosavedRaw) {
    try {
      const autosaved = JSON.parse(autosavedRaw);
      if (autosaved.autosavedAt) {
        updateAutosaveStatus(autosaved.autosavedAt);
      }
      const shouldRestore = confirm("Autosaved session found. Restore it now?");
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

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
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
        alert("Folder selection was canceled.");
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
  const files = Array.from(e.target.files);
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
      id: existingDocId || generateId(),
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
        saveStateForUndo(AppState.currentDocId, pNum);
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
  canvas.addEventListener("dblclick", (e) => {
    if (!AppState.currentDocId) return;
    if (AppState.currentTool !== "cursor") return;

    const pos = getPos(e);
    const hit = findAnnotationAt(pos.x, pos.y, pNum);

    if (hit && hit.type === "text") {
      // Edit the text annotation
      editTextAnnotation(e.clientX, e.clientY, hit, pNum, canvas);
    }
  });

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

  canvas.addEventListener("mouseup", () => {
    if (AppState.isDraggingAnnotation) {
      AppState.isDraggingAnnotation = false;
      AppState.selectedAnnotation = null;
      els.viewerContainer.style.cursor = "grab";
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
      const tx = a.x * scale;
      const ty = a.y * scale;
      const fontSize = a.size * scale;
      const width = a.text.length * fontSize * 0.6;
      const height = fontSize * 1.2;
      const isHebrew = /[\u0590-\u05FF]/.test(a.text);
      const left = isHebrew ? tx - width : tx;
      const right = isHebrew ? tx : tx + width;

      if (x >= left && x <= right && y >= ty && y <= ty + height) {
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
      const tx = a.x * scale;
      const ty = a.y * scale;
      const fontSize = a.size * scale;
      const width = a.text.length * fontSize * 0.6;
      const height = fontSize * 1.2;
      const isHebrew = /[\u0590-\u05FF]/.test(a.text);
      const left = isHebrew ? tx - width : tx;
      const right = isHebrew ? tx : tx + width;

      if (x >= left && x <= right && y >= ty && y <= ty + height) {
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

function createTextInput(screenX, screenY, canvasX, canvasY, pNum, canvas) {
  const input = document.createElement("textarea");
  input.className = "text-input-overlay";
  input.style.position = "fixed";
  input.style.left = screenX + "px";
  input.style.top = screenY + "px";
  input.dir = "auto";

  document.body.appendChild(input);

  setTimeout(() => input.focus(), 10);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      input.blur();
    }
  });

  input.addEventListener("blur", () => {
    const text = input.value.trim();
    if (text) {
      saveStateForUndo(AppState.currentDocId, pNum);
      saveAnnotation(pNum, {
        type: "text",
        text: text,
        x: canvasX,
        y: canvasY,
        color: AppState.penColor,
        size: 14 * AppState.scale,
      });
      drawAnnotations(canvas, pNum);
      scheduleAutosave();
    }
    document.body.removeChild(input);

    AppState.currentTool = "cursor";
    document
      .querySelectorAll(".tool-btn[data-tool]")
      .forEach((b) => b.classList.remove("active"));
    const cursorBtn = document.querySelector('.tool-btn[data-tool="cursor"]');
    if (cursorBtn) cursorBtn.classList.add("active");
    els.viewerContainer.style.cursor = "grab";
  });
}

function editTextAnnotation(screenX, screenY, annotation, pNum, canvas) {
  const input = document.createElement("textarea");
  input.className = "text-input-overlay";
  input.style.position = "fixed";
  input.style.left = screenX + "px";
  input.style.top = screenY + "px";
  input.dir = "auto";
  input.value = annotation.text; // Pre-fill with existing text

  document.body.appendChild(input);

  setTimeout(() => {
    input.focus();
    input.select(); // Select all text for easy editing
  }, 10);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      input.blur();
    }
  });

  input.addEventListener("blur", () => {
    const text = input.value.trim();
    if (text) {
      saveStateForUndo(AppState.currentDocId, pNum);
      // Update the existing annotation
      annotation.text = text;
      drawAnnotations(canvas, pNum);
      scheduleAutosave();
    }
    document.body.removeChild(input);
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
      ctx.font = `${a.size * scale}px Arial`;
      ctx.fillStyle = a.color;
      if (/[\u0590-\u05FF]/.test(a.text)) {
        ctx.direction = "rtl";
        ctx.textAlign = "start";
      } else {
        ctx.direction = "ltr";
        ctx.textAlign = "start";
      }
      ctx.fillText(a.text, a.x * scale, a.y * scale + a.size * scale);
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
  AppState.documents = [];

  const missing = [];
  for (const docMeta of docMetas) {
    try {
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
    alert(
      "Session loaded, but some PDFs were not found in the selected folder:\n" +
        missing.join("\n"),
    );
  }
}

async function applySession(session, options = { allowFolderPicker: false }) {
  AppState.rubric = session.rubric;
  AppState.annotations = session.annotations;
  AppState.scores = session.scores;

  const oldDocs = session.documents || [];
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
      alert(
        "Folder selection was canceled. You can select the folder from the Restore PDFs prompt.",
      );
    }
  } else if (oldDocs.length) {
    // Modal is visible and prompts for folder selection.
  } else {
    alert("Session loaded. Please re-open the PDF files to continue working.");
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
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const session = JSON.parse(text);
    await applySession(session, { allowFolderPicker: true });
  });

document.getElementById("finalize-btn").addEventListener("click", async () => {
  if (!AppState.currentDocId) return;

  if (!window.fontkit) {
    alert("Error: fontkit is not loaded.");
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
    alert("Error generating PDF: " + e.message);
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
      alert("Error: fontkit is not loaded.");
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
      alert("Error exporting PDFs: " + e.message);
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

  const bracketMap = {
    "(": ")",
    ")": "(",
    "[": "]",
    "]": "[",
    "{": "}",
    "}": "{",
  };

  const runs = text.match(/[\u0590-\u05FF]+|[^\u0590-\u05FF]+/g) || [];
  return runs
    .map((run) => {
      if (!/[\u0590-\u05FF]/.test(run)) return run.split("").reverse().join(""); // Reverse English runs
      const reversed = [...run].reverse().join("");
      let res = "";
      for (const char of reversed) {
        res += bracketMap[char] || char;
      }
      return res;
    })
    .join("")
    .split("")
    .reverse()
    .join("");
}
