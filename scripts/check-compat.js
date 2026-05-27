#!/usr/bin/env node
/**
 * VendroidEnhanced — Plugin Compatibility Checker
 *
 * Validates every plugin in vencord-plugins/ before it gets copied
 * into the Vencord source tree for building.
 *
 * Checks performed:
 *   1. Has an index file (index.ts / index.tsx / index.js)
 *   2. Has a default export that uses definePlugin()
 *   3. definePlugin() call contains name, description, authors
 *   4. No import paths that Vencord definitely doesn't expose
 *   5. Plugin name doesn't collide with an existing official plugin
 *   6. TypeScript compile check (via tsc --noEmit) using Vencord's tsconfig
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ─── Paths (resolved from repo root) ─────────────────────────────────────────
const REPO_ROOT    = path.resolve(__dirname, "..");
const PLUGINS_DIR  = path.join(REPO_ROOT, "vencord-plugins");
const VENCORD_SRC  = process.env.VENCORD_SRC || path.join(REPO_ROOT, ".vencord-build", "Vencord", "src");

// ─── Known-good Vencord module prefixes ───────────────────────────────────────
const VALID_MODULE_PREFIXES = [
    "@api/",
    "@utils/",
    "@webpack/common",
    "@webpack",
    "discord-types",
    "react",
    "react-dom",
];

// ─── Colours ──────────────────────────────────────────────────────────────────
const C = {
    red:    s => `\x1b[31m${s}\x1b[0m`,
    yellow: s => `\x1b[33m${s}\x1b[0m`,
    green:  s => `\x1b[32m${s}\x1b[0m`,
    bold:   s => `\x1b[1m${s}\x1b[0m`,
    dim:    s => `\x1b[2m${s}\x1b[0m`,
};

// ─── Get official plugin names from the Vencord src ───────────────────────────
function getOfficialPluginNames() {
    const officialDir = path.join(VENCORD_SRC, "plugins");
    if (!fs.existsSync(officialDir)) return new Set();
    return new Set(
        fs.readdirSync(officialDir, { withFileTypes: true })
            .filter(d => d.isDirectory() || d.name.endsWith(".ts") || d.name.endsWith(".tsx"))
            .map(d => d.name.replace(/\.(ts|tsx)$/, "").toLowerCase())
    );
}

// ─── Extract a string value from definePlugin({...}) via regex ───────────────
function extractField(src, field) {
    const re = new RegExp(`\\b${field}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`);
    const m  = src.match(re);
    return m ? m[1] : null;
}

// ─── Check one plugin directory ───────────────────────────────────────────────
function checkPlugin(pluginDir, officialNames) {
    const name    = path.basename(pluginDir);
    const errors  = [];
    const warnings = [];

    // 1. Find index file
    const candidates = ["index.tsx", "index.ts", "index.js"];
    const indexFile  = candidates.map(f => path.join(pluginDir, f)).find(fs.existsSync);
    if (!indexFile) {
        errors.push("No index.ts / index.tsx / index.js found");
        return { name, errors, warnings };
    }

    const src = fs.readFileSync(indexFile, "utf-8");

    // 2. definePlugin export
    if (!src.includes("definePlugin")) {
        errors.push("Plugin must have a definePlugin() call");
    }

    // 3. Required definePlugin fields
    const pluginName = extractField(src, "name");
    if (!pluginName)                          errors.push("definePlugin is missing a `name` field");
    if (!extractField(src, "description"))    errors.push("definePlugin is missing a `description` field");
    if (!src.includes("authors"))             errors.push("definePlugin is missing an `authors` field");

    // 4. Validate imports
    const importRe = /^import\s+.*?from\s+['"]([^'"]+)['"]/gm;
    let m;
    while ((m = importRe.exec(src)) !== null) {
        const mod = m[1];
        if (mod.startsWith(".")) continue;                              // relative — fine
        const valid = VALID_MODULE_PREFIXES.some(p => mod.startsWith(p));
        if (!valid) warnings.push(`Unrecognised import path: "${mod}" — may cause build failure`);
    }

    // 5. Name collision with official plugins
    if (pluginName && officialNames.has(pluginName.toLowerCase())) {
        errors.push(`Plugin name "${pluginName}" collides with an official Vencord plugin`);
    }

    // 6. Directory name must be a valid JS identifier
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
        warnings.push(`Plugin directory name "${name}" is not a valid JS identifier — rename it`);
    }

    return { name, errors, warnings, indexFile };
}

// ─── TypeScript compile check via Vencord's tsconfig ─────────────────────────
function typeCheck(pluginDir, vencordRoot) {
    const tsconfigPath = path.join(vencordRoot, "tsconfig.json");
    if (!fs.existsSync(tsconfigPath)) {
        return { skipped: true, reason: "Vencord tsconfig not found, skipping type check" };
    }

    // Temporarily copy plugin into vencord src/plugins so tsc can resolve paths
    const targetDir = path.join(vencordRoot, "src", "plugins", "_compat_check_" + path.basename(pluginDir));
    try {
        fs.cpSync(pluginDir, targetDir, { recursive: true });

        execSync(
            `npx tsc --noEmit --project "${tsconfigPath}" 2>&1`,
            { cwd: vencordRoot, stdio: "pipe" }
        );
        return { ok: true };
    } catch (e) {
        const out = e.stdout?.toString() || e.stderr?.toString() || "";
        // Filter to only errors from our plugin file
        const relevant = out
            .split("\n")
            .filter(l => l.includes("_compat_check_"))
            .join("\n");
        return { ok: false, output: relevant || out.slice(0, 800) };
    } finally {
        if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true });
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
    console.log(C.bold("\n🔍 VendroidEnhanced Plugin Compatibility Check\n"));

    if (!fs.existsSync(PLUGINS_DIR)) {
        console.log(C.dim("  No vencord-plugins/ directory found — nothing to check.\n"));
        process.exit(0);
    }

    const dirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => path.join(PLUGINS_DIR, d.name));

    if (!dirs.length) {
        console.log(C.dim("  vencord-plugins/ is empty — nothing to check.\n"));
        process.exit(0);
    }

    const officialNames = getOfficialPluginNames();
    const vencordRoot   = path.dirname(VENCORD_SRC); // one level up from src/

    let totalErrors   = 0;
    let totalWarnings = 0;

    for (const dir of dirs) {
        const { name, errors, warnings, indexFile } = checkPlugin(dir, officialNames);
        const prefix = `  📦 ${C.bold(name)}`;

        if (!errors.length && !warnings.length) {
            // Type-check only if structural checks passed and Vencord is available
            let tsResult = { skipped: false };
            if (indexFile && fs.existsSync(vencordRoot)) {
                tsResult = typeCheck(dir, vencordRoot);
            }

            if (tsResult.ok === false) {
                console.log(`${prefix}  ${C.red("✗ TypeScript errors")}`);
                console.log(C.red(tsResult.output.split("\n").map(l => "      " + l).join("\n")));
                totalErrors++;
            } else {
                const note = tsResult.skipped
                    ? C.dim(` (${tsResult.reason})`)
                    : "";
                console.log(`${prefix}  ${C.green("✓ OK")}${note}`);
            }
        } else {
            if (errors.length) {
                console.log(`${prefix}  ${C.red("✗ ERRORS:")}`);
                errors.forEach(e => console.log(C.red(`      ✗ ${e}`)));
                totalErrors += errors.length;
            }
            if (warnings.length) {
                console.log(`${prefix}  ${C.yellow("⚠ WARNINGS:")}`);
                warnings.forEach(w => console.log(C.yellow(`      ⚠ ${w}`)));
                totalWarnings += warnings.length;
            }
        }
    }

    console.log("");

    if (totalErrors > 0) {
        console.log(C.red(`  ✗ ${totalErrors} error(s) found — fix them before building.\n`));
        process.exit(1);
    }

    if (totalWarnings > 0) {
        console.log(C.yellow(`  ⚠ ${totalWarnings} warning(s) — build will continue.\n`));
    } else {
        console.log(C.green("  ✓ All plugins passed.\n"));
    }

    process.exit(0);
}

main();
