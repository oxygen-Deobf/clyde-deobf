
"use strict";

let dotenv;
try { dotenv = require("dotenv"); dotenv.config(); } catch (_) {}

const https = require("https");
const { deobfuscate } = require("../src/pipeline");
const { withWatermark, ensureSource, guardRun } = require("../src/guard");
const { buildCommands, registerCommands } = require("./intents");

function download(url, limit) {
    return new Promise(function (resolve, reject) {
        https.get(url, function (res) {
            if (res.statusCode !== 200) {
                reject(new Error("download failed: HTTP " + res.statusCode));
                res.resume();
                return;
            }
            const chunks = [];
            let size = 0;
            res.on("data", function (c) {
                size += c.length;
                if (size > limit) {
                    reject(new Error("file too large"));
                    res.destroy();
                    return;
                }
                chunks.push(c);
            });
            res.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
            res.on("error", reject);
        }).on("error", reject);
    });
}

async function main() {
    const { Client, GatewayIntentBits, REST, Routes, AttachmentBuilder } = require("discord.js");
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error("missing DISCORD_TOKEN in .env");
        process.exit(1);
    }
    const clientId = process.env.CLIENT_ID || null;
    const guildId = process.env.GUILD_ID || null;
    const maxMB = Number(process.env.MAX_FILE_MB || 8);

    if (String(process.env.REGISTER_COMMANDS).toLowerCase() === "true" && clientId) {
        const rest = new REST({ version: "10" }).setToken(token);
        await registerCommands(rest, Routes, clientId, guildId, buildCommands());
        console.log("slash commands registered");
    }

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once("ready", function () {
        console.log("oxygen deobf online: " + client.user.tag);
    });

    client.on("interactionCreate", async function (interaction) {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== "deobfuscate") return;
        try {
            await interaction.deferReply();
            const att = interaction.options.getAttachment("file");
            const wantReport = interaction.options.getBoolean("report") || false;
            if (!att) throw new Error("no file attached");
            if (!/\.lua(u)?$/i.test(att.name) && !att.name.endsWith(".txt")) throw new Error("only .lua files are supported");
            const source = await download(att.url, maxMB * 1024 * 1024);
            ensureSource(source, maxMB);
            const res = guardRun(function () { return deobfuscate(source); });
            if (!res.ok) throw new Error(res.error);
            const out = withWatermark(res.result.code);
            const cleanName = att.name.replace(/\.lua(u)?$/i, "") + ".oxygen.lua";
            const files = [new AttachmentBuilder(Buffer.from(out, "utf8"), { name: cleanName })];
            if (wantReport) {
                files.push(new AttachmentBuilder(Buffer.from(JSON.stringify(res.result.stats, null, 2), "utf8"), { name: "report.json" }));
            }
            const s = res.result.stats;
            await interaction.editReply({
                content: "strings decoded: " + s.stringsDecoded +
                    " | constants folded: " + s.constantsFolded +
                    " | branches pruned: " + s.branchesPruned +
                    " | loops reshaped: " + s.loopsReshaped +
                    " | pools: " + s.vmPools.length,
                files: files
            });
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            try {
                if (interaction.deferred || interaction.replied) await interaction.editReply({ content: "failed: " + msg });
                else await interaction.reply({ content: "failed: " + msg, ephemeral: true });
            } catch (_) {}
        }
    });

    client.login(token);
}

main().catch(function (err) {
    console.error(err);
    process.exit(1);
});
