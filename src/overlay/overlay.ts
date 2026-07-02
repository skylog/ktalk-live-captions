import type { RuntimeRequest, RuntimeResponse, SessionSnapshot, TranscriptSegment } from "../shared/protocol";

type OverlayState = "idle" | "loading" | "empty" | "listening" | "reconnecting" | "error";

type OverlayPresentation = {
  state: OverlayState;
  statusLabel: string;
  chipLabel: string;
  chipHint: string;
  title: string;
  summary: string;
  primaryCaption: string;
  secondaryCaption: string;
  primaryActionLabel: string;
};

const state = {
  session: null as SessionSnapshot | null,
  isRefreshing: false,
  isActionPending: false,
};

const SERVICE_ERROR_CODES = new Set(["service-unreachable", "permission-denied", "capture-failed", "socket-closed"]);

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getLatestSegments(session: SessionSnapshot | null): TranscriptSegment[] {
  return session?.transcript.slice(-2) ?? [];
}

function hasBlockingError(session: SessionSnapshot): boolean {
  const lastError = session.session.lastError;
  if (lastError && SERVICE_ERROR_CODES.has(lastError.code)) {
    return true;
  }

  return session.session.health.status === "unreachable";
}

function deriveOverlayState(session: SessionSnapshot | null): OverlayState {
  if (state.isRefreshing || state.isActionPending) {
    return "loading";
  }

  if (!session) {
    return "error";
  }

  if (session.session.phase === "reconnecting") {
    return "reconnecting";
  }

  if (session.session.phase === "checking-agent" || session.session.phase === "connecting") {
    return "loading";
  }

  if (hasBlockingError(session)) {
    return "error";
  }

  if (session.session.phase === "listening") {
    return session.transcript.length > 0 ? "listening" : "loading";
  }

  if (session.session.phase === "finished") {
    return session.transcript.length > 0 ? "idle" : "empty";
  }

  if (session.transcript.length > 0) {
    return "idle";
  }

  if (session.session.health.status === "checking") {
    return "loading";
  }

  return "empty";
}

