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
        const pageInfo = document.getElementById("page-info");
        if (pageInfo) {
            pageInfo.textContent = `Page ${pageNum} / ${pdfDoc.numPages}`;
        }
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
    const pageInfo = document.getElementById("page-info");
    if (pageInfo) {
        pageInfo.textContent = `Page ${num} / ${pdfDoc.numPages}`;
    }
}

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
