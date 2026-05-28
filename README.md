# Vendrix

Vendrix is a fork of [Vendroid](https://github.com/Vencord/Vendroid) — a Discord client for Android that loads the mobile website and injects Vencord — with a custom plugin system, performance improvements, and automated Vencord builds.

[![Static Badge](https://img.shields.io/badge/Download%20Vendrix-black?style=for-the-badge&logo=android)](https://github.com/relawiii/Vendrix/releases/latest) [![Static Badge](https://img.shields.io/badge/Website-Vendrix-blue)](https://disisvendrix.github.io/site/)

---

Vendrix works by loading discord.com in a WebView and injecting Vencord on top of it. Custom plugins are pulled from a separate repo at build time and bundled directly into the APK alongside all official Vencord plugins.

| | |
|:--:|:--:|
|![image](https://github.com/Vencord/Vendroid/assets/45497981/e6464167-78b1-4f38-8e96-bb355ea5bbc3)|![image](https://github.com/Vencord/Vendroid/assets/45497981/3f6b278e-f18d-4cae-964f-f357f06ca2bd)|

## What's different from Vendroid

| | |
|---|---|
| **Custom plugins** | Pulled from an external repo at build time, merged with all official Vencord plugins |
| **Embedded bundle** | Vencord is baked into the APK — no CDN download on first launch |
| **Faster startup** | Bundle loads off the UI thread; sub-resources go through WebView's native stack |
| **Debug APK CI** | GitHub Actions builds a debug APK on every push, no signing needed |
| **Auto-bundle CI** | Bundle rebuilds daily and on every plugin change, committed back automatically |

## Download

Visit the [latest release](https://github.com/relawiii/Vendrix/releases/latest), grab the APK and install it.

> You may need to allow installs from unknown sources in your Android settings.

## Building

Requires Node.js 18+, pnpm, git, and JDK 21.

**1. Set your plugins repo URL** (in repo Settings → Secrets → Actions):

```
PLUGINS_REPO_URL = https://github.com/relawiii/vendrix-plugins
```

**2. Build the Vencord bundle:**

```bash
PLUGINS_REPO=https://github.com/relawiii/vendrix-plugins ./scripts/build-vencord.sh
```

Flags: `--no-cache` to force re-clone, `--skip-ts` to skip the TypeScript check.

**3. Build the APK:**

```bash
./gradlew assembleDebug     # debug
./gradlew assembleRelease   # release (unsigned)
```

## Custom plugins

Plugins live in a [separate repo](https://github.com/relawiii/vendrix-plugins). At build time, `build-vencord.sh` clones it and copies each plugin folder into Vencord's `src/plugins/` alongside all official plugins. The full merged set gets bundled into the APK.

To add a plugin, drop a folder with an `index.tsx` into the plugins repo:

```
vendrix-plugins/
  myPlugin/
    index.tsx
```

The plugin must use `definePlugin()` with `name`, `description`, and `authors`.

## Included plugins

### `dynamicActivity`

Sets your Discord Rich Presence automatically based on what you're doing. Supports six modes — auto-detection, custom, rotating, scheduled, idle-aware, and disabled — all configurable live from the plugin settings panel.

## CI

| Workflow | Triggers | Output |
|---|---|---|
| `build-vencord.yml` | Daily 3 AM UTC, push to `scripts/`, manual | Updated `vencord_bundle.js` committed back |
| `debug-apk.yml` | Every push | Debug APK artifact (7 day retention) |
| `android-build.yml` | Every push + PR | Release APK artifact (14 day retention) |

## Credits

- [Vendroid](https://github.com/Vencord/Vendroid) — original app by nin0dev
- [Vencord](https://github.com/Vendicated/Vencord) — the client mod
- [VendroidEnhanced] - enchanced original app