function getOverlayPresentation(session: SessionSnapshot | null, currentState: OverlayState): OverlayPresentation {
  const transcript = session?.transcript ?? [];
  const latestSegments = getLatestSegments(session);
  const hasTranscript = transcript.length > 0;
  const lastError = session?.session.lastError;
  const reconnectAttempts = session?.session.reconnectAttempts ?? 0;
  const reconnectDelayMs = session?.session.reconnectDelayMs;
  const serviceReason = session?.session.health.reason ?? lastError?.message ?? "Check the local service and permissions in diagnostics.";
  const transcriptCountLabel = `${transcript.length} caption${transcript.length === 1 ? "" : "s"}`;

  switch (currentState) {
    case "listening":
      return {
        state: currentState,
        statusLabel: "Live",
        chipLabel: "Captions active",
        chipHint: "Audio is flowing through the local caption pipeline.",
        title: "Captions are live",
        summary: "Updates arrive as partial transcripts from the current meeting.",
        primaryCaption: latestSegments[0]?.text ?? "Listening for the first caption.",
        secondaryCaption:
          latestSegments[1]?.text ?? (hasTranscript ? `${transcriptCountLabel} captured locally.` : "Waiting for the first partial transcript."),
        primaryActionLabel: "Pause captions",
      };
    case "reconnecting":
      return {
        state: currentState,
        statusLabel: "Reconnecting",
        chipLabel: "Recovering stream",
        chipHint: "The local caption stream is trying to reconnect.",
        title: "Trying to recover the stream",
        summary:
          reconnectDelayMs !== null
            ? `Retry ${reconnectAttempts} is queued in ${reconnectDelayMs} ms.`
            : "The local caption stream is reconnecting automatically.",
        primaryCaption: latestSegments[0]?.text ?? "Waiting for the connection to recover.",
        secondaryCaption:
          latestSegments[1]?.text ?? "Captions resume automatically once the local transport is healthy again.",
        primaryActionLabel: "Pause captions",
      };
    case "error":
      return {
        state: currentState,
        statusLabel: "Error",
        chipLabel: "Setup needed",
        chipHint: "The local service or capture permissions need attention.",
        title: "Captions need attention",
        summary: serviceReason,
        primaryCaption: "Live captions are unavailable.",
        secondaryCaption:
          lastError?.recoverable === false
            ? lastError.message
            : "Start the local service or restore capture permissions, then retry.",
        primaryActionLabel: "Retry captions",
      };
    case "idle":
      return {
        state: currentState,
        statusLabel: "Stopped",
        chipLabel: hasTranscript ? "Session ended" : "Stopped",
        chipHint: hasTranscript
          ? `${transcriptCountLabel} captured locally.`
          : "The overlay will expand again when captions start.",
        title: hasTranscript ? "Session finished" : "Captions stopped",
        summary: hasTranscript
          ? "The transcript remains available in the sidebar until a new session starts."
          : "Start captions when a supported meeting tab is ready.",
        primaryCaption: latestSegments[0]?.text ?? "No transcript captured yet.",
        secondaryCaption: latestSegments[1]?.text ?? (hasTranscript ? "Latest captions are saved locally." : "Open a meeting tab to begin."),
        primaryActionLabel: "Start captions",
      };
    case "loading":
      return {
        state: currentState,
        statusLabel: "Loading",
        chipLabel: "Preparing captions",
        chipHint: "The overlay is checking the meeting and local service.",
        title: "Preparing captions",
        summary:
          session?.session.phase === "checking-agent"
            ? "Detecting a supported meeting tab."
            : session?.session.phase === "connecting"
              ? "Connecting to the local caption service."
              : "Waiting for the next local transcript update.",
        primaryCaption:
          session?.session.phase === "checking-agent"
            ? "Detecting the meeting tab."
            : session?.session.phase === "connecting"
              ? "Starting the local caption session."
              : "Waiting for the first partial transcript.",
        secondaryCaption:
          session?.session.phase === "checking-agent"
            ? "Keep the meeting tab open while the agent check runs."
            : session?.session.phase === "connecting"
              ? "The local service and browser session are syncing now."
              : "The current action is still in progress.",
        primaryActionLabel: "Pause captions",
      };
    case "empty":
    default:
      return {
        state: "empty",
        statusLabel: "Idle",
        chipLabel: "No meeting detected",
        chipHint: "Open a supported meeting tab to start local captions.",
        title: "No meeting detected",
        summary: "Open a supported meeting tab and press Start captions.",
        primaryCaption: "Waiting for meeting audio.",
        secondaryCaption: "The overlay stays compact until a session begins.",
        primaryActionLabel: "Start captions",
      };
  }
}

