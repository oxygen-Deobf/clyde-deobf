"use strict";

function hasBreakOutside(stmts) {
    for (const st of stmts) {
        if (!st) continue;
        if (st.t === "break") return true;
        if (st.t === "while" || st.t === "repeat" || st.t === "fornum" || st.t === "forgen") continue;
        if (st.t === "if") {
            if (hasBreakOutside(st.thenBody || [])) return true;
            for (const el of st.elifs || []) if (hasBreakOutside(el.body || [])) return true;
            if (st.elseBody && hasBreakOutside(st.elseBody)) return true;
        } else if (Array.isArray(st.body)) {
            if (hasBreakOutside(st.body)) return true;
        }
    }
    return false;
}

function scanExpr(e) {
    if (!e || typeof e !== "object") return false;
    if (e.t === "call" || e.t === "methodcall") return false;
    if (e.t === "function") {
        const found = { v: false };
        (function walk(n) {
            if (!n || typeof n !== "object" || found.v) return;
            if (n.t === "break") { found.v = true; return; }
            for (const k of Object.keys(n)) {
                if (k === "line") continue;
                const v = n[k];
                if (Array.isArray(v)) v.forEach(walk);
                else if (v && typeof v === "object") walk(v);
            }
        })(e.body);
        return found.v;
    }
    for (const k of Object.keys(e)) {
        if (k === "line") continue;
        const v = e[k];
        if (Array.isArray(v)) { for (const item of v) if (scanExpr(item)) return true; }
        else if (v && typeof v === "object") { if (scanExpr(v)) return true; }
    }
    return false;
}

function isTrueCond(e) { return e && e.t === "bool" && e.v === true; }

function reshapeBlock(stmts, stats) {
    for (let i = 0; i < stmts.length; i++) {
        const st = stmts[i];
        reshapeStatement(st, stats);
    }
    for (let i = stmts.length - 1; i >= 0; i--) {
        if (stmts[i].t === "do" && stmts[i].body.length === 0) {
            stmts.splice(i, 1);
            stats.blocksDropped++;
        }
    }
}

function reshapeStatement(st, stats) {
    if (!st || typeof st !== "object") return;
    switch (st.t) {
        case "while": {
            reshapeBlock(st.body, stats);
            if (isTrueCond(st.cond) && st.body.length > 0) {
                const last = st.body[st.body.length - 1];
                if (last && last.t === "if" && last.elifs.length === 0 && last.elseBody === null &&
                    last.thenBody.length === 1 && last.thenBody[0].t === "break" &&
                    !hasBreakOutside(st.body.slice(0, -1))) {
                    st.body.pop();
                    st.t = "repeat";
                    st.cond = last.cond;
                    stats.loopsReshaped++;
                }
            }
            break;
        }
        case "repeat":
            reshapeBlock(st.body, stats);
            break;
        case "if": {
            reshapeBlock(st.thenBody, stats);
            for (const el of st.elifs) reshapeBlock(el.body, stats);
            if (st.elseBody) reshapeBlock(st.elseBody, stats);
            if (st.thenBody.length === 0 && st.elseBody && st.elifs.length === 0) {
                st.cond = { t: "unop", op: "not", e: st.cond };
                const tmp = st.thenBody;
                st.thenBody = st.elseBody;
                st.elseBody = tmp.length === 0 ? null : tmp;
                stats.branchesInverted++;
            }
            break;
        }
        case "fornum":
        case "forgen":
        case "do":
            reshapeBlock(st.body, stats);
            break;
        case "localfunc":
        case "funcstat":
            reshapeBlock(st.body.body, stats);
            break;
        default:
            break;
    }
}

function reshapeFlow(chunk, stats) {
    reshapeBlock(chunk.body, stats);
    return chunk;
}

module.exports = { reshapeFlow };
