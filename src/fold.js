"use strict";

const FAIL = Symbol("fold-fail");
const PREC = {
    "or": 1, "and": 2, "<": 3, ">": 3, "<=": 3, ">=": 3, "~=": 3, "==": 3,
    "|": 4, "~": 5, "&": 6, "<<": 7, ">>": 7, "..": 8, "+": 9, "-": 9,
    "*": 10, "/": 10, "//": 10, "%": 10, "^": 12
};

function truthy(v) { return v !== null && v !== false; }

function luaStr(v) {
    if (v === null || v === undefined) return "nil";
    if (v === true) return "true";
    if (v === false) return "false";
    if (typeof v === "number") {
        if (Number.isInteger(v)) return String(v);
        return String(v);
    }
    return v;
}

function toNum(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        if (!Number.isNaN(n)) return n;
    }
    return FAIL;
}

function toInt(v) {
    const n = toNum(v);
    if (n === FAIL) return FAIL;
    return Math.trunc(n);
}

function byteLen(s) { return Buffer.byteLength(s, "utf8"); }

function strSub(s, i, j) {
    const len = s.length;
    if (i < 0) i = Math.max(len + i + 1, 1);
    if (i < 1) i = 1;
    if (j === undefined || j === null) j = len;
    if (j < 0) j = len + j + 1;
    if (j > len) j = len;
    if (i > j) return "";
    return s.slice(i - 1, j);
}

function luaFormat(fmt, args) {
    let out = "";
    let ai = 0;
    let i = 0;
    while (i < fmt.length) {
        const c = fmt[i];
        if (c !== "%") { out += c; i++; continue; }
        i++;
        if (fmt[i] === "%") { out += "%"; i++; continue; }
        while (i < fmt.length && "-+ 0#".includes(fmt[i])) i++;
        let width = "";
        while (i < fmt.length && /[0-9]/.test(fmt[i])) width += fmt[i++];
        let prec = null;
        if (fmt[i] === ".") {
            i++;
            let p = "";
            while (i < fmt.length && /[0-9]/.test(fmt[i])) p += fmt[i++];
            prec = p === "" ? 0 : parseInt(p, 10);
        }
        const spec = fmt[i++];
        if (spec === undefined) return FAIL;
        const a = args[ai++];
        if (a === undefined || a === FAIL) return FAIL;
        let piece = "";
        switch (spec) {
            case "d": case "i": {
                const n = toInt(a);
                if (n === FAIL) return FAIL;
                piece = String(n);
                break;
            }
            case "u": {
                const n = toInt(a);
                if (n === FAIL) return FAIL;
                piece = String(n >>> 0);
                break;
            }
            case "c": {
                const n = toInt(a);
                if (n === FAIL) return FAIL;
                piece = String.fromCodePoint(n & 0x7fffffff);
                break;
            }
            case "s": {
                if (typeof a === "number" || typeof a === "string" || typeof a === "boolean") piece = luaStr(a);
                else if (a && a.__tab) return FAIL;
                else return FAIL;
                break;
            }
            case "f": case "F": {
                const n = toNum(a);
                if (n === FAIL) return FAIL;
                piece = n.toFixed(prec === null ? 6 : prec);
                break;
            }
            case "e": case "E": {
                const n = toNum(a);
                if (n === FAIL) return FAIL;
                piece = n.toExponential(prec === null ? 6 : prec);
                break;
            }
            case "g": case "G": {
                const n = toNum(a);
                if (n === FAIL) return FAIL;
                piece = String(n);
                break;
            }
            case "x": case "X": case "o": {
                const n = toInt(a);
                if (n === FAIL) return FAIL;
                let s2 = spec === "o" ? (n >>> 0).toString(8) : (n >>> 0).toString(spec === "x" ? 16 : 16).toUpperCase();
                if (spec === "x") s2 = (n >>> 0).toString(16);
                piece = s2;
                break;
            }
            case "q": {
                if (typeof a !== "string") return FAIL;
                piece = '"' + a.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
                break;
            }
            default:
                return FAIL;
        }
        if (prec !== null && (spec === "s" || spec === "q") && piece.length > prec) piece = piece.slice(0, prec);
        if (width !== "") {
            const w = parseInt(width, 10);
            if (piece.length < w) {
                if (fmt.includes("-")) piece = piece + " ".repeat(w - piece.length);
                else piece = " ".repeat(w - piece.length) + piece;
            }
        }
        out += piece;
    }
    return out;
}

