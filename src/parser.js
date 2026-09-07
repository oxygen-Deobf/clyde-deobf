"use strict";

const PREC = {
    "or": 1, "and": 2, "<": 3, ">": 3, "<=": 3, ">=": 3, "~=": 3, "==": 3,
    "|": 4, "~": 5, "&": 6, "<<": 7, ">>": 7, "..": 8, "+": 9, "-": 9,
    "*": 10, "/": 10, "//": 10, "%": 10, "^": 12
};
const RIGHT_ASSOC = new Set(["^", ".."]);
const UNARY_OPS = new Set(["not", "-", "#", "~"]);
const COMPOUND = new Set(["+=", "-=", "*=", "/=", "//=", "%=", "^=", "..="]);

class Parser {
    constructor(tokens) {
        this.toks = tokens;
        this.i = 0;
    }

    cur() { return this.toks[this.i] || { type: "eof", value: "<eof>", raw: "<eof>", line: 0 }; }
    type() { return this.cur().type; }
    value() { return this.cur().value; }
    line() { return this.cur().line; }

    next() { const t = this.cur(); if (this.i < this.toks.length) this.i++; return t; }

    accept(type, value) {
        const t = this.cur();
        if (t.type === type && (value === undefined || t.value === value)) { this.i++; return t; }
        return null;
    }

    expect(type, value) {
        const t = this.accept(type, value);
        if (!t) this.error("expected '" + (value || type) + "' but got '" + this.cur().raw + "'");
        return t;
    }

    error(msg) {
        throw new Error(`Parse error near '${this.cur().raw}' (line ${this.cur().line}): ${msg}`);
    }

    atBlockEnd() {
        if (this.type() === "eof") return true;
        const v = this.value();
        return v === "end" || v === "else" || v === "elseif" || v === "until";
    }

    parseChunk() {
        const body = this.parseBlock();
        if (this.type() !== "eof") this.error("unexpected token after chunk end");
        return { t: "chunk", body };
    }

    parseBlock() {
        const body = [];
        while (!this.atBlockEnd()) {
            const st = this.parseStatement();
            if (st) body.push(st);
            this.accept("symbol", ";");
        }
        if (this.value() === "return") {
            this.next();
            const values = [];
            if (!this.atBlockEnd() && !(this.type() === "symbol" && this.value() === ";")) {
                values.push(this.parseExpr());
                while (this.accept("symbol", ",")) values.push(this.parseExpr());
            }
            body.push({ t: "return", values });
            this.accept("symbol", ";");
        }
        return body;
    }

    parseStatement() {
        const t = this.type();
        const v = this.value();
        if (t === "symbol" && v === ";") { this.next(); return null; }
        if (t === "keyword") {
            switch (v) {
                case "if": return this.parseIf();
                case "while": return this.parseWhile();
                case "do": { this.next(); const body = this.parseBlock(); this.expect("keyword", "end"); return { t: "do", body }; }
                case "for": return this.parseFor();
                case "repeat": {
                    this.next();
                    const body = this.parseBlock();
                    this.expect("keyword", "until");
                    const cond = this.parseExpr();
                    return { t: "repeat", body, cond };
                }
                case "function": return this.parseFuncStat();
                case "local": return this.parseLocal();
                case "break": this.next(); return { t: "break" };
                case "continue": this.next(); return { t: "continue" };
                default: this.error("unexpected keyword '" + v + "'");
            }
        }
        return this.parseExprOrAssign();
    }

    parseIf() {
        this.expect("keyword", "if");
        const cond = this.parseExpr();
        this.expect("keyword", "then");
        const thenBody = this.parseBlock();
        const elifs = [];
        while (this.accept("keyword", "elseif")) {
            const c = this.parseExpr();
            this.expect("keyword", "then");
            elifs.push({ cond: c, body: this.parseBlock() });
        }
        let elseBody = null;
        if (this.accept("keyword", "else")) elseBody = this.parseBlock();
        this.expect("keyword", "end");
        return { t: "if", cond, thenBody, elifs, elseBody };
    }

    parseWhile() {
        this.expect("keyword", "while");
        const cond = this.parseExpr();
        this.expect("keyword", "do");
        const body = this.parseBlock();
        this.expect("keyword", "end");
        return { t: "while", cond, body };
    }

