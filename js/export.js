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
