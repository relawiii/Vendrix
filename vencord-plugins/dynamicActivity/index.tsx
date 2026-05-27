/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import {
    ChannelStore,
    FluxDispatcher,
    GuildStore,
    React,
    SelectedChannelStore,
    UserStore,
    useEffect,
    useState,
} from "@webpack/common";
import { ChannelType } from "@vencord/discord-types/enums";

// ─── Types ────────────────────────────────────────────────────────────────────

const enum ActivityType {
    PLAYING   = 0,
    STREAMING = 1,
    LISTENING = 2,
    WATCHING  = 3,
    COMPETING = 5,
}

const enum Mode {
    DEFAULT    = "default",
    CUSTOM     = "custom",
    ROTATING   = "rotating",
    SCHEDULED  = "scheduled",
    IDLE_AWARE = "idle_aware",
    DISABLED   = "disabled",
}

interface Activity {
    name: string;
    type: ActivityType;
    details?: string;
    state?: string;
    timestamps?: { start?: number; end?: number; };
    assets?: {
        large_image?: string;
        large_text?: string;
        small_image?: string;
        small_text?: string;
    };
    buttons?: { label: string; url: string; }[];
    application_id?: string;
    url?: string;
}

interface RotatingEntry {
    type: ActivityType;
    name: string;
    details?: string;
    state?: string;
}

interface ScheduleSlot {
    type: ActivityType;
    name: string;
    details?: string;
    state?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SOCKET_ID = "DynamicActivity";
// Fake application ID for presence — well-known placeholder used by custom RPC plugins
const APP_ID = "1045800378228281345";

function dispatch(activity: Activity | null) {
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity: activity
            ? { ...activity, application_id: activity.application_id ?? APP_ID }
            : null,
        socketId: SOCKET_ID,
    });
}

function clearActivity() {
    dispatch(null);
}

function parseJson<T>(raw: string, fallback: T): T {
    try { return JSON.parse(raw) as T; }
    catch { return fallback; }
}

function getHour() { return new Date().getHours(); }

function activityTypeLabel(t: ActivityType) {
    return (
        { [ActivityType.PLAYING]: "Playing", [ActivityType.STREAMING]: "Streaming", [ActivityType.LISTENING]: "Listening to", [ActivityType.WATCHING]: "Watching", [ActivityType.COMPETING]: "Competing in" } as Record<number, string>
    )[t] ?? "Playing";
}

// ─── Default-mode activity builder ────────────────────────────────────────────

