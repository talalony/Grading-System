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
            // Only check for annotation hit on left-click
            if (e.button === 0) {
                const hit = findAnnotationAt(pos.x, pos.y, pNum);
                if (hit) {
                    // Start Moving
                    AppState.isDraggingAnnotation = true;
                    AppState.selectedAnnotation = hit;
                    AppState.dragStart = { x: pos.x, y: pos.y };
                    AppState.dragOrigin = { x: pos.x, y: pos.y };
                    AppState.dragMoved = false;
                    AppState.dragUndoSaved = false;
                    els.viewerContainer.style.cursor = "move";
                    return;
                }
            }

            // Start Panning (both left and right click, or when no hit)
            AppState.isPanning = true;
            AppState.panStart = { x: e.clientX, y: e.clientY };
            AppState.scrollStart = {
                x: els.viewerContainer.scrollLeft,
                y: els.viewerContainer.scrollTop,
            };
            els.viewerContainer.style.cursor = "grabbing";
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
    sizeInput.value = Math.round(annotation?.size || AppState.defaultTextSize);
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
