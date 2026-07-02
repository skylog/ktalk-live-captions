import type { CaptureSource } from "../shared/protocol";

export const SETTINGS_STORE_KEY = "ktalk-live-captions.settings.v1" as const;
export const SETTINGS_VERSION = 1 as const;

export const OVERLAY_POSITIONS = [
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
] as const;

export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];

export const CAPTION_DENSITIES = ["compact", "balanced", "relaxed"] as const;

export type CaptionDensity = (typeof CAPTION_DENSITIES)[number];

export const EXPORT_FORMATS = ["txt", "markdown"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportDefaultsSettings {
  format: ExportFormat;
  includeTimestamps: boolean;
  includeSpeakerLabels: boolean;
}

export interface AppSettings {
  version: typeof SETTINGS_VERSION;
  captureSource: CaptureSource;
  overlayPosition: OverlayPosition;
  captionDensity: CaptionDensity;
  exportDefaults: ExportDefaultsSettings;
}

export interface SettingsPatch {
  captureSource?: CaptureSource;
  overlayPosition?: OverlayPosition;
  captionDensity?: CaptionDensity;
  exportDefaults?: Partial<ExportDefaultsSettings>;
}

interface StoredSettingsState {
  version: typeof SETTINGS_VERSION;
  updatedAt: number;
  settings: AppSettings;
}

interface ChromeStorageArea {
  get(
    keys: string | string[] | Record<string, unknown> | null,
    callback: (items: Record<string, unknown>) => void,
  ): void;
  set(items: Record<string, unknown>, callback?: () => void): void;
}

interface ChromeExtensionAPI {
  storage: {
    local: ChromeStorageArea;
  };
}

type StoreAdapter = {
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, value: T): Promise<void>;
};

function now(): number {
  return Date.now();
}

