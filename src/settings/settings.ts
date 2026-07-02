import {
  defaultSettings,
  getSettings,
  resetSettings,
  setSettings,
  type AppSettings,
  type CaptionDensity,
  type ExportFormat,
  type OverlayPosition,
} from "../storage/settings-store";

type SaveState = "loading" | "saved" | "saving" | "error";

type SettingsElements = {
  form: HTMLFormElement;
  statusPill: HTMLElement;
  statusNote: HTMLElement;
  captureSourceBadge: HTMLElement;
  overlayBadge: HTMLElement;
  densityBadge: HTMLElement;
  exportBadge: HTMLElement;
  captureSourceValue: HTMLElement;
  overlayValue: HTMLElement;
  densityValue: HTMLElement;
  exportValue: HTMLElement;
  exportDetailsValue: HTMLElement;
  previewSurface: HTMLElement;
  resetButton: HTMLButtonElement;
  rerunOnboardingButton: HTMLButtonElement;
  openDiagnosticsButton: HTMLButtonElement;
  exportTimestamps: HTMLInputElement;
  exportSpeakerLabels: HTMLInputElement;
};

const LABELS = {
  captureSource: {
    "tab-audio": "Tab audio",
    microphone: "Microphone",
  } as const,
  overlayPosition: {
    "bottom-right": "Bottom right",
    "bottom-left": "Bottom left",
    "top-right": "Top right",
    "top-left": "Top left",
  } as const,
  captionDensity: {
    compact: "Compact",
    balanced: "Balanced",
    relaxed: "Relaxed",
  } as const,
  exportFormat: {
    txt: "TXT",
    markdown: "Markdown",
  } as const,
};

let hydrated = false;
let saveToken = 0;

function getRequiredElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function getElements(): SettingsElements | null {
  const form = getRequiredElement<HTMLFormElement>("settings-form");
  const statusPill = getRequiredElement<HTMLElement>("settings-status");
  const statusNote = getRequiredElement<HTMLElement>("settings-save-note");
  const captureSourceBadge = getRequiredElement<HTMLElement>("capture-source-badge");
  const overlayBadge = getRequiredElement<HTMLElement>("overlay-badge");
  const densityBadge = getRequiredElement<HTMLElement>("density-badge");
  const exportBadge = getRequiredElement<HTMLElement>("export-badge");
  const captureSourceValue = getRequiredElement<HTMLElement>("capture-source-value");
  const overlayValue = getRequiredElement<HTMLElement>("overlay-value");
  const densityValue = getRequiredElement<HTMLElement>("density-value");
  const exportValue = getRequiredElement<HTMLElement>("export-value");
  const exportDetailsValue = getRequiredElement<HTMLElement>("export-details-value");
  const previewSurface = getRequiredElement<HTMLElement>("settings-preview");
  const resetButton = getRequiredElement<HTMLButtonElement>("reset-settings");
  const rerunOnboardingButton = getRequiredElement<HTMLButtonElement>("rerun-onboarding");
  const openDiagnosticsButton = getRequiredElement<HTMLButtonElement>("open-diagnostics");
  const exportTimestamps = getRequiredElement<HTMLInputElement>("export-timestamps");
  const exportSpeakerLabels = getRequiredElement<HTMLInputElement>("export-speaker-labels");

  if (
    !form ||
    !statusPill ||
    !statusNote ||
    !captureSourceBadge ||
    !overlayBadge ||
    !densityBadge ||
    !exportBadge ||
    !captureSourceValue ||
    !overlayValue ||
    !densityValue ||
    !exportValue ||
    !exportDetailsValue ||
    !previewSurface ||
    !resetButton ||
    !rerunOnboardingButton ||
    !openDiagnosticsButton ||
    !exportTimestamps ||
    !exportSpeakerLabels
  ) {
    return null;
  }

  return {
    form,
    statusPill,
    statusNote,
    captureSourceBadge,
    overlayBadge,
    densityBadge,
    exportBadge,
    captureSourceValue,
    overlayValue,
    densityValue,
    exportValue,
    exportDetailsValue,
    previewSurface,
    resetButton,
    rerunOnboardingButton,
    openDiagnosticsButton,
    exportTimestamps,
    exportSpeakerLabels,
  };
}

function formatExportDetails(settings: AppSettings): string {
  const details = [
    settings.exportDefaults.includeTimestamps ? "timestamps on" : "timestamps off",
    settings.exportDefaults.includeSpeakerLabels ? "speaker labels on" : "speaker labels off",
  ];

  return details.join(" / ");
}

function setStatus(elements: SettingsElements, state: SaveState, note: string): void {
  elements.statusPill.dataset.status = state;
  elements.statusPill.textContent =
    state === "loading" ? "Loading" : state === "saving" ? "Saving" : state === "error" ? "Needs attention" : "Saved locally";
  elements.statusNote.textContent = note;
  elements.statusNote.dataset.state = state;
}

function setRadioValue(name: string, value: string): void {
  const checked = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (checked) {
    checked.checked = true;
  }
}

function getCheckedValue<T extends string>(name: string, fallback: T): T {
  const checked = document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return (checked?.value as T | undefined) ?? fallback;
}

