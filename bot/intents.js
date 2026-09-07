
"use strict";

const { SlashCommandBuilder } = require("discord.js");

function buildCommands() {
    const cmd = new SlashCommandBuilder()
        .setName("deobfuscate")
        .setDescription("Deobfuscate a Luau script with Oxygen Deobf")
        .addAttachmentOption(o => o.setName("file").setDescription("obfuscated .lua file").setRequired(true))
        .addBooleanOption(o => o.setName("report").setDescription("attach analysis report").setRequired(false));
    return [cmd.toJSON()];
}

async function registerCommands(rest, routes, clientId, guildId, commands) {
    if (guildId) {
        return rest.put(routes.applicationGuildCommands(clientId, guildId), { body: commands });
    }
    return rest.put(routes.applicationCommands(clientId), { body: commands });
}

module.exports = { buildCommands, registerCommands };
