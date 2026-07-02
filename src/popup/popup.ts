import type { RuntimeRequest, RuntimeResponse, SessionSnapshot, TranscriptSegment } from "../shared/protocol";

type PopupStatus = "loading" | "unknown" | "ready" | "missing" | "active" | "reconnecting" | "idle" | "error";
type RefreshReason = "initial" | "manual" | "runtime" | "action";
type PopupMode = "loading" | "empty" | "ready" | "active" | "reconnecting" | "missing" | "error";

type PopupState = {
  title: string;
  description: string;
  banner: {
    status: PopupStatus;
    label: string;
    detail: string;
  };
  service: {
    status: PopupStatus;
    label: string;
    detail: string;
  };
  captions: {
    status: PopupStatus;
    label: string;
    detail: string;
  };
  actionLabel: string;
  actionHint: string;
};

type PopupRuntimeState = {
  background: SessionSnapshot | null;
  isRefreshing: boolean;
  isActionPending: boolean;
};

const defaultState: PopupState = {
  title: "Live captions",
  description: "Checking the extension, local service, and current session.",
  banner: {
    status: "loading",
    label: "Loading",
    detail: "Waiting for the current session state.",
  },
  service: {
    status: "loading",
    label: "Checking service",
    detail: "Verifying that the local ASR service is ready.",
  },
  captions: {
    status: "loading",
    label: "Loading",
    detail: "Waiting for the current session state.",
  },
  actionLabel: "Refresh status",
  actionHint: "Wait for the current connection check to finish.",
};

const state: PopupState = { ...defaultState, banner: { ...defaultState.banner }, service: { ...defaultState.service }, captions: { ...defaultState.captions } };
const runtimeState: PopupRuntimeState = {
  background: null,
  isRefreshing: false,
  isActionPending: false,
};

const popupTitleEl = document.getElementById("popup-title");
const popupDescriptionEl = document.getElementById("popup-description");
const popupBannerEl = document.getElementById("popup-banner");
const popupBannerLabelEl = document.getElementById("popup-banner-label");
const popupBannerValueEl = document.getElementById("popup-banner-value");
const serviceStatusEl = document.getElementById("service-status");
const serviceValueEl = document.getElementById("service-status-value");
const captionStatusEl = document.getElementById("caption-status");
const captionValueEl = document.getElementById("caption-status-value");
const primaryActionEl = document.getElementById("primary-action") as HTMLButtonElement | null;
const refreshActionEl = document.getElementById("refresh-action") as HTMLButtonElement | null;
const actionHintEl = document.getElementById("action-hint");

function syncStatus(element: HTMLElement | null, status: PopupStatus, label: string): void {
  if (!element) {
    return;
  }

  element.dataset.status = status;
  element.textContent = label;
}

function render(): void {
  if (popupTitleEl) {
    popupTitleEl.textContent = state.title;
  }

  if (popupDescriptionEl) {
    popupDescriptionEl.textContent = state.description;
  }

  if (popupBannerEl) {
    popupBannerEl.dataset.status = state.banner.status;
  }

  if (popupBannerLabelEl) {
    popupBannerLabelEl.textContent = state.banner.label;
  }

  if (popupBannerValueEl) {
    popupBannerValueEl.textContent = state.banner.detail;
  }

  syncStatus(serviceStatusEl, state.service.status, state.service.label);
  syncStatus(captionStatusEl, state.captions.status, state.captions.label);

  if (serviceValueEl) {
    serviceValueEl.textContent = state.service.detail;
  }

  if (captionValueEl) {
    captionValueEl.textContent = state.captions.detail;
  }

  if (primaryActionEl) {
    primaryActionEl.textContent = state.actionLabel;
    primaryActionEl.disabled = runtimeState.isRefreshing || runtimeState.isActionPending;
    primaryActionEl.setAttribute("aria-busy", runtimeState.isRefreshing || runtimeState.isActionPending ? "true" : "false");
  }

  if (refreshActionEl) {
    refreshActionEl.disabled = runtimeState.isRefreshing || runtimeState.isActionPending;
    refreshActionEl.setAttribute("aria-busy", runtimeState.isRefreshing ? "true" : "false");
  }

  if (actionHintEl) {
    actionHintEl.textContent = state.actionHint;
  }
}