function buildDefaultActivity(): Activity | null {
    const channelId = SelectedChannelStore.getChannelId();
    const voiceChannelId = SelectedChannelStore.getVoiceChannelId?.();
    const me = UserStore.getCurrentUser();

    // In a voice / stage channel
    if (voiceChannelId) {
        const vc = ChannelStore.getChannel(voiceChannelId);
        const guild = vc?.guild_id ? GuildStore.getGuild(vc.guild_id) : null;
        const isStage = vc?.type === ChannelType.GUILD_STAGE_VOICE;
        return {
            type: ActivityType.LISTENING,
            name: isStage ? "a Stage Channel" : "Voice Chat",
            details: vc ? `#${vc.name}` : "Unknown channel",
            state: guild ? `in ${guild.name}` : "in a server",
            timestamps: { start: Date.now() },
        };
    }

    if (!channelId) {
        return {
            type: ActivityType.WATCHING,
            name: "Discord",
            details: "Browsing",
            state: "Home screen",
        };
    }

    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return null;

    switch (channel.type) {
        case ChannelType.DM: {
            return {
                type: ActivityType.WATCHING,
                name: "Discord",
                details: "Reading a DM",
                state: me ? `as ${me.username}` : undefined,
            };
        }
        case ChannelType.GROUP_DM: {
            const name = (channel as any).name || "a Group Chat";
            return {
                type: ActivityType.WATCHING,
                name: "Discord",
                details: `In ${name}`,
                state: `${(channel as any).recipients?.length ?? "?"} members`,
            };
        }
        case ChannelType.GUILD_TEXT:
        case ChannelType.GUILD_ANNOUNCEMENT:
        case ChannelType.GUILD_FORUM: {
            const guild = GuildStore.getGuild(channel.guild_id);
            return {
                type: ActivityType.WATCHING,
                name: guild?.name ?? "a Server",
                details: `#${channel.name}`,
                state: "Reading messages",
                timestamps: { start: Date.now() },
            };
        }
        default:
            return {
                type: ActivityType.WATCHING,
                name: "Discord",
                details: "Browsing",
            };
    }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    mode: {
        type: OptionType.SELECT,
        description: "Activity mode",
        options: [
            { label: "🔍 Default  —  auto-detects what you're doing", value: Mode.DEFAULT, default: true },
            { label: "✏️  Custom   —  always show one activity",        value: Mode.CUSTOM  },
            { label: "🔄 Rotating —  cycle through a list",            value: Mode.ROTATING },
            { label: "📅 Scheduled — change by time of day",           value: Mode.SCHEDULED },
            { label: "💤 Idle-Aware — special status when AFK",        value: Mode.IDLE_AWARE },
            { label: "🚫 Disabled  —  no activity override",           value: Mode.DISABLED },
        ],
        onChange: () => plugin.refreshActivity(),
    },

    // ── Custom mode ────────────────────────────────────────────────────────
    customType: {
        type: OptionType.SELECT,
        description: "[Custom] Activity type",
        options: [
            { label: "Playing",      value: ActivityType.PLAYING,   default: true },
            { label: "Watching",     value: ActivityType.WATCHING   },
            { label: "Listening to", value: ActivityType.LISTENING  },
            { label: "Streaming",    value: ActivityType.STREAMING  },
            { label: "Competing in", value: ActivityType.COMPETING  },
        ],
        onChange: () => plugin.refreshActivity(),
    },
    customName: {
        type: OptionType.STRING,
        description: "[Custom] Activity name",
        default: "Discord",
        onChange: () => plugin.refreshActivity(),
    },
    customDetails: {
        type: OptionType.STRING,
        description: "[Custom] Details line",
        default: "",
        onChange: () => plugin.refreshActivity(),
    },
    customState: {
        type: OptionType.STRING,
        description: "[Custom] State line",
        default: "",
        onChange: () => plugin.refreshActivity(),
    },
    customShowTimestamp: {
        type: OptionType.BOOLEAN,
        description: "[Custom] Show elapsed timestamp",
        default: false,
        onChange: () => plugin.refreshActivity(),
    },
    customLargeImage: {
        type: OptionType.STRING,
        description: "[Custom] Large image key or URL",
        default: "",
        onChange: () => plugin.refreshActivity(),
    },
    customLargeText: {
        type: OptionType.STRING,
        description: "[Custom] Large image hover text",
        default: "",
        onChange: () => plugin.refreshActivity(),
    },
    customSmallImage: {
        type: OptionType.STRING,
        description: "[Custom] Small image key or URL",
        default: "",
        onChange: () => plugin.refreshActivity(),
    },
    customSmallText: {
        type: OptionType.STRING,
        description: "[Custom] Small image hover text",
        default: "",
        onChange: () => plugin.refreshActivity(),
    },
    customButton1Label: {
        type: OptionType.STRING,
        description: "[Custom] Button 1 label",
        default: "",
        onChange: () => plugin.refreshActivity(),
    },
    customButton1Url: {
        type: OptionType.STRING,
        description: "[Custom] Button 1 URL",
        default: "",
        onChange: () => plugin.refreshActivity(),
    },
    customButton2Label: {
        type: OptionType.STRING,
        description: "[Custom] Button 2 label",
        default: "",
        onChange: () => plugin.refreshActivity(),
    },
    customButton2Url: {
        type: OptionType.STRING,
        description: "[Custom] Button 2 URL",
        default: "",
        onChange: () => plugin.refreshActivity(),
    },

    // ── Rotating mode ─────────────────────────────────────────────────────
    rotatingActivities: {
        type: OptionType.STRING,
        description: '[Rotating] JSON array of activities. Example: [{"type":0,"name":"Minecraft"},{"type":2,"name":"Spotify","details":"Lo-fi Chill"}]',
        default: '[{"type":0,"name":"Discord","details":"Chilling"},{"type":2,"name":"Spotify","details":"Vibing to music"}]',
        onChange: () => plugin.refreshActivity(),
    },
    rotatingIntervalSeconds: {
        type: OptionType.NUMBER,
        description: "[Rotating] Seconds between rotations (min: 15)",
        default: 30,
        onChange: () => plugin.refreshActivity(),
    },

    // ── Scheduled mode ────────────────────────────────────────────────────
    scheduleMorning: {
        type: OptionType.STRING,
        description: "[Scheduled] 6 AM–12 PM  — JSON: {\"type\":0,\"name\":\"...\",\"details\":\"...\"}",
        default: '{"type":0,"name":"Starting the day","details":"Morning grind"}',
        onChange: () => plugin.refreshActivity(),
    },
    scheduleAfternoon: {
        type: OptionType.STRING,
        description: "[Scheduled] 12 PM–6 PM  — JSON",
        default: '{"type":3,"name":"YouTube","details":"Afternoon videos"}',
        onChange: () => plugin.refreshActivity(),
    },
    scheduleEvening: {
        type: OptionType.STRING,
        description: "[Scheduled] 6 PM–12 AM  — JSON",
        default: '{"type":0,"name":"Gaming","details":"Evening session"}',
        onChange: () => plugin.refreshActivity(),
    },
    scheduleNight: {
        type: OptionType.STRING,
        description: "[Scheduled] 12 AM–6 AM  — JSON",
        default: '{"type":2,"name":"Late night playlist","details":"Insomnia hours"}',
        onChange: () => plugin.refreshActivity(),
    },

    // ── Idle-Aware mode ───────────────────────────────────────────────────
    idleThresholdMinutes: {
        type: OptionType.NUMBER,
        description: "[Idle-Aware] Minutes of inactivity before showing idle status",
        default: 10,
    },
    idleName: {
        type: OptionType.STRING,
        description: "[Idle-Aware] Activity name while idle",
        default: "AFK",
        onChange: () => plugin.refreshActivity(),
    },
    idleDetails: {
        type: OptionType.STRING,
        description: "[Idle-Aware] Details while idle",
        default: "Gone for a bit",
        onChange: () => plugin.refreshActivity(),
    },
    idleType: {
        type: OptionType.SELECT,
        description: "[Idle-Aware] Activity type while idle",
        options: [
            { label: "Playing",      value: ActivityType.PLAYING,  default: true },
            { label: "Watching",     value: ActivityType.WATCHING  },
            { label: "Listening to", value: ActivityType.LISTENING },
        ],
        onChange: () => plugin.refreshActivity(),
    },
    idleBaseMode: {
        type: OptionType.SELECT,
        description: "[Idle-Aware] Mode to use when NOT idle",
        options: [
            { label: "Default (auto-detect)", value: Mode.DEFAULT,  default: true },
            { label: "Custom",                value: Mode.CUSTOM   },
            { label: "Rotating",              value: Mode.ROTATING },
        ],
        onChange: () => plugin.refreshActivity(),
    },
});

