"use strict";

const { evalExpr, valueToNode, FAIL } = require("./fold");

function tableItemsAllLiteral(tbl) {
    if (tbl.t !== "table" || tbl.items.length < 4) return false;
    for (const it of tbl.items) {
        if (it.key !== null) return false;
        const v = it.value;
        if (!(v.t === "str" || v.t === "num")) return false;
    }
    return true;
}

function tableStrings(tbl) {
    return tbl.items.map(it => it.value.t === "str" ? it.value.v : null);
}

function literalNode(v) {
    if (typeof v === "string") return { t: "str", v };
    if (typeof v === "number") return { t: "num", v };
    return null;
}

function buildInnerEnv(fn, baseEnv) {
    const env = new Map(baseEnv);
    for (const st of fn.body) {
        if (st.t === "local" && st.names.length === 1 && st.values.length === 1) {
            const v = evalExpr(st.values[0], env);
            if (v === FAIL) break;
            if (v && v.__tab) break;
            const lit = valueToNode(v);
            if (!lit) break;
            env.set(st.names[0], lit);
        } else if (st.t === "return") {
            break;
        }
    }
    return env;
}

function tryDirectDecoder(fn, tblName, tblNode, count) {
    const rets = fn.body.filter(st => st.t === "return");
    if (rets.length !== 1 || rets[0].values.length !== 1) return null;
    const retExpr = rets[0].values[0];
    const base = new Map();
    base.set(tblName, { __table: true, node: tblNode });
    const out = new Map();
    const param = fn.params[0];
    for (let i = 1; i <= count; i++) {
        const env = buildInnerEnv(fn, base);
        if (param) env.set(param, { t: "num", v: i });
        const v = evalExpr(retExpr, env);
        if (v === FAIL || (v && v.__tab) || v === undefined) return null;
        const lit = valueToNode(v);
        if (!lit) return null;
        out.set(i, lit);
    }
    return out;
}

function extractXorLoop(fn) {
    if (fn.params.length < 1) return null;
    const param = fn.params[0];
    let tblName = null;
    let sName = null;
    let rName = null;
    let jName = null;
    let op = null;
    let keyNode = null;
    let loopVar = null;
    for (const st of fn.body) {
        if (st.t === "local" && st.names.length === 1 && st.values.length === 1) {
            const v = st.values[0];
            if (v.t === "index" && v.obj.t === "var" && v.key.t === "var" && v.key.name === param) {
                tblName = v.obj.name;
                sName = st.names[0];
            } else if (v.t === "str" && v.v === "") {
                rName = st.names[0];
            }
        } else if (st.t === "fornum") {
            loopVar = st;
            jName = st.var;
            if (st.from.t !== "num" || st.from.v !== 1) return null;
            if (!(st.to.t === "unop" && st.to.op === "#" && st.to.e.t === "var")) return null;
            if (st.to.e.name !== sName) return null;
            if (st.step) return null;
            if (st.body.length !== 1) return null;
            const as = st.body[0];
            if (as.t !== "assign" || as.targets.length !== 1 || as.values.length !== 1) return null;
            const tgt = as.targets[0];
            if (tgt.t !== "var") return null;
            if (as.op === "=") {
                if (tgt.name !== rName) return null;
                const val = as.values[0];
                if (val.t !== "binop" || val.op !== ".." || val.l.t !== "var" || val.l.name !== rName) return null;
                const inner = val.r;
                const found = decodeCharExpr(inner, sName, jName);
                if (!found) return null;
                op = found.op;
                keyNode = found.key;
            } else if (as.op === "..=") {
                if (tgt.name !== rName) return null;
                const found = decodeCharExpr(as.values[0], sName, jName);
                if (!found) return null;
                op = found.op;
                keyNode = found.key;
            } else {
                return null;
            }
        }
    }
    if (!tblName || !sName || !rName || !jName || !op || !keyNode || !loopVar) return null;
    const last = fn.body[fn.body.length - 1];
    if (last.t !== "return" || last.values.length !== 1 || last.values[0].t !== "var" || last.values[0].name !== rName) return null;
    const k = evalExpr(keyNode, new Map());
    if (k === FAIL || typeof k !== "number") return null;
    return { tblName, op, key: k };
}

function decodeCharExpr(node, sName, jName) {
    if (node.t !== "call") return null;
    if (node.fn.t !== "index" || node.fn.obj.t !== "var" || node.fn.obj.name !== "string") return null;
    if (node.fn.key.t !== "str" || node.fn.key.v !== "char") return null;
    if (node.args.length !== 1) return null;
    const inner = node.args[0];
    if (inner.t !== "binop") return null;
    if (!["~", "+", "-", "^"].includes(inner.op)) return null;
    const a = inner.l;
    const b = inner.r;
    let byteCall = null;
    let key = null;
    if (isByteCall(a, sName, jName) && isConstNum(b)) { byteCall = a; key = b; }
    else if (isByteCall(b, sName, jName) && isConstNum(a) && (inner.op === "~" || inner.op === "+")) { byteCall = b; key = a; }
    else return null;
    return { op: inner.op, key };
}

function isByteCall(node, sName, jName) {
    if (node.t !== "call") return false;
    if (node.fn.t !== "index" || node.fn.obj.t !== "var" || node.fn.obj.name !== "string") return false;
    if (node.fn.key.t !== "str" || node.fn.key.v !== "byte") return false;
    if (node.args.length !== 2) return false;
    return node.args[0].t === "var" && node.args[0].name === sName &&
        node.args[1].t === "var" && node.args[1].name === jName;
}