function makeTableValue() { return { __tab: true, arr: [], kv: new Map() }; }

function tableIndex(tv, key) {
    if (typeof key === "number") {
        if (!Number.isInteger(key) || key < 1 || key > tv.arr.length) return null;
        return tv.arr[key - 1];
    }
    if (typeof key === "string") {
        if (tv.kv.has(key)) return tv.kv.get(key);
        return null;
    }
    return FAIL;
}

const LIBS = new Set(["string", "bit32", "math", "table"]);

function callNamedFn(full, args) {
    const [lib, fn] = full.split(".");
    switch (lib + "." + fn) {
        case "string.byte": {
            const s = args[0];
            if (typeof s !== "string") return FAIL;
            const i = args.length > 1 ? toInt(args[1]) : 1;
            if (i === FAIL) return FAIL;
            if (i < 1 || i > s.length) return FAIL;
            return s.charCodeAt(i - 1);
        }
        case "string.char": {
            let out = "";
            for (const a of args) {
                const n = toInt(a);
                if (n === FAIL) return FAIL;
                out += String.fromCharCode(n & 0xff);
            }
            return out;
        }
        case "string.sub": {
            const s = args[0];
            if (typeof s !== "string") return FAIL;
            const i = toInt(args[1]);
            if (i === FAIL) return FAIL;
            const j = args.length > 2 ? toInt(args[2]) : null;
            if (j === FAIL) return FAIL;
            return strSub(s, i, j === null ? undefined : j);
        }
        case "string.len": return typeof args[0] === "string" ? byteLen(args[0]) : FAIL;
        case "string.rep": {
            const s = args[0];
            const n = toInt(args[1]);
            if (typeof s !== "string" || n === FAIL || n < 0) return FAIL;
            return s.repeat(Math.min(n, 1e6));
        }
        case "string.upper": return typeof args[0] === "string" ? args[0].toUpperCase() : FAIL;
        case "string.lower": return typeof args[0] === "string" ? args[0].toLowerCase() : FAIL;
        case "string.reverse": return typeof args[0] === "string" ? args[0].split("").reverse().join("") : FAIL;
        case "string.format": return typeof args[0] === "string" ? luaFormat(args[0], args.slice(1)) : FAIL;
        case "string.gsub": case "string.gmatch": case "string.match": case "string.find": return FAIL;
        case "bit32.band": { let r = -1 >>> 0; for (const a of args) { const n = toInt(a); if (n === FAIL) return FAIL; r = (r & (n >>> 0)) >>> 0; } return r; }
        case "bit32.bor": { let r = 0; for (const a of args) { const n = toInt(a); if (n === FAIL) return FAIL; r = (r | (n >>> 0)) >>> 0; } return r; }
        case "bit32.bxor": { let r = 0; for (const a of args) { const n = toInt(a); if (n === FAIL) return FAIL; r = (r ^ (n >>> 0)) >>> 0; } return r; }
        case "bit32.bnot": { const n = toInt(args[0]); return n === FAIL ? FAIL : (~(n >>> 0)) >>> 0; }
        case "bit32.lshift": { const a = toInt(args[0]); const b = toInt(args[1]); return a === FAIL || b === FAIL ? FAIL : ((a << (b & 31)) >>> 0); }
        case "bit32.rshift": { const a = toInt(args[0]); const b = toInt(args[1]); return a === FAIL || b === FAIL ? FAIL : ((a >>> 0) >>> (b & 31)); }
        case "bit32.arshift": { const a = toInt(args[0]); const b = toInt(args[1]); return a === FAIL || b === FAIL ? FAIL : ((a >> (b & 31)) >>> 0); }
        case "math.floor": { const n = toNum(args[0]); return n === FAIL ? FAIL : Math.floor(n); }
        case "math.ceil": { const n = toNum(args[0]); return n === FAIL ? FAIL : Math.ceil(n); }
        case "math.abs": { const n = toNum(args[0]); return n === FAIL ? FAIL : Math.abs(n); }
        case "math.sqrt": { const n = toNum(args[0]); return n === FAIL ? FAIL : Math.sqrt(n); }
        case "math.max": { let m = -Infinity; for (const a of args) { const n = toNum(a); if (n === FAIL) return FAIL; if (n > m) m = n; } return m; }
        case "math.min": { let m = Infinity; for (const a of args) { const n = toNum(a); if (n === FAIL) return FAIL; if (n < m) m = n; } return m; }
        case "math.fmod": { const a = toNum(args[0]); const b = toNum(args[1]); return a === FAIL || b === FAIL || b === 0 ? FAIL : a % b; }
        case "math.clamp": { const x = toNum(args[0]); const lo = toNum(args[1]); const hi = toNum(args[2]); return x === FAIL || lo === FAIL || hi === FAIL ? FAIL : Math.min(Math.max(x, lo), hi); }
        case "table.concat": {
            const tv = args[0];
            if (!tv || !tv.__tab) return FAIL;
            const sep = args.length > 1 ? args[1] : "";
            if (typeof sep !== "string") return FAIL;
            const parts = [];
            for (const v of tv.arr) {
                if (typeof v !== "string" && typeof v !== "number") return FAIL;
                parts.push(luaStr(v));
            }
            return parts.join(sep);
        }
        case "tostring": {
            const a = args[0];
            if (typeof a === "number" || typeof a === "string" || typeof a === "boolean") return luaStr(a);
            if (a === null || a === undefined) return "nil";
            return FAIL;
        }
        case "tonumber": {
            const a = args[0];
            if (typeof a === "number") return a;
            if (typeof a === "string") {
                if (args.length > 1) {
                    const base = toInt(args[1]);
                    if (base === FAIL || base < 2 || base > 36) return FAIL;
                    const n = parseInt(a.trim(), base);
                    return Number.isNaN(n) ? null : n;
                }
                const n = Number(a.trim());
                return Number.isNaN(n) ? null : n;
            }
            return FAIL;
        }
        case "type": {
            const a = args[0];
            if (a === null || a === undefined) return "nil";
            if (typeof a === "number") return "number";
            if (typeof a === "string") return "string";
            if (typeof a === "boolean") return "boolean";
            if (a && a.__tab) return "table";
            return FAIL;
        }
        case "rawlen": {
            const a = args[0];
            if (typeof a === "string") return byteLen(a);
            if (a && a.__tab) return a.arr.length;
            return FAIL;
        }
        case "select": {
            const a = args[0];
            if (typeof a === "string" && a === "#") return args.length - 1;
            return FAIL;
        }
        default:
            return FAIL;
    }
}

