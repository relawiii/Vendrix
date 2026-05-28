#!/usr/bin/env bash
# =============================================================================
#  Vendrix — Vencord Compatibility Patches
#
#  Run after `pnpm install` but before `pnpm buildWeb` inside VENCORD_DIR.
#  Injects:
#    1. EquicordDevs shim into src/utils/constants.ts
#    2. managedStyle Vite plugin (handles `?managed` CSS imports)
#    3. AudioPlayer additions (createAudioPlayer, defaultAudioNames, AudioPlayerInterface)
#
#  Usage (called automatically by build-vencord.sh):
#    VENCORD_DIR=/path/to/Vencord bash apply-patches.sh
# =============================================================================
set -euo pipefail

VENCORD_DIR="${VENCORD_DIR:?VENCORD_DIR must be set}"
PATCHES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}${BOLD}[patch]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[patch ✓]${RESET} $*"; }
die()     { echo -e "${RED}${BOLD}[patch ✗]${RESET} $*" >&2; exit 1; }

# ─── 1. EquicordDevs shim ─────────────────────────────────────────────────────
info "Injecting EquicordDevs shim into @utils/constants..."

CONSTANTS="$VENCORD_DIR/src/utils/constants.ts"
[[ -f "$CONSTANTS" ]] || die "constants.ts not found at $CONSTANTS"

# Only inject once
if ! grep -q "EquicordDevs" "$CONSTANTS"; then
    cat >> "$CONSTANTS" << 'EOF'

// ── Vendrix: EquicordDevs shim ─────────────────────────────────────────────
// Provides a minimal EquicordDevs map so Equicord plugins compile on vanilla Vencord.
// Entries are looked up from Devs first; unknown authors fall back to a placeholder.
import type { Dev } from "./types";

function makeEquicordDev(name: string, id: bigint = 0n): Dev {
    return { name, id };
}

export const EquicordDevs = new Proxy({} as Record<string, Dev>, {
    get(_, prop: string): Dev {
        // Try to find in vanilla Devs by name match first
        const match = Object.values(Devs).find(d => d.name === prop);
        return match ?? makeEquicordDev(prop);
    }
}) as Record<string, Dev> & {
    Etorix: Dev;
    [key: string]: Dev;
};

// Explicit known entries (add more as needed)
(EquicordDevs as any).Etorix = makeEquicordDev("Etorix");
EOF
    success "EquicordDevs shim injected"
else
    info "EquicordDevs already present, skipping"
fi

# ─── 2. managedStyle Vite plugin ──────────────────────────────────────────────
info "Injecting managedStyle Vite plugin..."

VITE_CONFIG="$VENCORD_DIR/browser.vite.config.mts"
# Also try the web config
[[ -f "$VITE_CONFIG" ]] || VITE_CONFIG="$VENCORD_DIR/vite.config.mts"
[[ -f "$VITE_CONFIG" ]] || VITE_CONFIG=$(find "$VENCORD_DIR" -maxdepth 2 -name "*.vite.config.*" | head -1)
[[ -f "$VITE_CONFIG" ]] || die "Could not find a Vite config in $VENCORD_DIR"

info "  Found Vite config: $VITE_CONFIG"

# Write the managed style plugin file
cat > "$VENCORD_DIR/scripts/vite/managedStylePlugin.mts" << 'EOF'
/**
 * Vendrix: managedStyle Vite Plugin
 *
 * Handles the `?managed` suffix on CSS imports used by Equicord plugins.
 * Instead of inlining the CSS at build time, it returns a ManagedStyle object
 * with enable() / disable() methods that inject/remove a <style> tag at runtime.
 *
 * Usage in plugin:
 *   import managedStyle from "./styles.css?managed";
 *   // In definePlugin: { managedStyle, ... }
 *   // Vencord's plugin loader calls managedStyle.enable() on start, .disable() on stop
 */

import type { Plugin } from "vite";
import { readFileSync } from "fs";

