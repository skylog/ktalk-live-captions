import type {
  RuntimeRequest,
  RuntimeResponse,
  SessionArchiveExportMetadata,
  SessionArchiveRecord,
  SessionSnapshot,
  TranscriptSegment,
} from "../shared/protocol";

type SidebarState = {
  liveSession: SessionSnapshot | null;
  historyQuery: string;
  historyResults: SessionArchiveRecord[];
  selectedSessionId: string | null;
};

type ViewSession = SessionArchiveRecord;

const state: SidebarState = {
  liveSession: null,
  historyQuery: "",
  historyResults: [],
  selectedSessionId: null,
};

let refreshGeneration = 0;
let searchTimer: number | null = null;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSessionDate(startedAt: number | null): string {
  if (startedAt === null) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat([], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(startedAt);
}

function formatDuration(startedAt: number | null, endedAt: number | null): string {
  if (startedAt === null) {
    return "Unknown";
  }

  const end = endedAt ?? Date.now();
  const durationMs = Math.max(0, end - startedAt);
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatSessionSource(source: SessionArchiveRecord["source"]): string {
  switch (source) {
    case "microphone":
      return "Microphone";
    case "tab-audio":
      return "Tab audio";
    default:
      return "Unknown";
  }
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

function transcriptText(segments: ReadonlyArray<TranscriptSegment>): string {
  return segments
    .map((segment) => {
      const speaker = segment.speakerLabel ? `${segment.speakerLabel}: ` : "";
      return `${formatTime(segment.timestamp)} ${speaker}${segment.text}`;
    })
    .join("\n");
}

function transcriptAsMarkdown(segments: ReadonlyArray<TranscriptSegment>): string {
  return segments
    .map((segment) => {
      const speaker = segment.speakerLabel ? `${segment.speakerLabel}: ` : "";
      return `- ${formatTime(segment.timestamp)} ${speaker}${segment.text}`;
    })
    .join("\n");
}

function buildExportMetadata(
  sessionId: string,
  meetingId: string,
  source: SessionArchiveRecord["source"],
  startedAt: number | null,
  endedAt: number | null,
  segmentCount: number,
  transcriptUpdatedAt: number | null,
  generatedAt: number,
): SessionArchiveExportMetadata {
  return {
    generatedAt,
    sessionId,
    meetingId,
    source,
    startedAt,
    endedAt,
    durationMs: startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : null,
    segmentCount,
    transcriptUpdatedAt,
  };
}

function makePreview(session: Pick<SessionSnapshot["session"], "currentPartialText" | "lastFinalText">, transcript: ReadonlyArray<TranscriptSegment>): string {
  if (normalizeText(session.lastFinalText).length > 0) {
    return normalizeText(session.lastFinalText);
  }

  if (normalizeText(session.currentPartialText).length > 0) {
    return normalizeText(session.currentPartialText);
  }

  if (transcript.length === 0) {
    return "";
  }

  const latestFinal = [...transcript].reverse().find((segment) => segment.status === "final");
  if (latestFinal) {
    return normalizeText(latestFinal.text);
  }

  return normalizeText(transcript[transcript.length - 1].text);
}

function sessionSnapshotToRecord(snapshot: SessionSnapshot): SessionArchiveRecord {
  const transcript = [...snapshot.transcript];
  const session = snapshot.session;
  const startedAt = session.startedAt ?? transcript[0]?.timestamp ?? null;
  const endedAt = session.endedAt ?? transcript.at(-1)?.timestamp ?? null;
  const updatedAt = session.updatedAt ?? transcript.at(-1)?.timestamp ?? startedAt;
  const source = session.source ?? transcript.find((segment) => segment.source !== null)?.source ?? null;

  return {
    sessionId: session.sessionId ?? "live-session",
    meetingId: session.meetingId ?? session.sessionId ?? "live-session",
    startedAt,
    updatedAt,
    endedAt,
    phase: session.phase,
    transport: session.transport,
    source,
    segmentCount: transcript.length,
    transcriptUpdatedAt: session.transcriptUpdatedAt ?? updatedAt,
    currentPartialText: session.currentPartialText,
    lastFinalText: session.lastFinalText,
    preview: makePreview(session, transcript),
    transcript,
    exportMetadata: buildExportMetadata(
      session.sessionId ?? "live-session",
      session.meetingId ?? session.sessionId ?? "live-session",
      source,
      startedAt,
      endedAt,
      transcript.length,
      session.transcriptUpdatedAt ?? updatedAt,
      updatedAt ?? Date.now(),
    ),
  };
}

function getExportRecord(): ViewSession | null {
  if (state.selectedSessionId) {
    const selected = state.historyResults.find((entry) => entry.sessionId === state.selectedSessionId);
    if (selected) {
      return selected;
    }
  }

  if (state.liveSession) {
    return sessionSnapshotToRecord(state.liveSession);
  }

  return state.historyResults[0] ?? null;
}

function buildTxtExport(record: ViewSession | null): string {
  const transcript = record?.transcript ?? [];
  const meta = record?.exportMetadata;

  return [
    "Kontur Talk Live Captions",
    `Session date: ${formatSessionDate(record?.startedAt ?? null)}`,
    `Duration: ${formatDuration(record?.startedAt ?? null, record?.endedAt ?? null)}`,
    `Source: ${formatSessionSource(record?.source ?? null)}`,
    `Session ID: ${record?.sessionId ?? "Unknown"}`,
    `Meeting ID: ${record?.meetingId ?? "Unknown"}`,
    `Segments: ${record?.segmentCount ?? 0}`,
    meta?.transcriptUpdatedAt ? `Updated: ${formatSessionDate(meta.transcriptUpdatedAt)}` : null,
    meta?.generatedAt ? `Exported: ${formatSessionDate(meta.generatedAt)}` : null,
    "",
    transcript.length > 0 ? transcriptText(transcript) : "No transcript captured yet.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function buildMarkdownExport(record: ViewSession | null): string {
  const transcript = record?.transcript ?? [];
  const meta = record?.exportMetadata;

  return [
    "# Kontur Talk Live Captions",
    "",
    `- Session ID: ${record?.sessionId ?? "Unknown"}`,
    `- Meeting ID: ${record?.meetingId ?? "Unknown"}`,
    `- Session date: ${formatSessionDate(record?.startedAt ?? null)}`,
    `- Duration: ${formatDuration(record?.startedAt ?? null, record?.endedAt ?? null)}`,
    `- Source: ${formatSessionSource(record?.source ?? null)}`,
    `- Segments: ${record?.segmentCount ?? 0}`,
    meta?.transcriptUpdatedAt ? `- Updated: ${formatSessionDate(meta.transcriptUpdatedAt)}` : null,
    meta?.generatedAt ? `- Exported: ${formatSessionDate(meta.generatedAt)}` : null,
    "",
    "## Transcript",
    "",
    transcript.length > 0 ? transcriptAsMarkdown(transcript) : "- No transcript captured yet.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function buildHistoryPreview(record: SessionArchiveRecord): string {
  if (normalizeText(record.preview).length > 0) {
    return normalizeText(record.preview);
  }

  const latestText = [...record.transcript].reverse().find((segment) => normalizeText(segment.text).length > 0);
  if (latestText) {
    return normalizeText(latestText.text);
  }

  return "No transcript captured yet.";
}

function formatHistoryLabel(record: SessionArchiveRecord): string {
  if (record.sessionId === state.liveSession?.session.sessionId) {
    return describePhase(state.liveSession.session.phase);
  }

  return record.endedAt !== null ? "Saved session" : "Live session";
}

function formatHistoryRange(record: SessionArchiveRecord): string {
  const start = record.startedAt ?? record.transcript[0]?.timestamp ?? null;
  if (start === null) {
    return "Waiting";
  }

  const end = record.endedAt ?? null;
  return `${formatTime(start)} - ${end !== null ? formatTime(end) : "Now"}`;
}

function resolveViewedSession(): ViewSession | null {
  if (state.selectedSessionId) {
    const selected = state.historyResults.find((entry) => entry.sessionId === state.selectedSessionId);
    if (selected) {
      return selected;
    }
  }

  if (state.liveSession) {
    return sessionSnapshotToRecord(state.liveSession);
  }

  return state.historyResults[0] ?? null;
}

function renderTranscript(stream: HTMLElement | null, emptyState: HTMLElement | null, viewedSession: ViewSession | null): void {
  if (!stream || !emptyState) {
    return;
  }

  const transcript = viewedSession?.transcript ?? [];
  if (transcript.length === 0) {
    stream.innerHTML = "";
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  stream.innerHTML = transcript
    .map((segment) => {
      const partialClass = segment.status === "partial" ? " segment-card--partial" : "";
      const speaker = segment.speakerLabel ? `<span class="segment-speaker">${segment.speakerLabel}</span>` : "";
      return `
        <article class="segment-card${partialClass}">
          <div class="segment-time">${formatTime(segment.timestamp)}</div>
          ${speaker}
          <p class="segment-text">${segment.text}</p>
        </article>
      `;
    })
    .join("");
}

function renderSessionSummary(
  statusPill: HTMLElement | null,
  sessionRange: HTMLElement | null,
  viewMode: HTMLElement | null,
  sourceChip: HTMLElement | null,
  exportChip: HTMLElement | null,
  viewedSession: ViewSession | null,
): void {
  if (statusPill) {
    if (viewedSession && state.selectedSessionId === viewedSession.sessionId && state.liveSession?.session.sessionId !== viewedSession.sessionId) {
      statusPill.textContent = "Saved session";
    } else if (state.liveSession) {
      statusPill.textContent = describePhase(state.liveSession.session.phase);
    } else {
      statusPill.textContent = "Waiting";
    }
  }

  if (sessionRange) {
    sessionRange.textContent = sessionRangeText(viewedSession);
  }

  if (viewMode) {
    viewMode.textContent =
      viewedSession && state.selectedSessionId === viewedSession.sessionId && state.liveSession?.session.sessionId !== viewedSession.sessionId
        ? "Browsing history"
        : state.liveSession
          ? "Live session"
          : "History view";
  }

  if (sourceChip) {
    sourceChip.textContent = viewedSession ? `Source: ${formatSessionSource(viewedSession.source)}` : "Source: Unknown";
  }

  if (exportChip) {
    exportChip.textContent = viewedSession?.segmentCount
      ? `${viewedSession.segmentCount} segment${viewedSession.segmentCount === 1 ? "" : "s"} ready`
      : "TXT + Markdown ready";
  }
}

function sessionRangeText(session: ViewSession | null): string {
  if (!session) {
    return "Waiting for session";
  }

  const start = session.startedAt ?? session.transcript[0]?.timestamp ?? null;
  if (start === null) {
    return "Waiting for session";
  }

  const end = session.endedAt ?? null;
  return `${formatTime(start)} - ${end !== null ? formatTime(end) : "Now"}`;
}

function renderHistory(
  historyList: HTMLElement | null,
  emptyState: HTMLElement | null,
  historyCount: HTMLElement | null,
): void {
  if (!historyList || !emptyState || !historyCount) {
    return;
  }

  const entries = state.historyResults;
  const query = normalizeText(state.historyQuery);
  historyCount.textContent =
    query.length > 0
      ? `${entries.length} result${entries.length === 1 ? "" : "s"}`
      : `${entries.length} saved`;
  emptyState.hidden = entries.length > 0;

  if (entries.length === 0) {
    const heading = emptyState.querySelector("h3");
    if (heading) {
      heading.textContent = query.length > 0 ? "No matches found" : "No history stored";
    }
    const copy = emptyState.querySelector("p");
    if (copy) {
      copy.textContent =
        query.length > 0
          ? `No saved session matched "${query}".`
          : "Start captions to save the first session.";
    }
    historyList.innerHTML = "";
    return;
  }

  historyList.innerHTML = entries
    .map((entry) => {
      const active = entry.sessionId === state.selectedSessionId ? " history-card--active" : "";
      const live = state.liveSession?.session.sessionId === entry.sessionId ? " history-card--live" : "";
      return `
        <button class="history-card${active}${live}" type="button" data-session-id="${entry.sessionId}">
          <span class="history-date">${formatHistoryLabel(entry)}</span>
          <span class="history-range">${formatHistoryRange(entry)}</span>
          <span class="history-source">${formatSessionSource(entry.source)}</span>
          <span class="history-preview">${buildHistoryPreview(entry)}</span>
        </button>
      `;
    })
    .join("");
}

function render(shell: HTMLElement): void {
  const stream = shell.querySelector<HTMLElement>("[data-transcript-stream]");
  const historyList = shell.querySelector<HTMLElement>("[data-history-list]");
  const historyEmpty = shell.querySelector<HTMLElement>("[data-history-empty]");
  const historyCount = shell.querySelector<HTMLElement>("[data-history-count]");
  const emptyState = shell.querySelector<HTMLElement>("[data-empty-state]");
  const statusPill = shell.querySelector<HTMLElement>("[data-status-pill]");
  const sessionRange = shell.querySelector<HTMLElement>("[data-view-range]");
  const viewMode = shell.querySelector<HTMLElement>("[data-view-mode]");
  const sourceChip = shell.querySelector<HTMLElement>("[data-view-source]");
  const exportChip = shell.querySelector<HTMLElement>("[data-view-export]");
  const viewedSession = resolveViewedSession();

  renderTranscript(stream, emptyState, viewedSession);
  renderHistory(historyList, historyEmpty, historyCount);
  renderSessionSummary(statusPill, sessionRange, viewMode, sourceChip, exportChip, viewedSession);

  shell.dataset.sidebarState =
    viewedSession?.phase ?? (viewedSession?.segmentCount ? "transcript-ready" : state.liveSession ? state.liveSession.session.phase : "empty");

  if (stream) {
    stream.setAttribute("aria-busy", "false");
  }
}

function sendRuntimeMessage<T>(message: RuntimeRequest): Promise<T | null> {
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

async function getLiveSession(): Promise<SessionSnapshot | null> {
  const response = await sendRuntimeMessage<{ type: "session.snapshot"; snapshot: SessionSnapshot }>(
    { type: "session.get" } satisfies RuntimeRequest,
  );

  return response?.type === "session.snapshot" ? response.snapshot : null;
}

async function searchHistory(query: string): Promise<SessionArchiveRecord[]> {
  const response = await sendRuntimeMessage<{
    type: "session.history.results";
    query: string;
    results: ReadonlyArray<SessionArchiveRecord>;
  }>({
    type: "session.history.search",
    query,
    limit: 12,
  } satisfies RuntimeRequest);

  return response?.type === "session.history.results" ? [...response.results] : [];
}

function syncSelectedSession(): void {
  const hasSelected = state.selectedSessionId
    ? state.historyResults.some((entry) => entry.sessionId === state.selectedSessionId)
    : false;

  if (hasSelected) {
    return;
  }

  if (state.liveSession?.session.sessionId) {
    state.selectedSessionId = state.liveSession.session.sessionId;
    return;
  }

  state.selectedSessionId = state.historyResults[0]?.sessionId ?? null;
}

async function refresh(shell: HTMLElement): Promise<void> {
  const generation = ++refreshGeneration;
  const [liveSession, historyResults] = await Promise.all([
    getLiveSession(),
    searchHistory(state.historyQuery),
  ]);

  if (generation !== refreshGeneration) {
    return;
  }

  state.liveSession = liveSession;
  state.historyResults = historyResults;
  syncSelectedSession();
  render(shell);
}

function scheduleRefresh(shell: HTMLElement): void {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer);
  }

  searchTimer = window.setTimeout(() => {
    searchTimer = null;
    void refresh(shell);
  }, 120);
}

function focusLatestTranscript(shell: HTMLElement): void {
  const stream = shell.querySelector<HTMLElement>("[data-transcript-stream]");
  const latestCard = stream?.querySelector<HTMLElement>(".segment-card:last-child");

  if (!latestCard) {
    return;
  }

  latestCard.scrollIntoView({ block: "nearest" });
  latestCard.classList.add("segment-card--focused");
  window.setTimeout(() => {
    latestCard.classList.remove("segment-card--focused");
  }, 1200);
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  await copyFallback(text);
}

function setupInteractions(shell: HTMLElement): void {
  shell.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    const actionButton = target?.closest<HTMLElement>("[data-action]");
    const historyButton = target?.closest<HTMLElement>("[data-session-id]");

    if (historyButton) {
      const sessionId = historyButton.dataset.sessionId ?? null;
      if (sessionId) {
        state.selectedSessionId = sessionId;
        render(shell);
      }
      return;
    }

    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    const record = getExportRecord();

    switch (action) {
      case "copy-transcript":
        await copyText(transcriptText(record?.transcript ?? []));
        break;
      case "export-txt":
        dispatchExport(shell, "txt", buildTxtExport(record));
        break;
      case "export-markdown":
        dispatchExport(shell, "markdown", buildMarkdownExport(record));
        break;
      case "focus-latest":
        focusLatestTranscript(shell);
        dispatchSimple(shell, "focus-latest");
        break;
      case "show-live-session":
        state.selectedSessionId = state.liveSession?.session.sessionId ?? null;
        render(shell);
        break;
      default:
        break;
    }
  });

  shell.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target || target.dataset.historyQuery === undefined) {
      return;
    }

    state.historyQuery = target.value;
    scheduleRefresh(shell);
  });
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

async function copyFallback(text: string): Promise<void> {
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