function arith(op, l, r) {
    if (op === "..") {
        if ((typeof l === "string" || typeof l === "number") && (typeof r === "string" || typeof r === "number")) return luaStr(l) + luaStr(r);
        return FAIL;
    }
    if (op === "==" ) return l === r;
    if (op === "~=") return l !== r;
    if (op === "and") return truthy(l) ? r : l;
    if (op === "or") return truthy(l) ? l : r;
    if (op === "&" || op === "|" || op === "~" || op === "<<" || op === ">>") {
        if (op === "~" && (typeof l === "string" && typeof r === "string")) return FAIL;
        const a = toInt(l); const b = toInt(r);
        if (a === FAIL || b === FAIL) return FAIL;
        switch (op) {
            case "&": return (a & b) >>> 0;
            case "|": return (a | b) >>> 0;
            case "~": return (a ^ b) >>> 0;
            case "<<": return (a << (b & 31)) >>> 0;
            case ">>": return (a >>> (b & 31)) >>> 0;
        }
    }
    const a = toNum(l); const b = toNum(r);
    if (a === FAIL || b === FAIL) return FAIL;
    switch (op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "//": return Math.floor(a / b);
        case "%": return a - Math.floor(a / b) * b;
        case "^": return Math.pow(a, b);
        case "<": return typeof l === typeof r && (typeof l === "number" || typeof l === "string") ? l < r : FAIL;
        case ">": return typeof l === typeof r && (typeof l === "number" || typeof l === "string") ? l > r : FAIL;
        case "<=": return typeof l === typeof r && (typeof l === "number" || typeof l === "string") ? l <= r : FAIL;
        case ">=": return typeof l === typeof r && (typeof l === "number" || typeof l === "string") ? l >= r : FAIL;
    }
    return FAIL;
}