function getExtensionPageUrl(extensionPath: string, fallbackRelativePath: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(extensionPath);
  }

  return new URL(fallbackRelativePath, window.location.href).toString();
}

function openExtensionPage(extensionPath: string, fallbackRelativePath: string): void {
  window.open(getExtensionPageUrl(extensionPath, fallbackRelativePath), "_blank", "noopener");
}

function renderForm(elements: SettingsElements, settings: AppSettings): void {
  setRadioValue("capture-source", settings.captureSource);
  setRadioValue("overlay-position", settings.overlayPosition);
  setRadioValue("caption-density", settings.captionDensity);
  setRadioValue("export-format", settings.exportDefaults.format);

  elements.exportTimestamps.checked = settings.exportDefaults.includeTimestamps;
  elements.exportSpeakerLabels.checked = settings.exportDefaults.includeSpeakerLabels;

  elements.captureSourceBadge.textContent = LABELS.captureSource[settings.captureSource];
  elements.overlayBadge.textContent = LABELS.overlayPosition[settings.overlayPosition];
  elements.densityBadge.textContent = LABELS.captionDensity[settings.captionDensity];
  elements.exportBadge.textContent = LABELS.exportFormat[settings.exportDefaults.format];

  elements.captureSourceValue.textContent = LABELS.captureSource[settings.captureSource];
  elements.overlayValue.textContent = LABELS.overlayPosition[settings.overlayPosition];
  elements.densityValue.textContent = LABELS.captionDensity[settings.captionDensity];
  elements.exportValue.textContent = LABELS.exportFormat[settings.exportDefaults.format];
  elements.exportDetailsValue.textContent = formatExportDetails(settings);

  elements.previewSurface.dataset.overlayPosition = settings.overlayPosition;
  elements.previewSurface.dataset.captionDensity = settings.captionDensity;
}

function readForm(elements: SettingsElements): AppSettings {
  const captureSource = getCheckedValue<AppSettings["captureSource"]>(
    "capture-source",
    defaultSettings.captureSource,
  );
  const overlayPosition = getCheckedValue<OverlayPosition>(
    "overlay-position",
    defaultSettings.overlayPosition,
  );
  const captionDensity = getCheckedValue<CaptionDensity>(
    "caption-density",
    defaultSettings.captionDensity,
  );
  const format = getCheckedValue<ExportFormat>("export-format", defaultSettings.exportDefaults.format);

  return {
    version: 1,
    captureSource,
    overlayPosition,
    captionDensity,
    exportDefaults: {
      format,
      includeTimestamps: elements.exportTimestamps.checked,
      includeSpeakerLabels: elements.exportSpeakerLabels.checked,
    },
  };
}

async function persist(elements: SettingsElements): Promise<void> {
  const token = ++saveToken;
  const nextSettings = readForm(elements);

  setStatus(elements, "saving", "Saving changes to local storage.");

  try {
    const saved = await setSettings(nextSettings);
    if (token !== saveToken) {
      return;
    }

    renderForm(elements, saved);
    setStatus(elements, "saved", "Preferences are saved locally in this browser profile.");
  } catch (error) {
    if (token !== saveToken) {
      return;
    }

    setStatus(
      elements,
      "error",
      error instanceof Error ? error.message : "Could not save the current settings.",
    );
  }
}

async function restoreDefaults(elements: SettingsElements): Promise<void> {
  const token = ++saveToken;
  setStatus(elements, "saving", "Restoring the product defaults.");

  try {
    const saved = await resetSettings();
    if (token !== saveToken) {
      return;
    }

    renderForm(elements, saved);
    setStatus(elements, "saved", "Default preferences restored and saved locally.");
  } catch (error) {
    if (token !== saveToken) {
      return;
    }

    setStatus(
      elements,
      "error",
      error instanceof Error ? error.message : "Could not restore the defaults.",
    );
  }
}

function syncSummary(elements: SettingsElements, settings: AppSettings): void {
  renderForm(elements, settings);
}

async function loadInitialState(elements: SettingsElements): Promise<void> {
  setStatus(elements, "loading", "Loading saved preferences from local storage.");

  try {
    const settings = await getSettings();
    syncSummary(elements, settings);
    setStatus(elements, "saved", "Saved preferences are ready. Rerun onboarding if setup changed.");
  } catch {
    syncSummary(elements, defaultSettings);
    setStatus(
      elements,
      "error",
      "Saved preferences could not be loaded, so the default values are shown for now.",
    );
  }

  hydrated = true;
}

export function initSettingsPage(): void {
  const elements = getElements();
  if (!elements) {
    return;
  }

  elements.form.addEventListener("change", () => {
    if (!hydrated) {
      return;
    }

    void persist(elements);
  });

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  elements.resetButton.addEventListener("click", () => {
    if (!hydrated) {
      return;
    }

    void restoreDefaults(elements);
  });

  elements.rerunOnboardingButton.addEventListener("click", () => {
    openExtensionPage("src/onboarding/onboarding.html", "../onboarding/onboarding.html");
  });

  elements.openDiagnosticsButton.addEventListener("click", () => {
    openExtensionPage("src/diagnostics/diagnostics.html", "../diagnostics/diagnostics.html");
  });

  void loadInitialState(elements);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSettingsPage, { once: true });
} else {
  initSettingsPage();
}