function setState(nextState: Partial<PopupState>): void {
  if (typeof nextState.title === "string") {
    state.title = nextState.title;
  }

  if (typeof nextState.description === "string") {
    state.description = nextState.description;
  }

  if (nextState.banner) {
    state.banner = { ...state.banner, ...nextState.banner };
  }

  if (nextState.service) {
    state.service = { ...state.service, ...nextState.service };
  }

  if (nextState.captions) {
    state.captions = { ...state.captions, ...nextState.captions };
  }

  if (typeof nextState.actionLabel === "string") {
    state.actionLabel = nextState.actionLabel;
  }

  if (typeof nextState.actionHint === "string") {
    state.actionHint = nextState.actionHint;
  }

  render();
}

function createRequestId(): string {
  return `popup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function sendRuntimeMessage<T>(message: RuntimeRequest): Promise<T | null> {
  return await new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), 800);

    chrome.runtime.sendMessage(message, (response: T) => {
      const error = chrome.runtime.lastError;
      window.clearTimeout(timeout);

      if (error) {
        resolve(null);
        return;
      }

      resolve(response ?? null);
    });
  });
}

function formatTranscriptPreview(segment: TranscriptSegment | undefined): string | null {
  if (!segment) {
    return null;
  }

  const prefix = segment.status === "partial" ? "Latest caption" : "Last caption";
  return `${prefix}: ${segment.text}`;
}

function makeMissingServiceState(message: string): PopupState["service"] {
  return {
    status: "missing",
    label: "Not reachable",
    detail: message,
  };
}

function makeErrorServiceState(message: string): PopupState["service"] {
  return {
    status: "error",
    label: "Error",
    detail: message,
  };
}

function isCaptionsActivePhase(phase: SessionSnapshot["session"]["phase"]): boolean {
  return phase === "checking-agent" || phase === "connecting" || phase === "listening" || phase === "reconnecting";
}

function derivePopupMode(background: SessionSnapshot | null): PopupMode {
  if (runtimeState.isRefreshing || runtimeState.isActionPending) {
    return "loading";
  }

  if (!background) {
    return "missing";
  }

  const phase = background.session.phase;
  const transcript = background.transcript;

  if (background.session.health.status === "unreachable" || background.session.lastError?.code === "service-unreachable") {
    return "missing";
  }

  if (background.session.lastError?.code === "permission-denied" || background.session.lastError?.code === "capture-failed") {
    return "error";
  }

  if (phase === "reconnecting") {
    return "reconnecting";
  }

  if (phase === "checking-agent" || phase === "connecting") {
    return "loading";
  }

  if (phase === "listening") {
    return "active";
  }

  if (phase === "finished") {
    return transcript.length > 0 ? "ready" : "empty";
  }

  if (transcript.length > 0) {
    return "ready";
  }

  return background.session.health.status === "ready" ? "empty" : "loading";
}

function mapServiceState(snapshot: SessionSnapshot | null): PopupState["service"] {
  const health = snapshot?.session.health;
  if (!health) {
    return defaultState.service;
  }

  switch (health.status) {
    case "ready":
      return {
        status: "ready",
        label: "Ready",
        detail: "Local ASR is reachable at localhost:8000/asr.",
      };
    case "checking":
      return {
        status: "loading",
        label: "Checking",
        detail: "Verifying the local ASR endpoint before captions start.",
      };
    case "unreachable":
      return makeMissingServiceState("Nothing is listening on localhost:8000/asr. Start the local ASR service, then retry.");
    case "degraded":
      return {
        status: "reconnecting",
        label: "Degraded",
        detail: health.reason ?? "The local ASR service is slow or reconnecting.",
      };
    case "unknown":
    default:
      return {
        status: "unknown",
        label: "Unknown",
        detail: health.reason ?? "Waiting for the next local service check.",
      };
  }
}

function mapCaptionState(background: SessionSnapshot | null, mode: PopupMode): PopupState["captions"] {
  const phase = background?.session.phase ?? "idle";
  const transcript = background?.transcript ?? [];
  const latestSegment = transcript[transcript.length - 1];
  const latestPreview = formatTranscriptPreview(latestSegment);
  const startedAt = background?.session.startedAt ?? null;
  const endedAt = background?.session.endedAt ?? null;

  switch (mode) {
    case "loading":
      return {
        status: "loading",
        label: "Loading",
        detail:
          phase === "checking-agent"
            ? "Detecting a supported meeting tab."
            : phase === "connecting"
              ? "Starting the live caption session."
              : "Waiting for the current session state.",
      };
    case "active":
      return {
        status: "active",
        label: "Live",
        detail: latestPreview ?? "Captions are streaming from the active meeting session.",
      };
    case "reconnecting":
      return {
        status: "reconnecting",
        label: "Reconnecting",
        detail: latestPreview ?? "Trying to restore the live caption stream.",
      };
    case "ready":
      return {
        status: "ready",
        label: "Ready",
        detail:
          latestPreview ??
          (transcript.length > 0
            ? `${transcript.length} transcript segment${transcript.length === 1 ? "" : "s"} captured.`
            : "A previous session is available and ready to review."),
      };
    case "missing":
      return {
        status: "missing",
        label: "Unavailable",
        detail: "The local service is offline or the popup could not reach the background worker.",
      };
    case "error":
      return {
        status: "error",
        label: "Blocked",
        detail:
          background?.session.lastError?.message ??
          "Restore capture permissions or the local service before starting again.",
      };
    case "empty":
    default:
      return {
        status: "idle",
        label: transcript.length > 0 || startedAt !== null ? "Ready" : "Idle",
        detail:
          latestPreview ??
          (transcript.length > 0
            ? `${transcript.length} transcript segment${transcript.length === 1 ? "" : "s"} captured.`
            : endedAt !== null
              ? `The last session ended at ${formatTime(endedAt)}.`
              : "Waiting for a supported meeting tab."),
      };
  }
}

function deriveBannerState(background: SessionSnapshot | null, mode: PopupMode): PopupState["banner"] {
  const transcript = background?.transcript ?? [];
  const startedAt = background?.session.startedAt ?? null;
  const endedAt = background?.session.endedAt ?? null;
  const reconnectDelayMs = background?.session.reconnectDelayMs ?? null;

  switch (mode) {
    case "loading":
      return {
        status: "loading",
        label: background?.session.phase === "checking-agent" ? "Checking" : "Refreshing",
        detail:
          background?.session.phase === "checking-agent"
            ? "Detecting the meeting tab and local service."
            : background?.session.phase === "connecting"
              ? "Connecting audio to the local caption service."
              : "Refreshing the current session state.",
      };
    case "active":
      return {
        status: "active",
        label: "Captions active",
        detail: "Use Stop captions to end the current session.",
      };
    case "reconnecting":
      return {
        status: "reconnecting",
        label: "Recovering",
        detail:
          reconnectDelayMs !== null
            ? `Retrying in ${reconnectDelayMs} ms.`
            : "The session is reconnecting automatically.",
      };
    case "ready":
      return {
        status: "ready",
        label: transcript.length > 0 ? "Ready to start" : "Ready",
        detail:
          transcript.length > 0
            ? "A transcript exists and you can start a new local session."
            : startedAt !== null
              ? `The last session started at ${formatTime(startedAt)}.`
              : "The popup is ready to start captions.",
      };
    case "missing":
      return {
        status: "missing",
        label: "Service offline",
        detail: "Start the local ASR service at localhost:8000/asr, then retry.",
      };
    case "error":
      return {
        status: "error",
        label: "Capture blocked",
        detail: background?.session.lastError?.message ?? "Restore permissions or the local service, then try again.",
      };
    case "empty":
    default:
      return {
        status: "idle",
        label: "No meeting detected",
        detail: endedAt !== null ? `The last session ended at ${formatTime(endedAt)}.` : "Open a meeting tab, then press Start captions.",
      };
  }
}

function deriveAction(background: SessionSnapshot | null, mode: PopupMode): { label: string; hint: string } {
  const transcript = background?.transcript ?? [];

  if (mode === "active" || mode === "reconnecting" || mode === "loading") {
    return {
      label: "Stop captions",
      hint: "End the current local session and keep the transcript on the device.",
    };
  }

  if (mode === "missing" || mode === "error") {
    return {
      label: "Retry",
      hint: "Restore the local service or capture permission, then try again.",
    };
  }

  return {
    label: "Start captions",
    hint:
      transcript.length > 0
        ? "Start a new local caption session for this meeting."
        : "Start captions when the meeting tab is ready.",
  };
}

function applySnapshot(background: SessionSnapshot | null): void {
  runtimeState.background = background;
  runtimeState.isRefreshing = false;

  const mode = derivePopupMode(background);
  const service = mapServiceState(background);
  const captions = mapCaptionState(background, mode);
  const banner = deriveBannerState(background, mode);
  const action = deriveAction(background, mode);

  setState({
    title: "Live captions",
    description:
      mode === "active" || mode === "reconnecting"
        ? "The popup is connected and ready for quick control."
        : mode === "missing"
          ? "The local service is unavailable."
          : mode === "error"
            ? "Caption capture needs attention."
            : mode === "ready"
              ? "A previous session exists and you can start a new one."
              : "Checking the local session state.",
    banner,
    service,
    captions,
    actionLabel: action.label,
    actionHint: action.hint,
  });
}

function applyRuntimeUnavailable(): void {
  runtimeState.background = null;
  runtimeState.isRefreshing = false;
  setState({
    title: "Live captions",
    description: "The popup lost contact with the background worker.",
    banner: {
      status: "error",
      label: "Background unavailable",
      detail: "Reload the extension, then open the popup again to reconnect.",
    },
    service: makeMissingServiceState("Reload the extension, then open the popup again to reconnect."),
    captions: {
      status: "error",
      label: "Unavailable",
      detail: "The current session state is not available right now.",
    },
    actionLabel: "Retry",
    actionHint: "The background worker is unavailable. Restore the local service, then try again.",
  });
}

function setupRuntimeRefresh(): void {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }

    if ((message as { type?: string }).type === "ktalk.ui.refresh") {
      void refreshFromRuntime("runtime");
    }
  });
}

async function refreshFromRuntime(reason: RefreshReason = "manual"): Promise<void> {
  runtimeState.isRefreshing = true;
  const currentBackground = runtimeState.background;
  const currentMode = derivePopupMode(currentBackground);
  const action = deriveAction(currentBackground, currentMode);

  setState({
    title: "Live captions",
    description:
      reason === "initial"
        ? "Checking the extension, local service, and current session."
        : "Refreshing the current session state.",
    banner: {
      status: "loading",
      label: reason === "initial" ? "Checking" : "Refreshing",
      detail:
        reason === "initial"
          ? "Verifying that the popup can reach the local caption pipeline."
          : "Waiting for the current session state.",
    },
    service: {
      status: "loading",
      label: "Checking",
      detail: "Verifying that the local ASR service is ready.",
    },
    captions: {
      status: "loading",
      label: "Loading",
      detail: "Waiting for the current session state.",
    },
    actionLabel: action.label,
    actionHint: action.hint,
  });

  const background = await sendRuntimeMessage<RuntimeResponse>({
    type: "session.get",
    requestId: createRequestId(),
  }).then((response) => (response?.type === "session.snapshot" ? response.snapshot : null));

  if (!background) {
    applyRuntimeUnavailable();
    return;
  }

  applySnapshot(background);
}

async function toggleCaptions(): Promise<void> {
  if (runtimeState.isActionPending) {
    return;
  }

  const background = runtimeState.background;
  const mode = derivePopupMode(background);
  const phase = background?.session.phase ?? "idle";

  runtimeState.isActionPending = true;
  setState({
    banner: {
      status: "loading",
      label: mode === "active" ? "Stopping" : "Starting",
      detail: mode === "active" ? "Ending the current local session." : "Starting the local caption session.",
    },
    actionLabel: mode === "active" ? "Stop captions" : mode === "missing" || mode === "error" ? "Retry" : "Start captions",
    actionHint:
      mode === "missing" || mode === "error"
        ? "Restore the local service or capture permission, then try again."
        : mode === "active"
          ? "End the current local session and keep the transcript on the device."
          : "Start captions when the meeting tab is ready.",
  });

  try {
    if (isCaptionsActivePhase(phase)) {
      await sendRuntimeMessage<RuntimeResponse>({
        type: "session.end",
        requestId: createRequestId(),
        reason: "popup-stop-requested",
      });
      await refreshFromRuntime("action");
      return;
    }

    await sendRuntimeMessage<RuntimeResponse>({
      type: "session.start",
      requestId: createRequestId(),
    });
    await refreshFromRuntime("action");
  } finally {
    runtimeState.isActionPending = false;
    render();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupRuntimeRefresh();
  void refreshFromRuntime("initial");
});

primaryActionEl?.addEventListener("click", () => {
  void toggleCaptions();
});

refreshActionEl?.addEventListener("click", () => {
  void refreshFromRuntime("manual");
});

declare global {
  interface Window {
    popupShell?: {
      setState: typeof setState;
      getState: () => PopupState;
      refresh: () => Promise<void>;
    };
  }
}

window.popupShell = {
  setState,
  getState: () => ({
    ...state,
    banner: { ...state.banner },
    service: { ...state.service },
    captions: { ...state.captions },
  }),
  refresh: () => refreshFromRuntime("manual"),
};

export {};