const tableCache = new WeakMap();

function evalExpr(e, env) {
    if (!e || typeof e !== "object") return FAIL;
    switch (e.t) {
        case "num": return e.v;
        case "str": return e.v;
        case "bool": return e.v;
        case "nil": return null;
        case "var": {
            if (env.has(e.name)) {
                const ent = env.get(e.name);
                if (ent.__table) {
                    if (!tableCache.has(ent.node)) {
                        const v = evalExpr(ent.node, env);
                        if (v === FAIL) return FAIL;
                        tableCache.set(ent.node, v);
                    }
                    return tableCache.get(ent.node);
                }
                return evalExpr(ent, env);
            }
            if (LIBS.has(e.name)) return { __lib: e.name };
            return FAIL;
        }
        case "unop": {
            const v = evalExpr(e.e, env);
            if (v === FAIL) return FAIL;
            switch (e.op) {
                case "not": return !truthy(v);
                case "-": { const n = toNum(v); return n === FAIL ? FAIL : -n; }
                case "#": {
                    if (typeof v === "string") return byteLen(v);
                    if (v && v.__tab) return v.arr.length;
                    return FAIL;
                }
                case "~": { const n = toInt(v); return n === FAIL ? FAIL : (~(n >>> 0)) >>> 0; }
            }
            return FAIL;
        }
        case "binop": {
            if (e.op === "and") { const l = evalExpr(e.l, env); if (l === FAIL) return FAIL; return truthy(l) ? evalExpr(e.r, env) : l; }
            if (e.op === "or") { const l = evalExpr(e.l, env); if (l === FAIL) return FAIL; return truthy(l) ? l : evalExpr(e.r, env); }
            const l = evalExpr(e.l, env);
            const r = evalExpr(e.r, env);
            if (l === FAIL || r === FAIL) return FAIL;
            return arith(e.op, l, r);
        }
        case "paren": return evalExpr(e.e, env);
        case "ifelse": {
            const c = evalExpr(e.cond, env);
            if (c === FAIL) return FAIL;
            return truthy(c) ? evalExpr(e.a, env) : evalExpr(e.b, env);
        }
        case "table": {
            const tv = makeTableValue();
            let arrIdx = 1;
            for (const it of e.items) {
                if (it.key === null) {
                    const v = evalExpr(it.value, env);
                    if (v === FAIL) return FAIL;
                    tv.arr.push(v);
                    arrIdx++;
                } else {
                    const k = evalExpr(it.key, env);
                    if (k === FAIL) return FAIL;
                    const v = evalExpr(it.value, env);
                    if (v === FAIL) return FAIL;
                    tv.kv.set(typeof k === "number" && Number.isInteger(k) && k >= 1 && k <= arrIdx + 1 ? k : k, v);
                    if (typeof k === "number" && Number.isInteger(k) && k >= 1 && k <= arrIdx) tv.arr[k - 1] = v;
                }
            }
            return tv;
        }
        case "index": {
            const obj = evalExpr(e.obj, env);
            if (obj === FAIL) return FAIL;
            const key = evalExpr(e.key, env);
            if (key === FAIL) return FAIL;
            if (obj && obj.__lib && typeof key === "string") return { __fn: obj.__lib + "." + key };
            if (obj && obj.__tab) return tableIndex(obj, key);
            return FAIL;
        }
        case "methodcall": {
            const obj = evalExpr(e.obj, env);
            if (obj === FAIL) return FAIL;
            const args = [];
            for (const a of e.args) {
                const v = evalExpr(a, env);
                if (v === FAIL) return FAIL;
                args.push(v);
            }
            if (typeof obj === "string") return callNamedFn("string." + e.name, [obj, ...args]);
            return FAIL;
        }
        case "call": {
            const fn = evalExpr(e.fn, env);
            if (fn === FAIL || !fn || fn.__fn === undefined) return FAIL;
            const args = [];
            for (const a of e.args) {
                const v = evalExpr(a, env);
                if (v === FAIL) return FAIL;
                args.push(v);
            }
            return callNamedFn(fn.__fn, args);
        }
        default:
            return FAIL;
    }
}

