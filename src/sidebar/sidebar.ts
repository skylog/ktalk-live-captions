import type { RuntimeResponse, SessionSnapshot, TranscriptSegment } from "../shared/protocol";

type HistoryEntry = {
  id: string;
  label: string;
  range: string;
  preview: string;
};

type SidebarState = {
  session: SessionSnapshot | null;
};

const state: SidebarState = {
  session: null,
};

const transcriptText = (segments: ReadonlyArray<TranscriptSegment>): string =>
  segments.map((segment) => `${formatTime(segment.timestamp)} ${segment.text}`).join("\n");

const transcriptAsMarkdown = (segments: ReadonlyArray<TranscriptSegment>): string =>
  segments.map((segment) => `- ${formatTime(segment.timestamp)} ${segment.text}`).join("\n");

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSegmentPreview(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 96) {
    return compact;
  }

  return `${compact.slice(0, 93)}...`;
}

function formatSessionRange(session: SessionSnapshot | null): string {
  if (!session) {
    return "Waiting for session";
  }

  const startedAt = session.session.startedAt ?? session.transcript[0]?.timestamp ?? null;
  if (startedAt === null) {
    return "Waiting for session";
  }

  const endedAt = session.session.endedAt ?? null;
  return `${formatTime(startedAt)} - ${endedAt !== null ? formatTime(endedAt) : "Now"}`;
}

function describePhase(phase: SessionSnapshot["session"]["phase"]): string {
  switch (phase) {
    case "checking-agent":
      return "Checking agent";
    case "connecting":
      return "Connecting";
    case "listening":
      return "Captions active";
    case "reconnecting":
      return "Reconnecting";
    case "finished":
      return "Session complete";
    case "idle":
    default:
      return "Idle";
  }
}

function buildHistoryEntries(session: SessionSnapshot | null): HistoryEntry[] {
  if (!session) {
    return [
      {
        id: "no-session",
        label: "No transcript yet",
        range: "Waiting",
        preview: "Start captions to capture the first live segment.",
      },
    ];
  }

  const transcript = session.transcript;
  const latestSegment = transcript[transcript.length - 1];
  const entries: HistoryEntry[] = [
    {
      id: session.session.sessionId ?? "live-session",
      label: describePhase(session.session.phase),
      range: formatSessionRange(session),
      preview:
        latestSegment !== undefined
          ? `${transcript.length} segment${transcript.length === 1 ? "" : "s"} captured. ${formatSegmentPreview(latestSegment.text)}`
          : session.session.phase === "idle"
            ? "Start captions to capture the first live segment."
            : "Waiting for the first transcript segment.",
    },
  ];

  for (const segment of transcript.slice(-2).reverse()) {
    entries.push({
      id: segment.segmentId,
      label: segment.status === "final" ? "Final caption" : "Partial caption",
      range: formatTime(segment.timestamp),
      preview: formatSegmentPreview(segment.text),
    });
  }

  return entries.slice(0, 3);
}

function renderHistory(historyList: HTMLElement | null): void {
  if (!historyList) {
    return;
  }

  const entries = buildHistoryEntries(state.session);
  historyList.innerHTML = entries
    .map(
      (entry, index) => `
        <button class="history-card${index === 0 ? " history-card--active" : ""}" type="button" data-session-id="${entry.id}">
          <span class="history-date">${entry.label}</span>
          <span class="history-range">${entry.range}</span>
          <span class="history-preview">${entry.preview}</span>
        </button>
      `,
    )
    .join("");
}

