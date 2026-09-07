"use strict";

const KEYWORDS = new Set([
    "and", "break", "continue", "do", "else", "elseif", "end", "false",
    "for", "function", "if", "in", "local", "nil", "not", "or", "repeat",
    "return", "then", "true", "until", "while"
]);

const MULTI = ["...", "..=", "//=", "==", "~=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "^=", "..", "//", "<<", ">>", "::"];
const SINGLE = new Set("+-*/%^#&|~<>=(){}[];:,".split(""));

const ESCAPES = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", '"': '"', "'": "'" };

function isDigit(c) { return c >= "0" && c <= "9"; }
function isIdentStart(c) { return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"; }
function isIdentPart(c) { return isIdentStart(c) || isDigit(c); }

class Lexer {
    constructor(src) {
        this.src = src;
        this.pos = 0;
        this.line = 1;
        this.col = 1;
        this.tokens = [];
    }

    atEnd() { return this.pos >= this.src.length; }
    peek(off) { return this.src[this.pos + (off || 0)] || ""; }

    advance() {
        const c = this.src[this.pos++];
        if (c === "\n") { this.line += 1; this.col = 1; } else { this.col += 1; }
        return c;
    }

    fail(msg) {
        const err = new Error(`Lexer error at line ${this.line}: ${msg}`);
        err.line = this.line;
        throw err;
    }

    emit(type, value, raw, line) {
        this.tokens.push({ type, value, raw: raw !== undefined ? raw : String(value), line: line !== undefined ? line : this.line });
    }

    readLongBracketLevel() {
        let level = 0;
        while (this.peek(level + 1) === "=") level++;
        return this.peek(level + 1) === "[" ? level + 1 : -1;
    }

    skipLongComment() {
        this.advance();
        this.advance();
        const lvl = this.readLongBracketLevel();
        for (let i = 0; i < lvl; i++) this.advance();
        this.advance();
        this.readLongString(lvl, true);
    }

    readLongString(lvl, isComment) {
        const startLine = this.line;
        if (this.peek() === "\n" || (this.peek() === "\r" && this.peek(1) === "\n")) {
            if (this.peek() === "\r") this.advance();
            this.advance();
        }
        let content = "";
        while (!this.atEnd()) {
            if (this.peek() === "]" && this.matchClose(lvl)) {
                for (let i = 0; i < lvl + 2; i++) this.advance();
                return { value: content, line: startLine };
            }
            content += this.advance();
        }
        this.fail("unterminated long " + (isComment ? "comment" : "string"));
    }

    matchClose(lvl) {
        for (let i = 0; i < lvl; i++) if (this.peek(1 + i) !== "=") return false;
        return this.peek(1 + lvl) === "]";
    }

    readString(quote) {
        const startLine = this.line;
        let raw = this.advance();
        let value = "";
        while (!this.atEnd()) {
            const c = this.peek();
            if (c === quote) { raw += this.advance(); this.emit("string", value, raw, startLine); return; }
            if (c === "\n") this.fail("unfinished string");
            if (c === "\\") {
                raw += this.advance();
                const e = this.peek();
                if (e === "\n") { raw += this.advance(); continue; }
                if (e === "z") { raw += this.advance(); while (/\s/.test(this.peek())) raw += this.advance(); continue; }
                if (e === "x") {
                    raw += this.advance();
                    let h = "";
                    while (/[0-9a-fA-F]/.test(this.peek()) && h.length < 2) h += this.advance();
                    if (!h) this.fail("hexadecimal digit expected");
                    raw += h;
                    value += String.fromCharCode(parseInt(h, 16));
                    continue;
                }
                if (e === "u") {
                    raw += this.advance();
                    if (this.peek() !== "{") this.fail("missing '{' in \\u{xxxx}");
                    raw += this.advance();
                    let h = "";
                    while (/[0-9a-fA-F]/.test(this.peek())) h += this.advance();
                    if (this.peek() !== "}") this.fail("missing '}' in \\u{xxxx}");
                    raw += this.advance();
                    raw += h;
                    value += String.fromCodePoint(parseInt(h, 16));
                    continue;
                }
                if (isDigit(e)) {
                    let d = "";
                    while (isDigit(this.peek()) && d.length < 3) d += this.advance();
                    raw += d;
                    value += String.fromCharCode(parseInt(d, 10) & 0xff);
                    continue;
                }
                if (ESCAPES[e] !== undefined) { raw += this.advance(); value += ESCAPES[e]; continue; }
                raw += this.advance();
                value += e;
                continue;
            }
            raw += this.advance();
            value += c;
        }
        this.fail("unfinished string");
    }

    readNumber() {
        const startLine = this.line;
        let raw = "";
        if (this.peek() === "0" && (this.peek(1) === "x" || this.peek(1) === "X")) {
            raw += this.advance() + this.advance();
            while (/[0-9a-fA-F]/.test(this.peek())) raw += this.advance();
            if (this.peek() === "." && /[0-9a-fA-F]/.test(this.peek(1))) {
                raw += this.advance();
                while (/[0-9a-fA-F]/.test(this.peek())) raw += this.advance();
            }
            if (this.peek() === "p" || this.peek() === "P") {
                raw += this.advance();
                if (this.peek() === "+" || this.peek() === "-") raw += this.advance();
                while (isDigit(this.peek())) raw += this.advance();
            }
            this.emit("number", parseInt(raw, 16), raw, startLine);
            return;
        }
        while (isDigit(this.peek()) || (this.peek() === "_" && isDigit(this.peek(-1)) && isDigit(this.peek(1)))) raw += this.advance();
        if (this.peek() === "." && this.peek(1) !== ".") {
            raw += this.advance();
            while (isDigit(this.peek())) raw += this.advance();
        }
        if (this.peek() === "e" || this.peek() === "E") {
            const save = this.pos;
            let r2 = raw + this.advance();
            if (this.peek() === "+" || this.peek() === "-") r2 += this.advance();
            if (isDigit(this.peek())) { while (isDigit(this.peek())) r2 += this.advance(); raw = r2; }
            else this.pos = save;
        }
        this.emit("number", Number(raw), raw, startLine);
    }

    run() {
        while (!this.atEnd()) {
            const c = this.peek();
            if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\v" || c === "\f" || c.charCodeAt(0) === 0 || c.charCodeAt(0) === 65533 || c.charCodeAt(0) === 0xFEFF || (c >= "\u0000" && c <= "\u001F" && c !== "\n" && c !== "\t" && c !== "\r")) { this.advance(); continue; }
            if (c === "-" && this.peek(1) === "-") {
                if (this.peek(2) === "[") {
                    const save = this.pos;
                    let k = 0;
                    while (this.peek(3 + k) === "=") k++;
                    if (this.peek(3 + k) === "[") { this.pos = save; this.skipLongComment(); continue; }
                }
                while (!this.atEnd() && this.peek() !== "\n") this.advance();
                continue;
            }
            if (c === '"' || c === "'") { this.readString(c); continue; }
            if (c === "`") {
                const startLine = this.line;
                let raw = this.advance();
                let value = "";
                while (!this.atEnd() && this.peek() !== "`") { const ch = this.advance(); raw += ch; value += ch; }
                if (this.atEnd()) this.fail("unfinished interpolated string");
                raw += this.advance();
                this.emit("istring", value, raw, startLine);
                continue;
            }
            if (c === "[") {
                const lvl = this.readLongBracketLevel();
                if (lvl > 0) {
                    const startLine = this.line;
                    for (let i = 0; i < lvl + 1; i++) this.advance();
                    const res = this.readLongString(lvl - 1, false);
                    this.emit("string", res.value, "[" + "=".repeat(lvl - 1) + "[" + res.value + "]" + "=".repeat(lvl - 1) + "]", startLine);
                    continue;
                }
            }
            if (isDigit(c) || (c === "." && isDigit(this.peek(1)))) { this.readNumber(); continue; }
            if (isIdentStart(c)) {
                const line = this.line;
                let word = "";
                while (isIdentPart(this.peek())) word += this.advance();
                if (KEYWORDS.has(word)) this.emit("keyword", word, word, line);
                else this.emit("name", word, word, line);
                continue;
            }
            let matched = false;
            for (const m of MULTI) {
                if (this.src.startsWith(m, this.pos)) {
                    for (let i = 0; i < m.length; i++) this.advance();
                    this.emit("symbol", m, m);
                    matched = true;
                    break;
                }
            }
            if (matched) continue;
            if (SINGLE.has(c)) { this.advance(); this.emit("symbol", c, c); continue; }
            this.fail(`unexpected character '${c}'`);
        }
        this.tokens.push({ type: "eof", value: "<eof>", raw: "<eof>", line: this.line });
        return this.tokens;
    }
}

function tokenize(source) {
    return new Lexer(String(source)).run();
}

module.exports = { tokenize, KEYWORDS };