// ─── Plugin state (module-level) ──────────────────────────────────────────────

let startTimestamp = Date.now();
let rotatingIndex  = 0;
let rotatingTimer: ReturnType<typeof setInterval> | null = null;
let scheduledTimer: ReturnType<typeof setInterval> | null = null;
let idleTimer: ReturnType<typeof setTimeout>  | null = null;
let isIdle = false;

// ─── Activity builders per mode ───────────────────────────────────────────────

function buildCustomActivity(): Activity {
    const s = settings.store;
    const buttons: { label: string; url: string; }[] = [];
    if (s.customButton1Label && s.customButton1Url)
        buttons.push({ label: s.customButton1Label, url: s.customButton1Url });
    if (s.customButton2Label && s.customButton2Url)
        buttons.push({ label: s.customButton2Label, url: s.customButton2Url });

    return {
        type:    s.customType,
        name:    s.customName || "Discord",
        details: s.customDetails || undefined,
        state:   s.customState   || undefined,
        timestamps: s.customShowTimestamp ? { start: startTimestamp } : undefined,
        assets: (s.customLargeImage || s.customSmallImage) ? {
            large_image: s.customLargeImage  || undefined,
            large_text:  s.customLargeText   || undefined,
            small_image: s.customSmallImage  || undefined,
            small_text:  s.customSmallText   || undefined,
        } : undefined,
        buttons: buttons.length ? buttons : undefined,
        url: s.customType === ActivityType.STREAMING ? (s.customButton1Url || undefined) : undefined,
    };
}

