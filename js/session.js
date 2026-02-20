const AUTOSAVE_KEY = "grader_autosave_v1";
let autosaveTimer = null;

function buildSessionSnapshot() {
    // Fall back to pendingRestoreDocs when PDFs haven't been re-loaded yet,
    // so we don't overwrite the saved document list with [].
    const docs = AppState.documents.length > 0
        ? AppState.documents.map((d) => ({ id: d.id, name: d.name }))
        : (AppState.pendingRestoreDocs || []).map((d) => ({ id: d.id, name: d.name }));

    return {
        version: "1.0",
        rubric: AppState.rubric,
        documents: docs,
        annotations: AppState.annotations,
        scores: AppState.scores,
        autosavedAt: new Date().toISOString(),
        annotationBank: AppState.annotationBank, // Save annotation bank
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

function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosaveSession, 300);
}

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
        annotationBank: Array.isArray(session.annotationBank) ? session.annotationBank : [],
    };
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

    // Handle Annotation Bank Merge
    if (normalized.annotationBank && normalized.annotationBank.length > 0) {
        const shouldMerge = await showConfirmModal(
            "bank-merge-modal",
            "bank-merge-confirm-btn",
            "bank-merge-cancel-btn"
        );
        if (shouldMerge) {
            const existingBank = new Set(AppState.annotationBank);
            normalized.annotationBank.forEach(text => {
                if (!existingBank.has(text)) {
                    AppState.annotationBank.push(text);
                }
            });
            renderAnnotationBank();
        }
    }



    Object.entries(normalized.annotations).forEach(([docId, pages]) => {
        if (!AppState.annotations[docId]) AppState.annotations[docId] = {};
        Object.entries(pages).forEach(([pageNum, newAnns]) => {
            if (!AppState.annotations[docId][pageNum]) {
                AppState.annotations[docId][pageNum] = [];
            }

            const existingAnns = AppState.annotations[docId][pageNum];
            (newAnns || []).forEach(newAnn => {
                // Check if identical annotation exists
                const isDuplicate = existingAnns.some(existing => areAnnotationsEqual(existing, newAnn));
                if (!isDuplicate) {
                    existingAnns.push(newAnn);
                }
            });
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

async function applySession(session, options = { allowFolderPicker: false }) {
    const normalized = normalizeSessionData(session);
    AppState.rubric = session.rubric;
    AppState.annotations = normalized.annotations;
    AppState.scores = normalized.scores;
    AppState.annotationBank = normalized.annotationBank; // Load annotation bank
    renderAnnotationBank();

    const existingNames = new Set(AppState.documents.map((d) => d.name));
    const missingDocs = normalized.documents.filter(
        (d) => !existingNames.has(d.name),
    );
    window.sessionRestoredDocs = normalized.documents;

    AppState.pendingRestoreDocs = missingDocs;
    if (missingDocs.length && els.restoreModal) {
        els.restoreModal.classList.remove("hidden");
    } else if (els.restoreModal) {
        els.restoreModal.classList.add("hidden");
    }

    if (
        options.allowFolderPicker &&
        window.showDirectoryPicker &&
        missingDocs.length
    ) {
        try {
            await restoreSessionDocumentsFromFolder(missingDocs);
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
    } else if (missingDocs.length) {
        // Modal is visible and prompts for folder selection.
    } else {
        showToast("Session loaded successfully.", "success", 3000);
    }

    renderRubricInputs();
    scheduleAutosave();
}
