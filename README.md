# clyde-deobf
# Oxygen Deobf

Static Luau deobfuscator — the input script is never executed, everything is rebuilt statically.

## what it does
- recovers string tables + their decoder functions (direct indexing, and byte loops: XOR / ADD / SUB)
- folds constants with a safe symbolic evaluator (string / bit32 / math / table / tostring / tonumber / type / format)
- prunes dead branches and unflattens control flow (`while true do ... if c then break end end` -> `repeat ... until c`)
- detects VM dispatch loops and bytecode pools and reports them

## cli
    npm install
    node oxygen.js input.lua -o clean.lua --report

## discord bot
fill .env (copy from .env.example), first run with REGISTER_COMMANDS=true:
    npm run bot

then use the /deobfuscate slash command with a .lua attachment.
discord:https://discord.gg/UyqEkAWng
## license
MIT