function renderTranscript(stream: HTMLElement | null, emptyState: HTMLElement | null): void {
  if (!stream || !emptyState) {
    return;
  }

  const transcript = state.session?.transcript ?? [];
  if (transcript.length === 0) {
    stream.innerHTML = "";
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  stream.innerHTML = transcript
    .map((segment) => {
      const partialClass = segment.status === "partial" ? " segment-card--partial" : "";
      return `
        <article class="segment-card${partialClass}">
          <div class="segment-time">${formatTime(segment.timestamp)}</div>
          <p class="segment-text">${segment.text}</p>
        </article>
      `;
    })
    .join("");
}

function renderSessionSummary(statusPill: HTMLElement | null, sessionRange: HTMLElement | null): void {
  if (statusPill) {
    const phase = state.session?.session.phase ?? "idle";
    const transcript = state.session?.transcript ?? [];
    statusPill.textContent =
      phase === "idle" && transcript.length > 0 ? "Transcript ready" : describePhase(phase);
  }

  if (sessionRange) {
    const startedAt = state.session?.session.startedAt ?? state.session?.transcript[0]?.timestamp ?? null;
    const endedAt = state.session?.session.endedAt ?? null;
    if (startedAt) {
      const start = formatTime(startedAt);
      const end = endedAt ? formatTime(endedAt) : "Now";
      sessionRange.textContent = `${start} - ${end}`;
      return;
    }

    sessionRange.textContent = "Waiting for session";
  }
}

function render(shell: HTMLElement): void {
  const stream = shell.querySelector<HTMLElement>("[data-transcript-stream]");
  const historyList = shell.querySelector<HTMLElement>("[data-history-list]");
  const emptyState = shell.querySelector<HTMLElement>("[data-empty-state]");
  const statusPill = shell.querySelector<HTMLElement>("[data-status-pill]");
  const sessionRange = shell.querySelector<HTMLElement>("[data-session-range]");
  const transcript = state.session?.transcript ?? [];

  renderTranscript(stream, emptyState);
  renderHistory(historyList);
  renderSessionSummary(statusPill, sessionRange);
  shell.dataset.sidebarState =
    state.session?.session.phase ?? (transcript.length > 0 ? "transcript-ready" : "empty");
}

function getSnapshot(): Promise<SessionSnapshot | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "session.get" }, (response: RuntimeResponse) => {
      if (chrome.runtime.lastError || response?.type !== "session.snapshot") {
        resolve(null);
        return;
      }

      resolve(response.snapshot);
    });
  });
}

async function refresh(shell: HTMLElement): Promise<void> {
  state.session = await getSnapshot();
  render(shell);
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function dispatchExport(shell: HTMLElement, format: string, content: string): void {
  shell.dispatchEvent(
    new CustomEvent("ktalk:export", {
      bubbles: true,
      detail: { format, content },
    }),
  );
}

function dispatchSimple(shell: HTMLElement, action: string): void {
  shell.dispatchEvent(
    new CustomEvent("ktalk:action", {
      bubbles: true,
      detail: { action },
    }),
  );
}

function setupInteractions(shell: HTMLElement): void {
  shell.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    const actionButton = target?.closest<HTMLElement>("[data-action]");
    const historyButton = target?.closest<HTMLElement>("[data-session-id]");

    if (historyButton) {
      shell.querySelectorAll<HTMLElement>(".history-card").forEach((card) => {
        card.classList.toggle("history-card--active", card === historyButton);
      });
      return;
    }

    if (!actionButton) {
      return;
    }

    const transcript = state.session?.transcript ?? [];
    const action = actionButton.dataset.action;
    switch (action) {
      case "copy-transcript":
        await copyText(transcriptText(transcript));
        break;
      case "export-txt":
        dispatchExport(shell, "txt", transcriptText(transcript));
        break;
      case "export-markdown":
        dispatchExport(shell, "markdown", transcriptAsMarkdown(transcript));
        break;
      case "focus-latest":
        dispatchSimple(shell, "focus-latest");
        break;
      default:
        break;
    }
  });
}

function setupRuntimeRefresh(shell: HTMLElement): void {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }

    if ((message as { type?: string }).type === "ktalk.ui.refresh") {
      void refresh(shell);
    }
  });
}

function initSidebar(): void {
  const shell = document.querySelector<HTMLElement>('[data-shell="sidebar"]');
  if (!shell) {
    return;
  }

  setupInteractions(shell);
  setupRuntimeRefresh(shell);
  void refresh(shell);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSidebar, { once: true });
} else {
  initSidebar();
}
