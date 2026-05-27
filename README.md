# VendroidEnhanced

An actively maintained fork of Vendroid — a Discord client that loads the mobile
website and injects Vencord — now with a **custom plugin system** and
**automatic Vencord builds**.

[website](https://vendroid.nin0.dev) · [download](https://vendroid.nin0.dev/download) · [faq](https://vendroid.nin0.dev/faq) · [support](https://discord.gg/6ckFahqUcd)

---

## ✨ What's new in this fork

| Feature | Details |
|---|---|
| **DynamicActivity plugin** | Auto-detect status, custom RPC, rotating, scheduled, idle-aware |
| **Embedded Vencord bundle** | Build script bakes plugins directly into the APK |
| **Plugin compatibility checker** | Validates every plugin before building |
| **Auto-build CI** | GitHub Actions rebuilds the bundle daily and on every plugin change |

---

## 🚀 Quick start (GitHub Codespaces)

1. Open in Codespaces — Node, pnpm, and git are pre-installed.

2. Build the Vencord bundle (pulls latest Vencord + your plugins):
   ```bash
   ./scripts/build-vencord.sh
   ```
   Writes `app/src/main/res/raw/vencord_bundle.js` on success.

3. Build the APK:
   ```bash
   ./gradlew assembleRelease
   ```

**Build flags:**
- `--no-cache` — force re-clone Vencord
- `--skip-ts` — skip TypeScript type check (faster)

---

## 🔌 Adding a plugin

1. Create a folder in `vencord-plugins/`:
   ```
   vencord-plugins/
     myPlugin/
       index.tsx
   ```

2. Validate it:
   ```bash
   node scripts/check-compat.js
   ```

3. Rebuild:
   ```bash
   ./scripts/build-vencord.sh
   ```

### Plugin template

```typescript
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    myOption: { type: OptionType.BOOLEAN, description: "Does something", default: true },
});

export default definePlugin({
    name: "MyPlugin",
    description: "What it does",
    authors: [{ name: "YourName", id: 0n }],
    settings,
    start() {},
    stop()  {},
});
```

---

## 📦 DynamicActivity plugin

Smart Rich Presence with 6 modes:

| Mode | Description |
|---|---|
| **Default** | Auto-detects: DMs, Group DMs, Voice/Stage, text channel, home screen |
| **Custom** | Fixed activity — Playing/Watching/Listening/Streaming/Competing with name, details, state, images, 2 buttons, timestamp |
| **Rotating** | Cycles through a JSON list of activities on a configurable interval (min 15s) |
| **Scheduled** | Different activity at morning / afternoon / evening / night |
| **Idle-Aware** | AFK status after N minutes idle; returns to Default/Custom/Rotating when active |
| **Disabled** | No activity override |

All settings apply live with a preview in the plugin settings panel.

---

## ⚙️ Auto-build (GitHub Actions)

`.github/workflows/build-vencord.yml` runs:
- **Daily at 3 AM UTC** — picks up new Vencord commits
- **On every push** touching `vencord-plugins/` or `scripts/`
- **Manually** from the Actions tab

Commits the updated bundle back to the repo automatically.

---

## 🔍 Compatibility checker

`scripts/check-compat.js` checks each plugin for:
- `index.ts` / `index.tsx` / `index.js` present
- `definePlugin()` call with `name`, `description`, `authors`
- No invalid import paths
- No name collision with official Vencord plugins
- TypeScript type-check via Vencord's `tsconfig.json`

Build exits with code 1 on any error.
