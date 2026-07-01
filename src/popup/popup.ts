import type { RuntimeRequest, RuntimeResponse, SessionSnapshot, TranscriptSegment } from "../shared/protocol";

type PopupStatus = "unknown" | "ready" | "missing" | "active" | "reconnecting" | "idle";

type PopupState = {
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
};

const defaultState: PopupState = {
  service: {
    status: "unknown",
    label: "Checking",
    detail: "Local service state will appear here.",
  },
  captions: {
    status: "idle",
    label: "Idle",
    detail: "Captioning state will appear here.",
  },
  actionLabel: "Start captions",
  actionHint: "Connect the button to background state and command handling.",
};

const state: PopupState = { ...defaultState };
const runtimeState: PopupRuntimeState = {
  background: null,
};

const serviceStatusEl = document.getElementById("service-status");
const serviceValueEl = document.getElementById("service-status-value");
const captionStatusEl = document.getElementById("caption-status");
const captionValueEl = document.getElementById("caption-status-value");
const primaryActionEl = document.getElementById("primary-action");
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
  }

  if (actionHintEl) {
    actionHintEl.textContent = state.actionHint;
  }
}

function setState(nextState: Partial<PopupState>): void {
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
        detail: "Local ASR service is reachable.",
      };
    case "checking":
      return {
        status: "unknown",
        label: "Checking",
        detail: "Verifying local ASR service availability.",
      };
    case "unreachable":
      return {
        status: "missing",
        label: "Missing",
        detail: "Local ASR service is unavailable.",
      };
    case "degraded":
      return {
        status: "reconnecting",
        label: "Degraded",
        detail: health.reason ?? "Service latency is elevated.",
      };
    case "unknown":
    default:
      return {
        status: "unknown",
        label: "Unknown",
        detail: health.reason ?? "Local service state will appear here.",
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
        detail: "Preparing the local captioning session.",
      };
    case "listening":
      return {
        status: "active",
        label: "Active",
        detail: latestPreview ?? "Captions are flowing from the active meeting session.",
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
            : "The last session is complete.",
      };
    case "checking-agent":
      return {
        status: "unknown",
        label: "Checking",
        detail: "Scanning for a meeting surface.",
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
            : "Waiting for a supported meeting surface."),
      };
  }
}

function deriveAction(background: SessionSnapshot | null): { label: string; hint: string } {
  const phase = background?.session.phase ?? "idle";
  const transcript = background?.transcript ?? [];

  if (phase === "listening" || phase === "connecting" || phase === "reconnecting") {
    return {
      label: "Stop captions",
      hint: "Stop the active session and clear live state.",
    };
  }

  if (background?.session.health.status === "unreachable") {
    return {
      label: "Start captions",
      hint: "The local ASR service is unavailable. Fix the service before starting.",
    };
  }

  return {
    label: "Start captions",
    hint:
      transcript.length > 0
        ? "Start a new local caption session for the current meeting."
        : "Start the local caption session when a meeting is ready.",
  };
}

function applySnapshot(background: SessionSnapshot | null): void {
  runtimeState.background = background;

  const service = mapServiceState(background);
  const captions = mapCaptionState(background);
  const action = deriveAction(background);

  setState({
    service,
    captions,
    actionLabel: action.label,
    actionHint: action.hint,
  });
}

function setupRuntimeRefresh(): void {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }

    if ((message as { type?: string }).type === "ktalk.ui.refresh") {
      void refreshFromRuntime();
    }
  });
}

async function refreshFromRuntime(): Promise<void> {
  const background = await sendRuntimeMessage<RuntimeResponse>({ type: "session.get", requestId: createRequestId() }).then(
    (response) => (response?.type === "session.snapshot" ? response.snapshot : null),
  );

  applySnapshot(background);
}

async function toggleCaptions(): Promise<void> {
  const background = runtimeState.background;
  const phase = background?.session.phase ?? "idle";

  if (phase === "listening" || phase === "connecting" || phase === "reconnecting") {
    await sendRuntimeMessage<RuntimeResponse>({
      type: "session.end",
      requestId: createRequestId(),
      reason: "popup-stop-requested",
    });
    await refreshFromRuntime();
    return;
  }

  await sendRuntimeMessage<RuntimeResponse>({
    type: "session.start",
    requestId: createRequestId(),
  });
  await refreshFromRuntime();
}

document.addEventListener("DOMContentLoaded", () => {
  setupRuntimeRefresh();
  render();
  void refreshFromRuntime();
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
  refresh: refreshFromRuntime,
};

export {};