function buildRotatingActivity(): Activity | null {
    const list = parseJson<RotatingEntry[]>(settings.store.rotatingActivities, []);
    if (!list.length) return null;
    const entry = list[rotatingIndex % list.length];
    return {
        type:    entry.type  ?? ActivityType.PLAYING,
        name:    entry.name  || "Discord",
        details: entry.details || undefined,
        state:   entry.state   || undefined,
        timestamps: { start: startTimestamp },
    };
}

function buildScheduledActivity(): Activity | null {
    const h = getHour();
    const s = settings.store;
    let raw: string;
    if      (h >= 6  && h < 12) raw = s.scheduleMorning;
    else if (h >= 12 && h < 18) raw = s.scheduleAfternoon;
    else if (h >= 18)           raw = s.scheduleEvening;
    else                        raw = s.scheduleNight;

    const slot = parseJson<ScheduleSlot | null>(raw, null);
    if (!slot) return null;
    return {
        type:    slot.type    ?? ActivityType.PLAYING,
        name:    slot.name    || "Discord",
        details: slot.details || undefined,
        state:   slot.state   || undefined,
    };
}

function buildIdleActivity(): Activity {
    const s = settings.store;
    return {
        type:    s.idleType,
        name:    s.idleName    || "AFK",
        details: s.idleDetails || undefined,
        timestamps: { start: Date.now() },
    };
}

// ─── Core refresh ─────────────────────────────────────────────────────────────

function computeActivity(): Activity | null {
    const mode = settings.store.mode as Mode;

    if (mode === Mode.DISABLED) return null;

    if (mode === Mode.IDLE_AWARE) {
        if (isIdle) return buildIdleActivity();
        const base = settings.store.idleBaseMode as Mode;
        if (base === Mode.DEFAULT)  return buildDefaultActivity();
        if (base === Mode.CUSTOM)   return buildCustomActivity();
        if (base === Mode.ROTATING) return buildRotatingActivity();
        return buildDefaultActivity();
    }

    if (mode === Mode.DEFAULT)   return buildDefaultActivity();
    if (mode === Mode.CUSTOM)    return buildCustomActivity();
    if (mode === Mode.ROTATING)  return buildRotatingActivity();
    if (mode === Mode.SCHEDULED) return buildScheduledActivity();

    return null;
}

// ─── Timers & Flux listeners ──────────────────────────────────────────────────

function stopTimers() {
    if (rotatingTimer)  { clearInterval(rotatingTimer);  rotatingTimer  = null; }
    if (scheduledTimer) { clearInterval(scheduledTimer); scheduledTimer = null; }
    if (idleTimer)      { clearTimeout(idleTimer);       idleTimer      = null; }
}