function valueToNode(v) {
    if (v === FAIL || v === undefined) return null;
    if (v === null) return { t: "nil" };
    if (typeof v === "boolean") return { t: "bool", v };
    if (typeof v === "number") return { t: "num", v };
    if (typeof v === "string") return { t: "str", v };
    return null;
}

function cloneNode(n) { return JSON.parse(JSON.stringify(n)); }

function targetName(e) {
    if (e.t === "var") return e.name;
    return null;
}

function foldExpr(e, env, stats) {
    if (!e || typeof e !== "object") return e;
    switch (e.t) {
        case "unop": e.e = foldExpr(e.e, env, stats); break;
        case "binop": e.l = foldExpr(e.l, env, stats); e.r = foldExpr(e.r, env, stats); break;
        case "paren": e.e = foldExpr(e.e, env, stats); break;
        case "ifelse":
            e.cond = foldExpr(e.cond, env, stats);
            e.a = foldExpr(e.a, env, stats);
            e.b = foldExpr(e.b, env, stats);
            break;
        case "index":
            e.obj = foldExpr(e.obj, env, stats);
            e.key = foldExpr(e.key, env, stats);
            break;
        case "call":
            e.fn = foldExpr(e.fn, env, stats);
            e.args = e.args.map(a => foldExpr(a, env, stats));
            break;
        case "methodcall":
            e.obj = foldExpr(e.obj, env, stats);
            e.args = e.args.map(a => foldExpr(a, env, stats));
            break;
        case "table":
            for (const it of e.items) {
                if (it.key) it.key = foldExpr(it.key, env, stats);
                it.value = foldExpr(it.value, env, stats);
            }
            break;
        case "var": {
            if (env.has(e.name)) {
                const ent = env.get(e.name);
                if (ent.__table) return e;
                const v = evalExpr(ent, env);
                const lit = valueToNode(v);
                if (lit) { stats.constantsFolded++; return lit; }
                return e;
            }
            return e;
        }
        default:
            return e;
    }
    const v = evalExpr(e, env);
    const lit = valueToNode(v);
    if (lit) {
        stats.constantsFolded++;
        return lit;
    }
    return e;
}