function render(session: SessionSnapshot | null): void {
  const shell = document.querySelector<HTMLElement>('[data-shell="overlay"]');
  if (!shell) {
    return;
  }

  const currentState = deriveOverlayState(session);
  const presentation = getOverlayPresentation(session, currentState);
  const status = shell.querySelector<HTMLElement>("[data-overlay-status]");
  const chip = shell.querySelector<HTMLElement>("[data-state-chip]");
  const chipLabel = shell.querySelector<HTMLElement>("[data-state-chip-label]");
  const chipHint = shell.querySelector<HTMLElement>("[data-state-chip-hint]");
  const panel = shell.querySelector<HTMLElement>(".overlay-panel");
  const primaryAction = shell.querySelector<HTMLButtonElement>('[data-action="toggle-pause"]');
  const openTranscriptAction = shell.querySelector<HTMLButtonElement>('[data-action="open-transcript"]');
  const title = shell.querySelector<HTMLElement>("[data-overlay-title]");
  const summary = shell.querySelector<HTMLElement>("[data-overlay-summary]");
  const primaryCaption = shell.querySelector<HTMLElement>(".caption-line--primary");
  const secondaryCaption = shell.querySelector<HTMLElement>(".caption-line--secondary");

  shell.dataset.overlayState = currentState;
  shell.dataset.overlayTheme = currentState;

  if (panel) {
    panel.dataset.overlayState = currentState;
    panel.hidden = currentState === "idle";
  }

  if (status) {
    status.textContent = presentation.statusLabel;
    status.dataset.status =
      currentState === "error"
        ? "error"
        : currentState === "reconnecting"
          ? "warning"
          : currentState === "listening"
            ? "healthy"
            : currentState === "loading"
              ? "warning"
              : "unknown";
  }

  if (chip) {
    chip.dataset.overlayState = currentState;
    chip.hidden = currentState !== "idle";
  }

  if (chipLabel) {
    chipLabel.textContent = presentation.chipLabel;
  }

  if (chipHint) {
    chipHint.textContent = presentation.chipHint;
  }

  if (title) {
    title.textContent = presentation.title;
  }

  if (summary) {
    summary.textContent = presentation.summary;
  }

  if (primaryAction) {
    primaryAction.textContent = presentation.primaryActionLabel;
    primaryAction.disabled = state.isRefreshing || state.isActionPending;
    primaryAction.setAttribute("aria-busy", state.isRefreshing || state.isActionPending ? "true" : "false");
  }

  if (openTranscriptAction) {
    openTranscriptAction.disabled = state.isRefreshing;
  }

  if (primaryCaption) {
    primaryCaption.textContent = presentation.primaryCaption;
  }

  if (secondaryCaption) {
    secondaryCaption.textContent = presentation.secondaryCaption;
  }
}

function sendRuntimeMessage<T>(message: Record<string, unknown>): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

      resolve(response ?? null);
    });
  });
}

function createRequestId(): string {
  return `overlay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function requestSessionSnapshot(): Promise<SessionSnapshot | null> {
  const response = await sendRuntimeMessage<RuntimeResponse>({
    type: "session.get",
    requestId: createRequestId(),
  } satisfies RuntimeRequest);

  return response?.type === "session.snapshot" ? response.snapshot : null;
}

async function refresh(): Promise<void> {
  state.isRefreshing = true;
  render(state.session);
  state.session = await requestSessionSnapshot();
  state.isRefreshing = false;
  render(state.session);
}

async function toggleCaptions(): Promise<void> {
  if (state.isActionPending) {
    return;
  }

  state.isActionPending = true;
  render(state.session);

  const currentState = deriveOverlayState(state.session);
  const shouldStop =
    currentState === "listening" || currentState === "reconnecting" || currentState === "loading";

  if (shouldStop) {
    await sendRuntimeMessage<RuntimeResponse>({
      type: "session.end",
      requestId: createRequestId(),
      reason: "overlay-stop-requested",
    } satisfies RuntimeRequest);
  } else {
    await sendRuntimeMessage<RuntimeResponse>({
      type: "session.start",
      requestId: createRequestId(),
    } satisfies RuntimeRequest);
  }

  await refresh();
  state.isActionPending = false;
  render(state.session);
}

async function openTranscriptSurface(): Promise<void> {
  await sendRuntimeMessage<RuntimeResponse>({
    type: "ktalk.ui.openSidebar",
  });
}

function setupInteractions(): void {
  const shell = document.querySelector<HTMLElement>('[data-shell="overlay"]');
  if (!shell) {
    return;
  }

  shell.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const actionButton = target?.closest<HTMLElement>("[data-action]");
    if (!actionButton) {
      return;
    }

    switch (actionButton.dataset.action) {
      case "toggle-pause":
        void toggleCaptions();
        break;
      case "open-transcript":
        void openTranscriptSurface();
        break;
      default:
        break;
    }
  });
}

function setupRuntimeRefresh(): void {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }

    if ((message as { type?: string }).type === "ktalk.ui.refresh") {
      void refresh();
    }
  });
}

function initOverlay(): void {
  setupInteractions();
  setupRuntimeRefresh();
  void refresh();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOverlay, { once: true });
} else {
  initOverlay();
}