function cloneStoredValue<T>(value: T): T {
  const globalScope = globalThis as typeof globalThis & {
    structuredClone?: <U>(input: U) => U;
  };

  if (typeof globalScope.structuredClone === "function") {
    return globalScope.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getChromeStorageArea(): ChromeStorageArea | null {
  const chromeApi = globalThis as typeof globalThis & { chrome?: ChromeExtensionAPI };
  return chromeApi.chrome?.storage.local ?? null;
}

function createStorageAdapter(): StoreAdapter {
  const area = getChromeStorageArea();
  const memory = new Map<string, unknown>();

  return {
    async read<T>(key: string): Promise<T | null> {
      if (!area) {
        const value = memory.get(key);
        return value === undefined ? null : cloneStoredValue(value as T);
      }

      return new Promise((resolve, reject) => {
        area.get(key, (items) => {
          const runtime = (globalThis as typeof globalThis & {
            chrome?: { runtime?: { lastError?: { message?: string } } };
          }).chrome?.runtime;

          if (runtime?.lastError) {
            reject(new Error(runtime.lastError.message ?? "Storage read failed"));
            return;
          }

          const value = items[key];
          resolve(value === undefined ? null : cloneStoredValue(value as T));
        });
      });
    },
    async write<T>(key: string, value: T): Promise<void> {
      if (!area) {
        memory.set(key, cloneStoredValue(value));
        return;
      }

      return new Promise((resolve, reject) => {
        area.set({ [key]: cloneStoredValue(value) as unknown }, () => {
          const runtime = (globalThis as typeof globalThis & {
            chrome?: { runtime?: { lastError?: { message?: string } } };
          }).chrome?.runtime;

          if (runtime?.lastError) {
            reject(new Error(runtime.lastError.message ?? "Storage write failed"));
            return;
          }

          resolve();
        });
      });
    },
  };
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    version: SETTINGS_VERSION,
    captureSource: settings.captureSource,
    overlayPosition: settings.overlayPosition,
    captionDensity: settings.captionDensity,
    exportDefaults: {
      format: settings.exportDefaults.format,
      includeTimestamps: settings.exportDefaults.includeTimestamps,
      includeSpeakerLabels: settings.exportDefaults.includeSpeakerLabels,
    },
  };
}

function makeDefaultSettings(): AppSettings {
  return {
    version: SETTINGS_VERSION,
    captureSource: "tab-audio",
    overlayPosition: "bottom-right",
    captionDensity: "balanced",
    exportDefaults: {
      format: "txt",
      includeTimestamps: true,
      includeSpeakerLabels: false,
    },
  };
}

export const defaultSettings: AppSettings = Object.freeze({
  ...makeDefaultSettings(),
  exportDefaults: Object.freeze({
    ...makeDefaultSettings().exportDefaults,
  }),
});

function normalizeCaptureSource(value: unknown): CaptureSource {
  return value === "microphone" ? "microphone" : "tab-audio";
}

function normalizeOverlayPosition(value: unknown): OverlayPosition {
  return value === "bottom-left" ||
    value === "top-right" ||
    value === "top-left"
    ? value
    : "bottom-right";
}

function normalizeCaptionDensity(value: unknown): CaptionDensity {
  return value === "compact" || value === "relaxed" ? value : "balanced";
}

function normalizeExportDefaults(value: unknown): ExportDefaultsSettings {
  const record = isRecord(value) ? value : {};
  return {
    format: record.format === "markdown" ? "markdown" : "txt",
    includeTimestamps: typeof record.includeTimestamps === "boolean" ? record.includeTimestamps : true,
    includeSpeakerLabels:
      typeof record.includeSpeakerLabels === "boolean" ? record.includeSpeakerLabels : false,
  };
}

function normalizeSettings(value: unknown): AppSettings {
  const record = isRecord(value) ? value : {};
  return {
    version: SETTINGS_VERSION,
    captureSource: normalizeCaptureSource(record.captureSource),
    overlayPosition: normalizeOverlayPosition(record.overlayPosition),
    captionDensity: normalizeCaptionDensity(record.captionDensity),
    exportDefaults: normalizeExportDefaults(record.exportDefaults),
  };
}

function makeState(settings: AppSettings, updatedAt = now()): StoredSettingsState {
  return {
    version: SETTINGS_VERSION,
    updatedAt,
    settings: cloneSettings(settings),
  };
}

function normalizeState(value: unknown, clock: () => number): StoredSettingsState {
  if (!isRecord(value)) {
    return makeState(defaultSettings, clock());
  }

  if (value.version === SETTINGS_VERSION) {
    if (isRecord(value.settings)) {
      return makeState(
        normalizeSettings(value.settings),
        typeof value.updatedAt === "number" ? value.updatedAt : clock(),
      );
    }

    return makeState(
      normalizeSettings(value),
      typeof value.updatedAt === "number" ? value.updatedAt : clock(),
    );
  }

  return makeState(defaultSettings, clock());
}

export class SettingsStore {
  private readonly adapter: StoreAdapter;

  constructor() {
    this.adapter = createStorageAdapter();
  }

  private async readState(): Promise<StoredSettingsState> {
    const stored = await this.adapter.read<unknown>(SETTINGS_STORE_KEY);
    return stored ? normalizeState(stored, now) : makeState(defaultSettings, now());
  }

  private async writeState(state: StoredSettingsState): Promise<void> {
    await this.adapter.write(SETTINGS_STORE_KEY, state);
  }

  async get(): Promise<AppSettings> {
    const state = await this.readState();
    return cloneSettings(state.settings);
  }

  async set(settings: AppSettings): Promise<AppSettings> {
    const nextSettings = normalizeSettings(settings);
    await this.writeState(makeState(nextSettings));
    return cloneSettings(nextSettings);
  }

  async update(patch: SettingsPatch): Promise<AppSettings> {
    const current = await this.get();
    const nextSettings = normalizeSettings({
      ...current,
      ...patch,
      exportDefaults: {
        ...current.exportDefaults,
        ...(patch.exportDefaults ?? {}),
      },
    });

    return await this.set(nextSettings);
  }

  async reset(): Promise<AppSettings> {
    return await this.set(defaultSettings);
  }
}

export const settingsStore = new SettingsStore();

export const getSettings = (): Promise<AppSettings> => settingsStore.get();

export const setSettings = (settings: AppSettings): Promise<AppSettings> => settingsStore.set(settings);

export const updateSettings = (patch: SettingsPatch): Promise<AppSettings> => settingsStore.update(patch);

export const resetSettings = (): Promise<AppSettings> => settingsStore.reset();
