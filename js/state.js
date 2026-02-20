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

    // Export Grade Summary Placement
    pendingExportMode: null, // 'single' or 'all'
};

// Utils
const generateId = () => Math.random().toString(36).substr(2, 9);
const TEXT_LINE_HEIGHT = 1.2;

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
