
"use strict";

const PREC = {
    "or": 1, "and": 2, "<": 3, ">": 3, "<=": 3, ">=": 3, "~=": 3, "==": 3,
    "|": 4, "~": 5, "&": 6, "<<": 7, ">>": 7, "..": 8, "+": 9, "-": 9,
    "*": 10, "/": 10, "//": 10, "%": 10, "^": 12
};
const RIGHT = new Set(["^", ".."]);
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function wrap(s, own, ctx) { return own < ctx ? "(" + s + ")" : s; }

function escStr(s) {
    let out = '"';
    for (const ch of s) {
        const c = ch.codePointAt(0);
        if (ch === '"') out += '\\"';
        else if (ch === "\\") out += "\\\\";
        else if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else if (c < 32 || c === 127) out += "\\" + String(c).padStart(3, "0");
        else out += ch;
    }
    return out + '"';
}

function numStr(v, raw) {
    if (raw && raw.indexOf("_") === -1 && !Number.isNaN(Number(raw)) && Number(raw) === v) return raw;
    return String(v);
}

function paramsStr(fn) {
    const ps = fn.params.slice();
    if (fn.vararg) ps.push("...");
    return "(" + ps.join(", ") + ")";
}

function targetStr(e) {
    if (e.t === "var") return e.name;
    if (e.t === "index") {
        const base = targetStr(e.obj);
        if (e.key.t === "str" && IDENT_RE.test(e.key.v)) return base + "." + e.key.v;
        return base + "[" + paintExpr(e.key, 0) + "]";
    }
    return paintExpr(e, 100);
}

function paintExpr(e, ctx) {
    ctx = ctx || 0;
    switch (e.t) {
        case "num": return wrap(numStr(e.v, e.raw), 100, ctx);
        case "str": return wrap(escStr(e.v), 100, ctx);
        case "istring": return wrap("`" + e.v + "`", 100, ctx);
        case "bool": return wrap(e.v ? "true" : "false", 100, ctx);
        case "nil": return wrap("nil", 100, ctx);
        case "var": return wrap(e.name, 100, ctx);
        case "vararg": return wrap("...", 100, ctx);
        case "paren": return wrap("(" + paintExpr(e.e, 0) + ")", 100, ctx);
        case "unop": {
            const s = (e.op === "not" ? "not " : e.op) + paintExpr(e.e, 12);
            return wrap(s, 11, ctx);
        }
        case "binop": {
            const p = PREC[e.op];
            const sep = e.op === "^" ? "" : " ";
            const s = paintExpr(e.l, p) + sep + e.op + sep + paintExpr(e.r, RIGHT.has(e.op) ? p - 1 : p + 1);
            return wrap(s, p, ctx);
        }
        case "index": {
            let s = paintExpr(e.obj, 100);
            if (e.key.t === "str" && IDENT_RE.test(e.key.v)) s += "." + e.key.v;
            else s += "[" + paintExpr(e.key, 0) + "]";
            return wrap(s, 100, ctx);
        }
        case "call":
            return wrap(paintExpr(e.fn, 100) + "(" + e.args.map(a => paintExpr(a, 0)).join(", ") + ")", 100, ctx);
        case "methodcall":
            return wrap(paintExpr(e.obj, 100) + ":" + e.name + "(" + e.args.map(a => paintExpr(a, 0)).join(", ") + ")", 100, ctx);
        case "table": {
            if (e.items.length === 0) return wrap("{}", 100, ctx);
            const parts = e.items.map(it => {
                if (it.key === null) return paintExpr(it.value, 0);
                if (it.key.t === "str" && IDENT_RE.test(it.key.v)) return it.key.v + " = " + paintExpr(it.value, 0);
                return "[" + paintExpr(it.key, 0) + "] = " + paintExpr(it.value, 0);
            });
            return wrap("{ " + parts.join(", ") + " }", 100, ctx);
        }
        case "function":
            return wrap("function" + paramsStr(e) + " end", 100, ctx);
        case "ifelse":
            return wrap("if " + paintExpr(e.cond, 0) + " then " + paintExpr(e.a, 0) + " else " + paintExpr(e.b, 0), 100, ctx);
        default:
            return wrap("nil", 100, ctx);
    }
}