export function managedStylePlugin(): Plugin {
    return {
        name: "vendrix:managed-style",
        enforce: "pre",

        load(id: string) {
            if (!id.endsWith("?managed")) return;

            const realPath = id.slice(0, -"?managed".length);
            let css = "";
            try {
                css = readFileSync(realPath, "utf-8");
            } catch {
                // File not found — return empty managed style
            }

            // Escape for JS string embedding
            const escaped = css
                .replace(/\\/g, "\\\\")
                .replace(/`/g, "\\`")
                .replace(/\$\{/g, "\\${");

            return `
const css = \`${escaped}\`;
let styleEl = null;

const managedStyle = {
    css,
    enable() {
        if (styleEl) return;
        styleEl = document.createElement("style");
        styleEl.textContent = css;
        styleEl.setAttribute("data-managed-plugin", "true");
        document.head.appendChild(styleEl);
    },
    disable() {
        if (!styleEl) return;
        styleEl.remove();
        styleEl = null;
    }
};

export default managedStyle;
`;
        },

        resolveId(id: string) {
            if (id.endsWith("?managed")) {
                // Strip query so Vite resolves the file path normally, then we handle in load()
                return id;
            }
        }
    };
}
EOF

# Inject the plugin into the Vite config if not already present
if ! grep -q "managedStylePlugin\|vendrix:managed-style" "$VITE_CONFIG"; then
    # Insert after the first `plugins: [` or before the closing `]` of plugins array
    node << JSEOF
const fs = require("fs");
const path = "$VITE_CONFIG";
let src = fs.readFileSync(path, "utf-8");

// Add import at the top
const importLine = 'import { managedStylePlugin } from "./scripts/vite/managedStylePlugin.mjs";\n';
if (!src.includes("managedStylePlugin")) {
    src = importLine + src;
}

// Inject into plugins array — find 'plugins: [' and add after it
src = src.replace(/(plugins\s*:\s*\[)/, "\$1\n        managedStylePlugin(),");

fs.writeFileSync(path, src, "utf-8");
console.log("Vite config patched");
JSEOF
    success "managedStyle Vite plugin injected into $VITE_CONFIG"
else
    info "managedStyle plugin already present, skipping"
fi

# ─── 3. AudioPlayer additions ─────────────────────────────────────────────────
info "Patching AudioPlayer API with createAudioPlayer, defaultAudioNames, AudioPlayerInterface..."

AUDIO_PLAYER="$VENCORD_DIR/src/api/AudioPlayer.ts"
[[ -f "$AUDIO_PLAYER" ]] || die "AudioPlayer.ts not found at $AUDIO_PLAYER"

if ! grep -q "createAudioPlayer\|AudioPlayerInterface" "$AUDIO_PLAYER"; then
    # Read existing file to understand what playAudio looks like
    EXISTING=$(cat "$AUDIO_PLAYER")

    cat >> "$AUDIO_PLAYER" << 'EOF'

// ── Vendrix: Equicord AudioPlayer extensions ───────────────────────────────
// Adds createAudioPlayer, defaultAudioNames, and AudioPlayerInterface so that
// Equicord plugins that use the richer AudioPlayer API compile on vanilla Vencord.

export interface AudioPlayerInterface {
    play(): void;
    stop(): void;
    readonly sound: string;
}

/**
 * Known Discord notification sound names.
 * This list covers the sounds available via playAudio() in vanilla Vencord.
 */
const KNOWN_AUDIO_NAMES = [
    "bop_message1",
    "bop_message2",
    "bop_message3",
    "call_calling",
    "call_ringing",
    "call_ringing_beat",
    "deafen",
    "discodo",
    "disconnect",
    "high_five",
    "human_man",
    "interact",
    "in_call_text_message",
    "mention1",
    "mention2",
    "mention3",
    "mute",
    "navigation_backdrop_1",
    "navigation_backdrop_2",
    "overlapping_boop",
    "outgoing_ring",
    "ptt_start",
    "ptt_stop",
    "reconnect",
    "request_to_speak",
    "stream_started",
    "stream_user_joined",
    "stream_user_left",
    "subtle_1",
    "subtle_2",
    "undeafen",
    "unmute",
    "vibing_wumpus",
    "window_open",
    "window_close",
    "wumpus_tune",
] as const;

/**
 * Returns the list of all known Discord audio notification sound names.
 * Used to populate sound picker dropdowns.
 */
export function defaultAudioNames(): string[] {
    return [...KNOWN_AUDIO_NAMES];
}

export interface CreateAudioPlayerOptions {
    volume?: number;
    /** Called when the sound finishes playing naturally (not when stopped manually). */
    onEnded?: () => void;
}

/**
 * Creates a controllable audio player for a given sound name.
 * Wraps playAudio() with play/stop lifecycle management.
 */
export function createAudioPlayer(sound: string, options: CreateAudioPlayerOptions = {}): AudioPlayerInterface {
    let stopped = false;
    let resolvePlay: (() => void) | null = null;

    return {
        sound,
        play() {
            if (stopped) return;
            playAudio(sound, {
                volume: options.volume ?? 100,
            }).then(() => {
                if (!stopped) {
                    options.onEnded?.();
                }
                resolvePlay?.();
            }).catch(() => {
                resolvePlay?.();
            });
        },
        stop() {
            stopped = true;
            resolvePlay?.();
            // playAudio doesn't expose a cancel API in vanilla Vencord,
            // so we just mark as stopped and suppress the onEnded callback.
        }
    };
}
EOF
    success "AudioPlayer extensions injected"
else
    info "AudioPlayer extensions already present, skipping"
fi

echo ""
echo -e "${GREEN}${BOLD}All Vendrix patches applied successfully.${RESET}"