function startTimers() {
    stopTimers();
    const mode = settings.store.mode as Mode;

    if (mode === Mode.ROTATING || (mode === Mode.IDLE_AWARE && settings.store.idleBaseMode === Mode.ROTATING)) {
        const interval = Math.max(15, settings.store.rotatingIntervalSeconds) * 1000;
        rotatingTimer = setInterval(() => {
            const list = parseJson<RotatingEntry[]>(settings.store.rotatingActivities, []);
            rotatingIndex = (rotatingIndex + 1) % Math.max(list.length, 1);
            dispatch(computeActivity());
        }, interval);
    }

    if (mode === Mode.SCHEDULED) {
        // Check every minute so we switch at the right hour boundary
        scheduledTimer = setInterval(() => {
            dispatch(computeActivity());
        }, 60_000);
    }
}

function resetIdleTimer() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (isIdle) {
        isIdle = false;
        dispatch(computeActivity());
    }
    const threshold = Math.max(1, settings.store.idleThresholdMinutes) * 60_000;
    idleTimer = setTimeout(() => {
        isIdle = true;
        dispatch(buildIdleActivity());
    }, threshold);
}

const fluxHandlers: Record<string, () => void> = {
    CHANNEL_SELECT:        () => plugin.refreshActivity(),
    VOICE_STATE_UPDATES:   () => plugin.refreshActivity(),
    SESSION_START_OR_RESUME: () => plugin.refreshActivity(),
};

// ─── Plugin object ────────────────────────────────────────────────────────────

const plugin = definePlugin({
    name: "DynamicActivity",
    description: "Smart rich presence with Default (auto-detect), Custom, Rotating, Scheduled, and Idle-Aware modes.",
    authors: [{ name: "VendroidEnhanced", id: 0n }],
    settings,

    refreshActivity() {
        dispatch(computeActivity());
    },

    start() {
        startTimestamp = Date.now();
        startTimers();

        for (const [event, handler] of Object.entries(fluxHandlers)) {
            FluxDispatcher.subscribe(event, handler);
        }

        if (settings.store.mode === Mode.IDLE_AWARE) {
            resetIdleTimer();
            document.addEventListener("mousemove", resetIdleTimer);
            document.addEventListener("keydown",   resetIdleTimer);
            document.addEventListener("touchstart", resetIdleTimer);
        }

        this.refreshActivity();
    },

    stop() {
        stopTimers();

        for (const [event, handler] of Object.entries(fluxHandlers)) {
            FluxDispatcher.unsubscribe(event, handler);
        }

        document.removeEventListener("mousemove", resetIdleTimer);
        document.removeEventListener("keydown",   resetIdleTimer);
        document.removeEventListener("touchstart", resetIdleTimer);

        clearActivity();
    },

    settingsAboutComponent() {
        const [preview, setPreview] = useState<Activity | null>(null);

        useEffect(() => {
            const a = computeActivity();
            setPreview(a);
        }, []);

        if (!preview) return (
            <div style={{ opacity: 0.6, fontSize: 13 }}>
                No activity active (mode is Disabled or nothing to show).
            </div>
        );

        return (
            <div style={{
                background: "var(--background-secondary)",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                lineHeight: 1.5,
            }}>
                <strong>Live Preview</strong>
                <div style={{ marginTop: 6 }}>
                    <span style={{ opacity: 0.6 }}>{activityTypeLabel(preview.type)}</span>{" "}
                    <strong>{preview.name}</strong>
                </div>
                {preview.details && <div>{preview.details}</div>}
                {preview.state   && <div style={{ opacity: 0.7 }}>{preview.state}</div>}
                {preview.timestamps?.start && (
                    <div style={{ opacity: 0.5, fontSize: 11, marginTop: 4 }}>
                        ⏱ Timestamp enabled
                    </div>
                )}
                {preview.buttons?.length ? (
                    <div style={{ marginTop: 6, opacity: 0.7 }}>
                        🔗 {preview.buttons.map(b => b.label).join(" · ")}
                    </div>
                ) : null}
            </div>
        );
    },
});

export default plugin;
