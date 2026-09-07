
"use strict";

const { tokenize } = require("./lexer");
const { parse } = require("./parser");
const { unscrambleTables } = require("./unscramble");
const { foldConstants } = require("./fold");
const { reshapeFlow } = require("./rebranch");
const { analyzeVM } = require("./vmhunt");
const { paint } = require("./painter");

function deobfuscate(source, opts) {
    opts = opts || {};
    const stats = {
        stringsDecoded: 0,
        tablesDecoded: 0,
        constantsFolded: 0,
        branchesPruned: 0,
        loopsReshaped: 0,
        branchesInverted: 0,
        blocksDropped: 0,
        vmDispatch: [],
        vmPools: []
    };
    const t0 = Date.now();
    const tokens = tokenize(source);
    let ast = parse(tokens);
    analyzeVM(ast, stats);
    ast = unscrambleTables(ast, stats);
    ast = foldConstants(ast, stats);
    ast = reshapeFlow(ast, stats);
    ast = foldConstants(ast, stats);
    const code = paint(ast);
    stats.elapsedMs = Date.now() - t0;
    return { code: code, stats: stats };
}

module.exports = { deobfuscate };
