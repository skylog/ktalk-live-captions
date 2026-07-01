import type { RuntimeResponse, SessionSnapshot, TranscriptSegment } from "../shared/protocol";

type OverlayState = "idle" | "listening" | "paused" | "reconnecting";

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

function statusLabel(nextState: OverlayState, session: SessionSnapshot | null): string {
  if (session?.session.phase === "finished" || (nextState === "idle" && (session?.transcript.length ?? 0) > 0)) {
    return "Stopped";
  }

  switch (nextState) {
    case "idle":
      return "Idle";
    case "paused":
      return "Paused";
    case "reconnecting":
      return "Reconnecting";
    case "listening":
    default:
      return "Listening";
  }
}

function deriveOverlayState(session: SessionSnapshot | null): OverlayState {
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

function render(session: SessionSnapshot | null): void {
  const shell = document.querySelector<HTMLElement>('[data-shell="overlay"]');
  if (!shell) {
    return;
  }

  const currentState = deriveOverlayState(session);
  const transcript = session?.transcript ?? [];
  const hasTranscript = transcript.length > 0;
  const status = shell.querySelector<HTMLElement>("[data-overlay-status]");
  const idleChip = shell.querySelector<HTMLElement>("[data-idle-chip]");
  const panel = shell.querySelector<HTMLElement>(".overlay-panel");
  const primaryAction = shell.querySelector<HTMLButtonElement>('[data-action="toggle-pause"]');
  const primaryCaption = shell.querySelector<HTMLElement>(".caption-line--primary");
  const secondaryCaption = shell.querySelector<HTMLElement>(".caption-line--secondary");

  shell.dataset.overlayState = currentState;

  if (idleChip) {
    idleChip.hidden = currentState !== "idle" || hasTranscript;
  }

  if (panel) {
    panel.hidden = currentState === "idle" && !hasTranscript;
  }

  if (status) {
    status.textContent = statusLabel(currentState, session);
  }

  if (primaryAction) {
    primaryAction.textContent =
      currentState === "paused" ? "Resume" : currentState === "idle" ? "Start" : "Pause";
  }

  const latestSegments = getLatestSegments(session);
  if (primaryCaption) {
    primaryCaption.textContent = latestSegments[0]?.text ?? "Waiting for the first caption.";
  }

  if (secondaryCaption) {
    secondaryCaption.textContent = latestSegments[1]?.text
      ? latestSegments[1].text
      : session?.session.phase === "finished"
        ? "Session ended. Open the transcript for the full notes."
        : currentState === "reconnecting"
          ? "Reconnecting to local service..."
          : hasTranscript
            ? `${transcript.length} caption${transcript.length === 1 ? "" : "s"} captured.`
            : "Waiting for meeting audio";
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
        const overlayAction =
          currentState === "paused"
            ? "resume"
            : currentState === "listening" || currentState === "reconnecting"
              ? "pause"
              : "start";
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
