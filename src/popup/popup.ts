import type { RuntimeRequest, RuntimeResponse, SessionSnapshot, TranscriptSegment } from "../shared/protocol";

type PopupStatus = "loading" | "unknown" | "ready" | "missing" | "active" | "reconnecting" | "idle" | "error";
type RefreshReason = "initial" | "manual" | "runtime" | "action";

type PopupState = {
  title: string;
  description: string;
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

const state: PopupState = { ...defaultState };
const runtimeState: PopupRuntimeState = {
  background: null,
  isRefreshing: false,
  isActionPending: false,
};

const popupTitleEl = document.getElementById("popup-title");
const popupDescriptionEl = document.getElementById("popup-description");
const serviceStatusEl = document.getElementById("service-status");
const serviceValueEl = document.getElementById("service-status-value");
const captionStatusEl = document.getElementById("caption-status");
const captionValueEl = document.getElementById("caption-status-value");
const primaryActionEl = document.getElementById("primary-action") as HTMLButtonElement | null;
const refreshActionEl = document.getElementById("refresh-action") as HTMLButtonElement | null;
const actionHintEl = document.getElementById("action-hint");

function syncStatus(
  element: HTMLElement | null,
  status: PopupStatus,
  label: string,
): void {
  if (!element) return;
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
    primaryActionEl.disabled = runtimeState.isActionPending;
    primaryActionEl.setAttribute("aria-busy", runtimeState.isActionPending ? "true" : "false");
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

function makeRuntimeUnavailableState(): PopupState {
  return {
    title: "Live captions",
    description: "The popup could not reach the background worker.",
    service: makeMissingServiceState(
      "Reload the extension, then open the popup again to reconnect.",
    ),
    captions: {
      status: "error",
      label: "Unavailable",
      detail: "The current session state is not available right now.",
    },
    actionLabel: "Start captions",
    actionHint: "The background worker is unavailable. Restore the local service, then try again.",
  };
}

function makeLoadingState(reason: RefreshReason, action: { label: string; hint: string }): PopupState {
  return {
    title: "Live captions",
    description:
      reason === "initial"
        ? "Checking the extension and local service."
        : "Refreshing the current session state.",
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
    actionLabel: action.label,
    actionHint: action.hint,
  };
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
      return makeMissingServiceState(
        "Nothing is listening on localhost:8000/asr. Start the local ASR service, then refresh.",
      );
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

function mapCaptionState(background: SessionSnapshot | null): PopupState["captions"] {
  const phase = background?.session.phase ?? "idle";
  const transcript = background?.transcript ?? [];
  const latestSegment = transcript[transcript.length - 1];
  const latestPreview = formatTranscriptPreview(latestSegment);
  const startedAt = background?.session.startedAt;
  const endedAt = background?.session.endedAt;

  switch (phase) {
    case "connecting":
      return {
        status: "reconnecting",
        label: "Connecting",
        detail: "Starting the live caption session for the current meeting.",
      };
    case "listening":
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
    case "finished":
      return {
        status: "idle",
        label: "Stopped",
        detail:
          typeof endedAt === "number"
            ? `The last session ended at ${formatTime(endedAt)}.`
            : "The last caption session is complete.",
      };
    case "checking-agent":
      return {
        status: "loading",
        label: "Checking",
        detail: "Looking for a supported meeting tab.",
      };
    case "idle":
    default:
      return {
        status: "idle",
        label: transcript.length > 0 || startedAt !== null ? "Ready" : "Idle",
        detail:
          latestPreview ??
          (transcript.length > 0
            ? `${transcript.length} transcript segment${transcript.length === 1 ? "" : "s"} captured.`
            : "Waiting for a supported meeting tab."),
      };
  }
}

function deriveAction(background: SessionSnapshot | null): { label: string; hint: string } {
  const phase = background?.session.phase ?? "idle";
  const transcript = background?.transcript ?? [];

  if (phase === "listening" || phase === "connecting" || phase === "reconnecting") {
    return {
      label: "Stop captions",
      hint: "End the current session and keep the latest transcript state locally.",
    };
  }

  if (background?.session.health.status === "unreachable") {
    return {
      label: "Start captions",
      hint: "Start will fail until the local ASR service is running on localhost:8000.",
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

  const service = mapServiceState(background);
  const captions = mapCaptionState(background);
  const action = deriveAction(background);

  setState({
    title: "Live captions",
    description:
      service.status === "ready" || captions.status === "active"
        ? "The popup is connected and ready for quick control."
        : service.status === "missing"
          ? "The local service is unavailable."
          : captions.status === "reconnecting"
            ? "The session is reconnecting."
            : captions.status === "idle" && captions.label === "Ready"
              ? "A previous session exists and you can start a new one."
              : "Checking the local session state.",
    service,
    captions,
    actionLabel: action.label,
    actionHint: action.hint,
  });
}

function applyRuntimeUnavailable(): void {
  runtimeState.background = null;
  runtimeState.isRefreshing = false;
  setState(makeRuntimeUnavailableState());
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
  const action = runtimeState.background
    ? deriveAction(runtimeState.background)
    : {
        label: "Start captions",
        hint: "Wait for the current check to finish.",
      };
  setState(makeLoadingState(reason, action));

  const background = await sendRuntimeMessage<RuntimeResponse>({ type: "session.get", requestId: createRequestId() }).then(
    (response) => (response?.type === "session.snapshot" ? response.snapshot : null),
  );

  if (!background) {
    applyRuntimeUnavailable();
    return;
  }

  applySnapshot(background);
}

async function toggleCaptions(): Promise<void> {
  const background = runtimeState.background;
  const phase = background?.session.phase ?? "idle";

  runtimeState.isActionPending = true;
  setState(makeLoadingState("action", deriveAction(background)));

  try {
    if (phase === "listening" || phase === "connecting" || phase === "reconnecting") {
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
  window.dispatchEvent(
    new CustomEvent("popup:primary-action", {
      detail: {
        serviceStatus: state.service.status,
        captionStatus: state.captions.status,
      },
    }),
  );
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
  getState: () => ({ ...state, service: { ...state.service }, captions: { ...state.captions } }),
  refresh: () => refreshFromRuntime("manual"),
};

export {};