function fnStr(fn, level, header) {
    const ind = "    ".repeat(level);
    const lines = [header + paramsStr(fn)];
    paintBlock(fn.body, level + 1, lines);
    lines.push(ind + "end");
    return lines.join("\n");
}

function paintStatement(st, level, lines) {
    const ind = "    ".repeat(level);
    switch (st.t) {
        case "local": {
            let s = ind + "local " + st.names.join(", ");
            if (st.values.length > 0) s += " = " + st.values.map(v => paintExpr(v, 0)).join(", ");
            lines.push(s);
            break;
        }
        case "localfunc":
            if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
            lines.push(fnStr(st.body, level, ind + "local function " + st.name));
            break;
        case "funcstat": {
            if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
            let target = targetStr(st.target);
            if (st.body.methodSelf) target += ":" + st.body.methodSelf;
            lines.push(fnStr(st.body, level, ind + "function " + target));
            break;
        }
        case "assign":
            lines.push(ind + st.targets.map(tg => paintExpr(tg, 0)).join(", ") + " " + st.op + " " + st.values.map(v => paintExpr(v, 0)).join(", "));
            break;
        case "exprstat":
            lines.push(ind + paintExpr(st.expr, 0));
            break;
        case "return":
            lines.push(ind + "return" + (st.values.length > 0 ? " " + st.values.map(v => paintExpr(v, 0)).join(", ") : ""));
            break;
        case "if":
            lines.push(ind + "if " + paintExpr(st.cond, 0) + " then");
            paintBlock(st.thenBody, level + 1, lines);
            for (const el of st.elifs) {
                lines.push(ind + "elseif " + paintExpr(el.cond, 0) + " then");
                paintBlock(el.body, level + 1, lines);
            }
            if (st.elseBody) {
                lines.push(ind + "else");
                paintBlock(st.elseBody, level + 1, lines);
            }
            lines.push(ind + "end");
            break;
        case "while":
            lines.push(ind + "while " + paintExpr(st.cond, 0) + " do");
            paintBlock(st.body, level + 1, lines);
            lines.push(ind + "end");
            break;
        case "repeat":
            lines.push(ind + "repeat");
            paintBlock(st.body, level + 1, lines);
            lines.push(ind + "until " + paintExpr(st.cond, 0));
            break;
        case "fornum": {
            let s = ind + "for " + st.var + " = " + paintExpr(st.from, 0) + ", " + paintExpr(st.to, 0);
            if (st.step) s += ", " + paintExpr(st.step, 0);
            lines.push(s + " do");
            paintBlock(st.body, level + 1, lines);
            lines.push(ind + "end");
            break;
        }
        case "forgen":
            lines.push(ind + "for " + st.names.join(", ") + " in " + st.iter.map(v => paintExpr(v, 0)).join(", ") + " do");
            paintBlock(st.body, level + 1, lines);
            lines.push(ind + "end");
            break;
        case "do":
            lines.push(ind + "do");
            paintBlock(st.body, level + 1, lines);
            lines.push(ind + "end");
            break;
        case "seq":
            paintBlock(st.body, level, lines);
            break;
        case "break":
        case "continue":
            lines.push(ind + st.t);
            break;
        default:
            break;
    }
}

function paintBlock(stmts, level, lines) {
    for (const st of stmts) paintStatement(st, level, lines);
}

function paint(chunk) {
    const lines = [];
    paintBlock(chunk.body, 0, lines);
    while (lines.length > 0 && lines[0] === "") lines.shift();
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n") + "\n";
}

module.exports = { paint, paintExpr };