function foldStatement(st, env, stats) {
    switch (st.t) {
        case "local": {
            st.values = st.values.map(v => foldExpr(v, env, stats));
            if (st.names.length === 1 && st.values.length === 1) {
                const v = st.values[0];
                if (v.t === "num" || v.t === "str" || v.t === "bool" || v.t === "nil") env.set(st.names[0], v);
                else if (v.t === "table") env.set(st.names[0], { __table: true, node: v });
                else env.delete(st.names[0]);
            } else {
                for (const n of st.names) env.delete(n);
            }
            break;
        }
        case "localfunc":
            env.delete(st.name);
            foldFunction(st.body, stats);
            break;
        case "funcstat": {
            const nm = targetName(st.target);
            if (nm) env.delete(nm);
            foldFunction(st.body, stats);
            break;
        }
        case "assign": {
            st.values = st.values.map(v => foldExpr(v, env, stats));
            st.targets = st.targets.map(tg => foldExpr(tg, env, stats));
            for (const tg of st.targets) {
                const nm = targetName(tg);
                if (nm) env.delete(nm);
            }
            break;
        }
        case "exprstat":
            st.expr = foldExpr(st.expr, env, stats);
            break;
        case "return":
            st.values = st.values.map(v => foldExpr(v, env, stats));
            break;
        case "if": {
            st.cond = foldExpr(st.cond, env, stats);
            if (st.cond.t === "bool") {
                stats.branchesPruned++;
                let taken = st.cond.v ? st.thenBody : (st.elseBody || []);
                if (!st.cond.v && st.elifs.length > 0) {
                    const el = st.elifs[st.elifs.length - 1];
                    if (!st.elseBody) taken = el.body;
                }
                foldBlockInPlace(taken, new Map(env), stats);
                st.t = "seq";
                st.body = taken;
                if (!st.cond.v && st.elifs.length > 0) {
                    st.t = "if";
                    const first = st.elifs[0];
                    st.cond = first.cond;
                    st.thenBody = first.body;
                    st.elifs = st.elifs.slice(1);
                    st.elseBody = st.elseBody;
                    st._reprocess = true;
                }
                break;
            }
            foldBlockInPlace(st.thenBody, new Map(env), stats);
            for (const el of st.elifs) {
                el.cond = foldExpr(el.cond, env, stats);
                foldBlockInPlace(el.body, new Map(env), stats);
            }
            if (st.elseBody) foldBlockInPlace(st.elseBody, new Map(env), stats);
            break;
        }
        case "while": {
            st.cond = foldExpr(st.cond, env, stats);
            if (st.cond.t === "bool" && !st.cond.v) {
                st.t = "seq";
                st.body = [];
                break;
            }
            foldBlockInPlace(st.body, new Map(env), stats);
            break;
        }
        case "repeat": {
            foldBlockInPlace(st.body, new Map(env), stats);
            st.cond = foldExpr(st.cond, env, stats);
            if (st.cond.t === "bool" && st.cond.v) {
                st.t = "do";
            }
            break;
        }
        case "fornum": {
            st.from = foldExpr(st.from, env, stats);
            st.to = foldExpr(st.to, env, stats);
            if (st.step) st.step = foldExpr(st.step, env, stats);
            const inner = new Map(env);
            inner.delete(st.var);
            foldBlockInPlace(st.body, inner, stats);
            break;
        }
        case "forgen": {
            st.iter = st.iter.map(v => foldExpr(v, env, stats));
            const inner = new Map(env);
            for (const n of st.names) inner.delete(n);
            foldBlockInPlace(st.body, inner, stats);
            break;
        }
        case "do":
            foldBlockInPlace(st.body, new Map(env), stats);
            break;
        default:
            break;
    }
    return st;
}

function foldFunction(fn, stats) {
    foldBlockInPlace(fn.body, new Map(), stats);
}

function flattenSeq(stmts, stats) {
    const out = [];
    for (const st of stmts) {
        if (st.t === "seq") out.push(...st.body);
        else out.push(st);
    }
    return out;
}

function foldBlockInPlace(stmts, env, stats) {
    for (let i = 0; i < stmts.length; i++) {
        const st = foldStatement(stmts[i], env, stats);
        if (st._reprocess) {
            delete st._reprocess;
            const again = foldStatement(st, env, stats);
            stmts[i] = again;
        } else {
            stmts[i] = st;
        }
    }
    const flat = flattenSeq(stmts, stats);
    stmts.length = 0;
    stmts.push(...flat);
    for (let i = stmts.length - 1; i >= 0; i--) {
        const st = stmts[i];
        if (st.t === "local" && st.values.length === 0 && st.names.length === 1) stmts.splice(i, 1);
    }
}

function foldConstants(chunk, stats) {
    foldBlockInPlace(chunk.body, new Map(), stats);
    return chunk;
}

module.exports = { foldConstants, evalExpr, valueToNode, FAIL, foldExpr, foldBlockInPlace, truthy, callNamedFn };