    parseFor() {
        this.expect("keyword", "for");
        const first = this.expect("name").value;
        if (this.accept("symbol", "=")) {
            const from = this.parseExpr();
            this.expect("symbol", ",");
            const to = this.parseExpr();
            let step = null;
            if (this.accept("symbol", ",")) step = this.parseExpr();
            this.expect("keyword", "do");
            const body = this.parseBlock();
            this.expect("keyword", "end");
            return { t: "fornum", var: first, from, to, step, body };
        }
        const names = [first];
        while (this.accept("symbol", ",")) names.push(this.expect("name").value);
        this.expect("keyword", "in");
        const iter = [this.parseExpr()];
        while (this.accept("symbol", ",")) iter.push(this.parseExpr());
        this.expect("keyword", "do");
        const body = this.parseBlock();
        this.expect("keyword", "end");
        return { t: "forgen", names, iter, body };
    }

    skipTypeAnnotation() {
        if (!this.accept("symbol", ":")) return;
        if (this.type() === "symbol" && (this.value() === "(" || this.value() === "{")) {
            let depth = 0;
            do {
                const tk = this.next();
                if (tk.type === "symbol" && ["(", "{"].includes(tk.value)) depth++;
                else if (tk.type === "symbol" && [")", "}"].includes(tk.value)) depth--;
            } while (depth > 0 && this.type() !== "eof");
            if (this.accept("symbol", "?")) {}
            return;
        }
        let depth = 0;
        while (this.type() !== "eof") {
            const tk = this.cur();
            if (tk.type === "symbol" && tk.value === "<") depth++;
            else if (tk.type === "symbol" && tk.value === ">") { if (depth === 0) break; depth--; }
            else if (depth === 0 && (tk.type === "keyword" || (tk.type === "symbol" && [",", "=", ")"].includes(tk.value)))) break;
            this.next();
        }
        this.accept("symbol", "?");
    }

    parseLocal() {
        this.expect("keyword", "local");
        if (this.accept("keyword", "function")) {
            const name = this.expect("name").value;
            const fn = this.parseFuncBody();
            return { t: "localfunc", name, body: fn };
        }
        const names = [];
        while (true) {
            names.push(this.expect("name").value);
            if (this.type() === "symbol" && this.value() === "<") {
                this.next();
                while (this.type() !== "eof" && !(this.type() === "symbol" && this.value() === ">")) this.next();
                this.accept("symbol", ">");
            }
            this.skipTypeAnnotation();
            if (!this.accept("symbol", ",")) break;
        }
        let values = [];
        if (this.accept("symbol", "=")) {
            values.push(this.parseExpr());
            while (this.accept("symbol", ",")) values.push(this.parseExpr());
        }
        return { t: "local", names, values };
    }

    parseFuncStat() {
        this.expect("keyword", "function");
        let target = { t: "var", name: this.expect("name").value };
        let method = null;
        while (this.accept("symbol", ".")) {
            target = { t: "index", obj: target, key: { t: "str", v: this.expect("name").value } };
        }
        if (this.accept("symbol", ":")) {
            method = this.expect("name").value;
        }
        const fn = this.parseFuncBody();
        if (method !== null) fn.methodSelf = method;
        return { t: "funcstat", target, body: fn };
    }

    parseFuncBody() {
        const line = this.line();
        this.expect("symbol", "(");
        const params = [];
        let vararg = false;
        if (!(this.type() === "symbol" && this.value() === ")")) {
            while (true) {
                if (this.accept("symbol", "...")) { vararg = true; this.skipTypeAnnotation(); }
                else { params.push(this.expect("name").value); this.skipTypeAnnotation(); }
                if (!this.accept("symbol", ",")) break;
            }
        }
        this.expect("symbol", ")");
        const body = this.parseBlock();
        this.expect("keyword", "end");
        return { t: "function", params, vararg, body, line };
    }

    parseExprOrAssign() {
        const first = this.parseSuffixed();
        if (this.type() === "symbol" && (this.value() === "=" || COMPOUND.has(this.value()))) {
            const op = this.next().value;
            const targets = [first];
            while (this.accept("symbol", ",")) targets.push(this.parseSuffixed());
            const values = [this.parseExpr()];
            while (this.accept("symbol", ",")) values.push(this.parseExpr());
            return { t: "assign", op, targets, values };
        }
        if (first.t === "call" || first.t === "methodcall" || first.t === "paren") {
            if (first.t === "paren") this.error("ambiguous syntax");
            return { t: "exprstat", expr: first };
        }
        this.error("unexpected statement");
    }

    parseExprList() {
        const list = [this.parseExpr()];
        while (this.accept("symbol", ",")) list.push(this.parseExpr());
        return list;
    }

