
"use strict";

function analyzeVM(chunk, stats) {
    const dispatchLoops = [];
    const pools = [];
    (function walk(n) {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (n.t === "table" && n.items && n.items.length >= 64) {
            let allNum = true;
            let sum = 0;
            for (const it of n.items) {
                if (it.key !== null || it.value.t !== "num") { allNum = false; break; }
                sum = (sum + it.value.v) >>> 0;
            }
            if (allNum) {
                pools.push({
                    size: n.items.length,
                    sample: n.items.slice(0, 16).map(it => it.value.v),
                    checksum: sum
                });
            }
        }
        if ((n.t === "while" || n.t === "fornum") && Array.isArray(n.body) && n.body.length > 0) {
            const first = n.body[0];
            if (first && first.t === "if") {
                const branches = 1 + (first.elifs ? first.elifs.length : 0) + (first.elseBody ? 1 : 0);
                if (branches >= 4) dispatchLoops.push({ kind: n.t, branches: branches });
            }
        }
        for (const k of Object.keys(n)) {
            if (k === "line") continue;
            const v = n[k];
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === "object") walk(v);
        }
    })(chunk.body);
    stats.vmDispatch = dispatchLoops;
    stats.vmPools = pools;
    return stats;
}

module.exports = { analyzeVM };
