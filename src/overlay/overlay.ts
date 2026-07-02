import type { RuntimeResponse, SessionSnapshot, TranscriptSegment } from "../shared/protocol";

type OverlayState = "idle" | "listening" | "reconnecting" | "missing";

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
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getLatestSegments(session: SessionSnapshot | null): TranscriptSegment[] {
  return session?.transcript.slice(-2) ?? [];
}

function deriveOverlayState(session: SessionSnapshot | null): OverlayState {
  if (!session) {
    return "missing";
  }

  if (session.session.phase === "reconnecting") {
    return "reconnecting";
  }

  if (
    session.session.health.status === "unreachable" ||
    session.session.lastError?.code === "service-unreachable" ||
    session.session.lastError?.code === "permission-denied" ||
    session.session.lastError?.code === "capture-failed"
  ) {
    return "missing";
  }

  const phase = session?.session.phase ?? "idle";

  switch (phase) {
    case "connecting":
    case "checking-agent":
      return "reconnecting";
    case "listening":
      return "listening";
    case "reconnecting":
      return "reconnecting";
    case "finished":
      return "idle";
    case "idle":
    default:
      return "idle";
  }
}

function getOverlayPresentation(session: SessionSnapshot | null, currentState: OverlayState): OverlayPresentation {
  const transcript = session?.transcript ?? [];
  const latestSegments = getLatestSegments(session);
  const hasTranscript = transcript.length > 0;
  const isFinished = session?.session.phase === "finished";
  const reconnectAttempts = session?.session.reconnectAttempts ?? 0;
  const reconnectDelayMs = session?.session.reconnectDelayMs;
  const lastError = session?.session.lastError;
  const fallbackReason =
    session?.session.health.reason ??
    lastError?.message ??
    "Check the local service and extension permissions in diagnostics.";

  switch (currentState) {
    case "listening":
      return {
        state: currentState,
        statusLabel: "Listening",
        chipLabel: "Live captions active",
        chipHint: "Audio is flowing through the local caption pipeline.",
        title: "Listening to the meeting",
        summary: "Captions update in real time while the current meeting stays active.",
        primaryCaption: latestSegments[0]?.text ?? "Listening for the first caption.",
        secondaryCaption:
          latestSegments[1]?.text ??
          (hasTranscript
            ? `${transcript.length} caption${transcript.length === 1 ? "" : "s"} captured locally.`
            : "Keep speaking in the meeting tab to populate the transcript."),
        primaryActionLabel: "Pause captions",
      };
    case "reconnecting":
      return {
        state: currentState,
        statusLabel: "Reconnecting",
        chipLabel: "Reconnecting",
        chipHint: "The overlay is waiting for the local service to recover.",
        title: "Trying to recover the stream",
        summary:
          reconnectDelayMs !== null
            ? `Retry ${reconnectAttempts} is queued in ${reconnectDelayMs} ms.`
            : "The overlay is waiting for the local service to come back.",
        primaryCaption: latestSegments[0]?.text ?? "Waiting for the connection to recover.",
        secondaryCaption:
          latestSegments[1]?.text ??
          "Captions resume automatically once the local transport is healthy again.",
        primaryActionLabel: "Pause captions",
      };
    case "missing":
      return {
        state: currentState,
        statusLabel: "Missing",
        chipLabel: "Setup missing",
        chipHint: "Local service or browser access is unavailable.",
        title: "Local setup is missing",
        summary: fallbackReason,
        primaryCaption: "Live captions are unavailable.",
        secondaryCaption:
          lastError?.recoverable === false
            ? lastError.message
            : "Start the local service, restore capture permissions, then refresh the overlay.",
        primaryActionLabel: "Start captions",
      };
    case "idle":
    default:
      return {
        state: "idle",
        statusLabel: isFinished || hasTranscript ? "Stopped" : "Idle",
        chipLabel: isFinished ? "Session ended" : hasTranscript ? "Latest captions saved" : "Waiting",
        chipHint: isFinished
          ? "The last transcript stays visible until the next session starts."
          : hasTranscript
            ? `${transcript.length} caption${transcript.length === 1 ? "" : "s"} captured locally.`
            : "Open a supported meeting tab to begin local captions.",
        title: isFinished ? "Session finished" : "Waiting for meeting audio",
        summary: isFinished
          ? "The last transcript remains available until a new session starts."
          : "Captions stay local and update as soon as a meeting is detected.",
        primaryCaption: latestSegments[0]?.text ?? "Waiting for meeting audio.",
        secondaryCaption: latestSegments[1]?.text ?? (hasTranscript ? "Latest captions are preserved locally." : "The overlay stays small until captions begin."),
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
  const title = shell.querySelector<HTMLElement>("[data-overlay-title]");
  const summary = shell.querySelector<HTMLElement>("[data-overlay-summary]");
  const primaryCaption = shell.querySelector<HTMLElement>(".caption-line--primary");
  const secondaryCaption = shell.querySelector<HTMLElement>(".caption-line--secondary");

  shell.dataset.overlayState = currentState;

  if (panel) {
    panel.dataset.overlayState = currentState;
  }

  if (status) {
    status.textContent = presentation.statusLabel;
    status.dataset.status =
      currentState === "missing" ? "error" : currentState === "reconnecting" ? "warning" : currentState === "listening" ? "healthy" : "unknown";
  }

  if (chip) {
    chip.dataset.overlayState = currentState;
    chip.hidden = currentState === "listening";
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

async function refresh(): Promise<void> {
  const response = await sendRuntimeMessage<RuntimeResponse>({ type: "session.get" });
  state.session = response?.type === "session.snapshot" ? response.snapshot : null;
  render(state.session);
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

    const action = actionButton.dataset.action;
    switch (action) {
      case "toggle-pause": {
        const currentState = shell.dataset.overlayState as OverlayState | undefined;
        const overlayAction = currentState === "listening" || currentState === "reconnecting" ? "pause" : "start";
        shell.dispatchEvent(
          new CustomEvent("ktalk:overlay-action", {
            bubbles: true,
            detail: { action: overlayAction },
          }),
        );
        break;
      }
      case "open-transcript":
        shell.dispatchEvent(
          new CustomEvent("ktalk:overlay-action", {
            bubbles: true,
            detail: { action: "open-transcript" },
          }),
        );
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
