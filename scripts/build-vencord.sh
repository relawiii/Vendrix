#!/usr/bin/env bash
# =============================================================================
#  VendroidEnhanced — Vencord Build Script
#
#  1. Pulls the latest official Vencord repo
#  2. Runs the compatibility checker on every plugin in vencord-plugins/
#  3. Copies those plugins into Vencord's src/plugins/
#  4. Builds Vencord (browser bundle)
#  5. Writes the output to app/src/main/res/raw/vencord_bundle.js
#
#  Usage:
#    ./scripts/build-vencord.sh            # normal build
#    ./scripts/build-vencord.sh --no-cache # force re-clone
#    ./scripts/build-vencord.sh --skip-ts  # skip TypeScript type check (faster)
# =============================================================================
set -euo pipefail

# ─── Args ─────────────────────────────────────────────────────────────────────
NO_CACHE=false
SKIP_TS=false
for arg in "$@"; do
    case "$arg" in
        --no-cache) NO_CACHE=true ;;
        --skip-ts)  SKIP_TS=true  ;;
    esac
done

# ─── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$REPO_ROOT/.vencord-build"
VENCORD_DIR="$BUILD_DIR/Vencord"
PLUGINS_SRC="$REPO_ROOT/vencord-plugins"
OUTPUT_FILE="$REPO_ROOT/app/src/main/res/raw/vencord_bundle.js"

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[0;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}${BOLD}▸${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}⚠${RESET} $*"; }
die()     { echo -e "${RED}${BOLD}✗${RESET} $*" >&2; exit 1; }

echo -e "\n${BOLD}=== VendroidEnhanced — Vencord Build ===${RESET}\n"

# ─── Dependency checks ────────────────────────────────────────────────────────
info "Checking dependencies..."

command -v node  &>/dev/null || die "node is required (install via nvm or apt)"
command -v pnpm  &>/dev/null || die "pnpm is required (npm install -g pnpm)"
command -v git   &>/dev/null || die "git is required"

NODE_VER=$(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null && echo "ok" || echo "old")
if [[ "$NODE_VER" == "old" ]]; then
    die "Node.js 18+ required (current: $(node --version))"
fi

success "Dependencies OK"

# ─── Clone or update Vencord ─────────────────────────────────────────────────
mkdir -p "$BUILD_DIR"

if [[ "$NO_CACHE" == "true" && -d "$VENCORD_DIR" ]]; then
    info "Removing cached Vencord (--no-cache)..."
    rm -rf "$VENCORD_DIR"
fi

if [[ ! -d "$VENCORD_DIR/.git" ]]; then
    info "Cloning Vencord (latest main)..."
    git clone --depth=1 https://github.com/Vendicated/Vencord "$VENCORD_DIR"
else
    info "Updating Vencord to latest..."
    cd "$VENCORD_DIR"
    git fetch --depth=1 origin main
    git reset --hard origin/main
fi

VENCORD_COMMIT=$(git -C "$VENCORD_DIR" rev-parse --short HEAD)
success "Vencord @ $VENCORD_COMMIT"

# ─── Install Vencord dependencies ─────────────────────────────────────────────
info "Installing Vencord dependencies..."
cd "$VENCORD_DIR"
pnpm install --frozen-lockfile --silent
success "Dependencies installed"

# ─── Compatibility check ──────────────────────────────────────────────────────
info "Running plugin compatibility checks..."
export VENCORD_SRC="$VENCORD_DIR/src"
node "$SCRIPT_DIR/check-compat.js"
# check-compat.js exits 1 on hard errors, so we'll never reach here on failure

# ─── Copy custom plugins ─────────────────────────────────────────────────────
if [[ -d "$PLUGINS_SRC" ]]; then
    PLUGIN_COUNT=0
    for plugin_dir in "$PLUGINS_SRC"/*/; do
        [[ -d "$plugin_dir" ]] || continue
        plugin_name=$(basename "$plugin_dir")
        dest="$VENCORD_DIR/src/plugins/$plugin_name"

        # Warn if overwriting an official plugin (shouldn't happen after compat check, but belt-and-suspenders)
        if [[ -d "$dest" ]]; then
            warn "Overwriting existing plugin slot: $plugin_name — was this intended?"
        fi

        cp -r "$plugin_dir" "$dest"
        info "  Added plugin: ${BOLD}$plugin_name${RESET}"
        PLUGIN_COUNT=$((PLUGIN_COUNT + 1))
    done
    success "Copied $PLUGIN_COUNT custom plugin(s) into Vencord"
else
    warn "No vencord-plugins/ directory found — building stock Vencord"
fi

# ─── Build ────────────────────────────────────────────────────────────────────
info "Building Vencord browser bundle..."
cd "$VENCORD_DIR"

if [[ "$SKIP_TS" == "true" ]]; then
    warn "--skip-ts set: skipping TypeScript type check step"
    # Patch tsconfig to skip emit checking (still compiles, just faster)
    node -e "
        const fs = require('fs');
        const p = 'tsconfig.json';
        const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        cfg.compilerOptions = { ...cfg.compilerOptions, noEmit: false, skipLibCheck: true };
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
    "
fi

pnpm build

if [[ ! -f "$VENCORD_DIR/dist/browser.js" ]]; then
    die "Build succeeded but dist/browser.js not found — something went wrong"
fi

# ─── Write output ─────────────────────────────────────────────────────────────
info "Writing bundle to app resources..."
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Prepend a metadata comment so we can inspect what's baked in
BUNDLE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
{
    echo "// VendroidEnhanced custom Vencord bundle"
    echo "// Built: $BUNDLE_DATE"
    echo "// Vencord commit: $VENCORD_COMMIT"
    echo "// Custom plugins: $(ls "$PLUGINS_SRC" 2>/dev/null | tr '\n' ' ' || echo 'none')"
    cat "$VENCORD_DIR/dist/browser.js"
} > "$OUTPUT_FILE"

BUNDLE_SIZE_KB=$(du -k "$OUTPUT_FILE" | cut -f1)
success "Bundle written → app/src/main/res/raw/vencord_bundle.js (${BUNDLE_SIZE_KB} KB)"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}=== Build complete ===${RESET}"
echo -e "  Vencord commit : $VENCORD_COMMIT"
echo -e "  Bundle size    : ${BUNDLE_SIZE_KB} KB"
echo -e "  Output         : app/src/main/res/raw/vencord_bundle.js"
echo -e "  Next step      : Build the APK with Gradle or open in Android Studio"
echo ""
