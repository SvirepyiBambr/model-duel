// Model Duel — two Pollinations text models play Connect Four; every move is an API call.
const API = "https://gen.pollinations.ai";
const COLS = 7, ROWS = 6;
const MODELS = [
    { id: "openai/gpt-5.4-nano", label: "GPT-5.4 nano" },
    { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
    { id: "x-ai/grok-4.6", label: "Grok 4.6" },
    { id: "mistralai/mistral-large-3", label: "Mistral Large 3" },
    { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
    { id: "openai/gpt-5.4-mini", label: "GPT-5.4 mini" },
    { id: "nvidia/nemotron-3.5-lightning", label: "Nemotron 3.5 Lightning" },
    { id: "minimax/minimax-m3.1-flash", label: "MiniMax M3.1 Flash" },
];
const $ = (id) => document.getElementById(id);
const keyEl = $("key"), selX = $("modelX"), selO = $("modelO");
keyEl.value = localStorage.getItem("polli_key") || "";
keyEl.addEventListener("change", () => localStorage.setItem("polli_key", keyEl.value.trim()));

for (const m of MODELS) {
    for (const sel of [selX, selO]) {
        const o = document.createElement("option");
        o.value = m.id; o.textContent = m.label;
        sel.appendChild(o);
    }
}
selX.value = MODELS[0].id;
selO.value = MODELS[1].id;

// ---- referee ----
function emptyBoard() { return Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }
function render(g) {
    const board = $("board"); board.innerHTML = "";
    const win = new Set((g.line || []).map(([r, c]) => r + ":" + c));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const v = g.board[r][c];
        const cell = document.createElement("div");
        cell.className = "cell" + (v ? " " + v : "") + (win.has(r + ":" + c) ? " win" : "");
        board.appendChild(cell);
    }
}
function boardText(board) {
    const head = "    " + [...Array(COLS).keys()].join("   ");
    const rows = board.map((row, i) => `${i} | ` + row.map((c) => c ? (c === "red" ? "R" : "Y") : ".").join("  ")).join("\n");
    return head + "\n" + rows + "\nColumns: 0..6. R = red, Y = yellow.";
}
function drop(board, col, mark) {
    for (let r = ROWS - 1; r >= 0; r--) if (!board[r][col]) { board[r][col] = mark; return r; }
    return -1;
}
function winLine(board, mark) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (board[r][c] !== mark) continue;
        for (const [dr, dc] of dirs) {
            const line = [[r, c]];
            for (let k = 1; k < 4; k++) {
                const rr = r + dr * k, cc = c + dc * k;
                if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || board[rr][cc] !== mark) break;
                line.push([rr, cc]);
            }
            if (line.length === 4) return line;
        }
    }
    return null;
}

// ---- model call ----
async function askMove(model, board, mark, name) {
    const sys = "You are playing Connect Four. " + boardText(board) +
        `\nYou are ${mark === "red" ? "RED (R)" : "YELLOW (Y)"}. Choose the best column 0-6.`;
    const res = await fetch(API + "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + keyEl.value.trim() },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: 'Reply with STRICT JSON only: {"column": <0-6>, "comment": "<one short line, max 15 words>"}. No markdown.' },
                { role: "user", content: sys },
            ],
            temperature: 0.7,
            max_tokens: 120,
        }),
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    let col = null, comment = "";
    try {
        const o = JSON.parse(cleaned);
        col = Number(o.column);
        comment = String(o.comment || "");
    } catch {
        const m = cleaned.match(/\b([0-6])\b/);
        col = m ? Number(m[1]) : null;
        comment = cleaned.replace(/\s+/g, " ").slice(0, 80);
    }
    return { col, comment };
}

// ---- game loop ----
let running = false;
function log(html) {
    const li = document.createElement("li");
    li.innerHTML = html;
    $("log").appendChild(li);
    li.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function setStatus(x, o, turn) {
    $("pxStatus").textContent = x; $("poStatus").textContent = o;
    $("turn").textContent = turn || "";
}
function showError(text) { $("error").textContent = text; $("error").hidden = false; }

async function play() {
    const key = keyEl.value.trim();
    $("error").hidden = true;
    if (!key) return showError("Paste your Pollinations key (sk_...) — models play on your own Pollen.");
    if (running) return;
    running = true;
    $("start").disabled = true;
    $("start").innerHTML = '<span class="spin"></span>Duel in progress…';
    $("again").hidden = true;
    $("verdict").textContent = "";
    $("log").innerHTML = "";
    $("arena").hidden = false;

    const names = { red: selX.selectedOptions[0].textContent, yellow: selO.selectedOptions[0].textContent };
    $("pxName").textContent = names.red;
    $("poName").textContent = names.yellow;

    const g = { board: emptyBoard(), line: null };
    render(g);
    let mark = "red";
    let moves = 0;

    try {
        while (moves < COLS * ROWS) {
            const model = mark === "red" ? selX.value : selO.value;
            setStatus(mark === "red" ? "thinking…" : "", mark === "yellow" ? "thinking…" : "",
                `${names[mark]} (${mark === "red" ? "R" : "Y"}) to move`);
            let move = await askMove(model, g.board, mark, names[mark]);
            if (!Number.isInteger(move.col) || move.col < 0 || move.col > 6 || g.board[0][move.col]) {
                log(`<span class="who ${mark}">${names[mark]}</span><span class="bad">illegal pick: ${JSON.stringify(move.col)} — re-asking</span>`);
                move = await askMove(model, g.board, mark, names[mark]);
                if (!Number.isInteger(move.col) || move.col < 0 || move.col > 6 || g.board[0][move.col]) {
                    // referee fallback: first legal column
                    move.col = g.board[0].findIndex((v) => !v);
                    move.comment = "referee fallback";
                }
            }
            const row = drop(g.board, move.col, mark);
            moves++;
            render(g);
            const cell = $("board").children[row * COLS + move.col];
            cell.classList.add("drop");
            log(`<span class="who ${mark}">${names[mark]}</span>drops in <span class="col">column ${move.col}</span>
                <span class="why">${move.comment ? "— " + escapeHtml(move.comment) : ""}</span>`);
            setStatus("", "", "");

            const line = winLine(g.board, mark);
            if (line) {
                g.line = line;
                render(g);
                $("verdict").textContent = `${names[mark]} wins!`;
                $("verdict").className = "verdict " + mark;
                setStatus(mark === "red" ? "WINNER" : "", mark === "yellow" ? "WINNER" : "", "game over");
                break;
            }
            if (moves === COLS * ROWS) {
                $("verdict").textContent = "Draw.";
                $("verdict").className = "verdict";
                setStatus("draw", "draw", "game over");
                break;
            }
            mark = mark === "red" ? "yellow" : "red";
            await new Promise((r) => setTimeout(r, 450));
        }
    } catch (e) {
        showError("Duel stopped: " + e.message);
    } finally {
        running = false;
        $("start").disabled = false;
        $("start").textContent = "Start the duel";
        $("again").hidden = false;
    }
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

$("start").addEventListener("click", play);
$("again").addEventListener("click", play);