    parseExpr(limit) {
        let left;
        if (this.type() === "keyword" && UNARY_OPS.has(this.value())) {
            const op = this.next().value;
            left = { t: "unop", op, e: this.parseExpr(11) };
        } else if (this.type() === "symbol" && UNARY_OPS.has(this.value())) {
            const op = this.next().value;
            left = { t: "unop", op, e: this.parseExpr(11) };
        } else {
            left = this.parseSimple();
        }
        while (true) {
            const tk = this.cur();
            let op = null;
            if (tk.type === "keyword" && (tk.value === "and" || tk.value === "or")) op = tk.value;
            else if (tk.type === "symbol" && PREC[tk.value] !== undefined) op = tk.value;
            if (op === null) break;
            const p = PREC[op];
            if (p <= (limit || 0)) break;
            this.next();
            const rhs = this.parseExpr(RIGHT_ASSOC.has(op) ? p - 1 : p);
            left = { t: "binop", op, l: left, r: rhs };
        }
        return left;
    }

    parseSimple() {
        const tk = this.cur();
        if (tk.type === "number") { this.next(); return { t: "num", v: tk.value, raw: tk.raw }; }
        if (tk.type === "string") { this.next(); return { t: "str", v: tk.value }; }
        if (tk.type === "istring") { this.next(); return { t: "istring", v: tk.value }; }
        if (tk.type === "keyword") {
            if (tk.value === "nil") { this.next(); return { t: "nil" }; }
            if (tk.value === "true" || tk.value === "false") { this.next(); return { t: "bool", v: tk.value === "true" }; }
            if (tk.value === "function") { this.next(); return this.parseFuncBody(); }
            if (tk.value === "if") return this.parseIfExpr();
        }
        if (tk.type === "symbol" && tk.value === "{") return this.parseTable();
        return this.parseSuffixed();
    }

    parseIfExpr() {
        this.expect("keyword", "if");
        const cond = this.parseExpr();
        this.expect("keyword", "then");
        const a = this.parseExpr();
        this.expect("keyword", "else");
        const b = this.parseExpr();
        return { t: "ifelse", cond, a, b };
    }

    parsePrimary() {
        const tk = this.cur();
        if (tk.type === "name") { this.next(); return { t: "var", name: tk.value }; }
        if (tk.type === "symbol" && tk.value === "(") {
            this.next();
            const e = this.parseExpr();
            this.expect("symbol", ")");
            return { t: "paren", e };
        }
        this.error("unexpected symbol '" + tk.raw + "'");
    }

    parseSuffixed() {
        let node = this.parsePrimary();
        while (true) {
            if (this.accept("symbol", ".")) {
                node = { t: "index", obj: node, key: { t: "str", v: this.expect("name").value } };
            } else if (this.accept("symbol", "[")) {
                const key = this.parseExpr();
                this.expect("symbol", "]");
                node = { t: "index", obj: node, key };
            } else if (this.accept("symbol", ":")) {
                const name = this.expect("name").value;
                const args = this.parseCallArgs();
                node = { t: "methodcall", obj: node, name, args };
            } else if (this.type() === "symbol" && (this.value() === "(" || this.value() === "{" || this.type() === "string")) {
                const args = this.parseCallArgs();
                node = { t: "call", fn: node, args };
            } else {
                break;
            }
        }
        return node;
    }

    parseCallArgs() {
        const tk = this.cur();
        if (tk.type === "string") { this.next(); return [{ t: "str", v: tk.value }]; }
        if (tk.type === "symbol" && tk.value === "{") return [this.parseTable()];
        this.expect("symbol", "(");
        const args = [];
        if (!(this.type() === "symbol" && this.value() === ")")) {
            args.push(this.parseExpr());
            while (this.accept("symbol", ",")) args.push(this.parseExpr());
        }
        this.expect("symbol", ")");
        return args;
    }

    parseTable() {
        this.expect("symbol", "{");
        const items = [];
        while (!(this.type() === "symbol" && this.value() === "}")) {
            if (this.type() === "eof") this.error("unfinished table constructor");
            if (this.type() === "symbol" && this.value() === "[") {
                this.next();
                const key = this.parseExpr();
                this.expect("symbol", "]");
                this.expect("symbol", "=");
                items.push({ key, value: this.parseExpr() });
            } else if (this.type() === "name" && this.toks[this.i + 1] && this.toks[this.i + 1].type === "symbol" && this.toks[this.i + 1].value === "=") {
                const key = this.next().value;
                this.next();
                items.push({ key: { t: "str", v: key }, value: this.parseExpr() });
            } else {
                items.push({ key: null, value: this.parseExpr() });
            }
            if (!(this.accept("symbol", ",") || this.accept("symbol", ";"))) break;
        }
        this.expect("symbol", "}");
        return { t: "table", items };
    }
}

function parse(tokens) {
    return new Parser(tokens).parseChunk();
}

module.exports = { parse, PREC, RIGHT_ASSOC };
