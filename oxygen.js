#!/usr/bin/env node
"use strict";

let dotenv;
try { dotenv = require("dotenv"); dotenv.config(); } catch (_) {}

const fs = require("fs");
const path = require("path");
const { deobfuscate } = require("./src/pipeline");
const { withWatermark, ensureSource, guardRun } = require("./src/guard");

function parseArgs(argv) {
    const args = { input: null, output: null, report: false, maxMB: Number(process.env.MAX_FILE_MB || 32) };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "-o" || a === "--output") args.output = argv[++i];
        else if (a === "--report") args.report = true;
        else if (a === "--max-mb") args.maxMB = Number(argv[++i]) || 32;
        else if (a === "-h" || a === "--help") args.help = true;
        else if (!a.startsWith("-") && args.input === null) args.input = a;
    }
    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || args.input === null) {
        console.log("usage: node oxygen.js <input.lua> [-o output.lua] [--report] [--max-mb N]");
        process.exit(args.help ? 0 : 1);
    }
    if (!fs.existsSync(args.input)) {
        console.error("file not found: " + args.input);
        process.exit(1);
    }
    const source = fs.readFileSync(args.input, "utf8");
    try {
        ensureSource(source, args.maxMB);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
    const res = guardRun(function () { return deobfuscate(source); });
    if (!res.ok) {
        console.error("deobfuscation failed: " + res.error);
        process.exit(2);
    }
    const out = withWatermark(res.result.code);
    let outPath = args.output;
    if (!outPath) {
        const dir = path.dirname(args.input);
        const base = path.basename(args.input, path.extname(args.input));
        outPath = path.join(dir, base + ".oxygen.lua");
    }
    fs.writeFileSync(outPath, out, "utf8");
    const s = res.result.stats;
    console.log("written         : " + outPath);
    console.log("strings decoded : " + s.stringsDecoded);
    console.log("tables decoded  : " + s.tablesDecoded);
    console.log("constants folded: " + s.constantsFolded);
    console.log("branches pruned : " + s.branchesPruned);
    console.log("loops reshaped  : " + s.loopsReshaped);
    console.log("vm dispatch hits: " + s.vmDispatch.length);
    console.log("bytecode pools  : " + s.vmPools.length);
    if (args.report) {
        const rp = outPath.replace(/\.lua$/i, "") + ".report.json";
        fs.writeFileSync(rp, JSON.stringify({ stats: s }, null, 2), "utf8");
        console.log("report          : " + rp);
    }
    process.exit(0);
}

main();
