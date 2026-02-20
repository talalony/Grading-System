function renderRubricInputs() {
    const container = els.questionsContainer;
    container.innerHTML = "";

    // Check if a PDF is loaded
    if (!AppState.currentDocId) {
        container.innerHTML = '<div style="padding: 1rem; text-align: center; color: #64748b;"><span class="material-icons" style="font-size: 3rem; opacity: 0.5;">picture_as_pdf</span><p style="margin-top: 0.5rem;">Load a PDF to start grading</p></div>';
        return;
    }

    let totalMax = 0;

    const currentScores = AppState.scores[AppState.currentDocId] || {};

    AppState.rubric.questions.forEach((q, idx) => {
        totalMax += parseInt(q.max);
        const row = document.createElement("div");
        row.className = "question-item";

        const label = document.createElement("label");
        label.className = "question-label";
        label.textContent = q.label;

        const wrapper = document.createElement("div");
        wrapper.className = "score-input-wrapper";

        const input = document.createElement("input");
        input.type = "number";
        input.className = "score-input";
        input.placeholder = "Score";
        input.min = "0";
        input.max = q.max.toString();
        input.dataset.qid = q.id;
        input.tabIndex = idx + 1;
        input.value =
            currentScores[q.id] !== undefined ? currentScores[q.id] : "";

        const maxSpan = document.createElement("span");
        maxSpan.className = "score-max";
        maxSpan.textContent = `/${q.max}`;

        wrapper.appendChild(input);
        wrapper.appendChild(maxSpan);
        row.appendChild(label);
        row.appendChild(wrapper);
        container.appendChild(row);
    });

    els.maxTotalScore.textContent = totalMax;
    updateTotal();

    // Add total score row
    const totalRow = document.createElement("div");
    totalRow.className = "total-score-row";

    const totalLabel = document.createElement("span");
    totalLabel.className = "total-score-label";
    totalLabel.textContent = "Total";

    const totalValue = document.createElement("span");
    totalValue.className = "total-score-value";
    totalValue.id = "total-score-display-inline";

    totalRow.appendChild(totalLabel);
    totalRow.appendChild(totalValue);
    container.appendChild(totalRow);
    updateTotal(); // Call again to update the inline display

    container.querySelectorAll("input").forEach((inp) => {
        inp.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            const qid = e.target.dataset.qid;
            // Validate
            const q = AppState.rubric.questions.find((x) => x.id == qid);
            if (val > q.max) e.target.style.borderColor = "red";
            else e.target.style.borderColor = "";

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

function renderRubricConfig() {
    els.rubricList.innerHTML = "";
    AppState.rubric.questions.forEach((q, idx) => {
        // Ensure questions are numbered sequentially from 1
        const questionNum = idx + 1;
        q.label = `Q${questionNum}`;

        const div = document.createElement("div");
        div.className = "question-item";
        div.innerHTML = `
            <span style="width:80px; font-weight:600;">${q.label}</span>
            <span style="margin-right: 8px;">Max Points:</span>
            <input type="number" value="${q.max}" style="width:60px;" oninput="updateRubricMax(${idx}, this.value)" min="0">
        `;
        els.rubricList.appendChild(div);
    });
}

window.updateRubricMax = (idx, val) => {
    const parsed = parseInt(val);
    AppState.rubric.questions[idx].max = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
    scheduleAutosave();
};