function isConstNum(node) { return node.t === "num"; }

function applyByteOp(ch, op, key) {
    switch (op) {
        case "~": return ch ^ key;
        case "+": return ch + key;
        case "-": return ch - key;
        case "^": return ch ^ key;
    }
    return ch;
}

function tryLoopDecoder(fn, count) {
    const info = extractXorLoop(fn);
    if (!info) return null;
    const tblNode = fn.__tblNode;
    const strings = tableStrings(tblNode);
    const out = new Map();
    for (let i = 1; i <= count; i++) {
        const s = strings[i - 1];
        if (s === null) return null;
        let r = "";
        for (let j = 0; j < s.length; j++) {
            r += String.fromCharCode(applyByteOp(s.charCodeAt(j), info.op, info.key) & 0xff);
        }
        out.set(i, { t: "str", v: r });
    }
    return out;
}

function walk(node, cb) {
    if (!node || typeof node !== "object") return;
    cb(node);
    for (const k of Object.keys(node)) {
        if (k === "line") continue;
        const v = node[k];
        if (Array.isArray(v)) {
            for (const item of v) {
                if (item && typeof item === "object") walk(item, cb);
            }
        } else if (v && typeof v === "object") {
            walk(v, cb);
        }
    }
}

function countVarUses(chunk, name) {
    let n = 0;
    walk(chunk, node => {
        if (node.t === "var" && node.name === name) n++;
    });
    return n;
}

function replaceDecoderCalls(chunk, fnName, mapping, tblName) {
    let replaced = 0;
    walk(chunk, node => {
        if (node.t === "call" && node.fn.t === "var" && node.fn.name === fnName &&
            node.args.length === 1 && node.args[0].t === "num") {
            const lit = mapping.get(node.args[0].v);
            if (lit) {
                node.t = lit.t;
                node.v = lit.v;
                delete node.fn;
                delete node.args;
                replaced++;
            }
        } else if (node.t === "index" && node.obj.t === "var" && node.obj.name === tblName &&
            node.key.t === "num") {
            const lit = mapping.get(node.key.v);
            if (lit) {
                node.t = lit.t;
                node.v = lit.v;
                delete node.obj;
                delete node.key;
                replaced++;
            }
        }
    });
    return replaced;
}

function removeDecl(chunk, fnName, tblName) {
    const rm = (stmts) => {
        for (let i = stmts.length - 1; i >= 0; i--) {
            const st = stmts[i];
            if (st.t === "local" && st.names.length === 1 && st.names[0] === tblName) {
                stmts.splice(i, 1);
                continue;
            }
            if (st.t === "localfunc" && st.name === fnName) {
                stmts.splice(i, 1);
                continue;
            }
            if (st.t === "assign" && st.targets.length === 1 && st.targets[0].t === "var" &&
                st.targets[0].name === fnName && st.values.length === 1 && st.values[0].t === "function") {
                stmts.splice(i, 1);
                continue;
            }
            for (const key of ["body", "thenBody", "elseBody"]) {
                if (Array.isArray(st[key])) rm(st[key]);
            }
            if (st.elifs) for (const el of st.elifs) rm(el.body);
        }
    };
    rm(chunk.body);
}

function findCandidates(chunk) {
    const tables = [];
    const decoders = [];
    walk(chunk, node => {
        if (node.t === "local" && node.names.length === 1 && node.values.length === 1 &&
            node.values[0].t === "table" && tableItemsAllLiteral(node.values[0])) {
            tables.push({ name: node.names[0], node: node.values[0] });
        }
        if (node.t === "localfunc" && node.body && node.body.params && node.body.params.length >= 1) {
            decoders.push({ name: node.name, fn: node.body, style: "localfunc" });
        }
        if (node.t === "assign" && node.targets.length === 1 && node.targets[0].t === "var" &&
            node.values.length === 1 && node.values[0].t === "function" && node.values[0].params.length >= 1) {
            decoders.push({ name: node.targets[0].name, fn: node.values[0], style: "assign" });
        }
    });
    return { tables, decoders };
}

function unscrambleTables(chunk, stats) {
    const { tables, decoders } = findCandidates(chunk);
    for (const tbl of tables) {
        const count = tbl.node.items.length;
        for (const dec of decoders) {
            if (dec.consumed) continue;
            const usesTbl = dec.fn.body && JSON.stringify(dec.fn.body).includes(JSON.stringify(tbl.name));
            if (!usesTbl) continue;
            dec.fn.__tblNode = tbl.node;
            let mapping = tryDirectDecoder(dec.fn, tbl.name, tbl.node, count);
            if (!mapping) mapping = tryLoopDecoder(dec.fn, count);
            if (!mapping || mapping.size === 0) continue;
            const replaced = replaceDecoderCalls(chunk, dec.name, mapping, tbl.name);
            if (replaced > 0) {
                const declBias = dec.style === "assign" ? 1 : 0;
                const tblUses = countVarUses(chunk, tbl.name);
                const fnUses = countVarUses(chunk, dec.name) - declBias;
                if (tblUses <= 0 && fnUses <= 0) removeDecl(chunk, dec.name, tbl.name);
                stats.stringsDecoded += replaced;
                stats.tablesDecoded++;
                dec.consumed = true;
            }
        }
    }
    return chunk;
}

module.exports = { unscrambleTables };
