import type { RuntimeResponse, SessionSnapshot, TranscriptSegment } from "../shared/protocol";
import {
  TRANSCRIPT_STORE_KEY,
  type TranscriptSessionRecord,
  type TranscriptStoreSnapshot,
} from "../storage/transcript-store";

type TranscriptView = {
  kind: "live" | "history";
  sessionId: string;
  meetingId: string;
  startedAt: number | null;
  endedAt: number | null;
  updatedAt: number | null;
  transcript: TranscriptSegment[];
  heading: string;
  summary: string;
  range: string;
  preview: string;
};

type SidebarState = {
  liveSession: SessionSnapshot | null;
  history: TranscriptSessionRecord[];
  selectedSessionId: string | null;
  followLatest: boolean;
};

const state: SidebarState = {
  liveSession: null,
  history: [],
  selectedSessionId: null,
  followLatest: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat([], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatDuration(startedAt: number | null, endedAt: number | null): string {
  if (startedAt === null) {
    return "Waiting";
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

function formatRange(startedAt: number | null, endedAt: number | null): string {
  if (startedAt === null) {
    return "Waiting for session";
  }

  return `${formatTime(startedAt)} - ${endedAt !== null ? formatTime(endedAt) : "Now"}`;
}

function formatPreview(text: string): string {
  const compact = normalizeText(text);
  if (compact.length <= 96) {
    return compact;
  }

  return `${compact.slice(0, 93)}...`;
}

function transcriptText(segments: ReadonlyArray<TranscriptSegment>): string {
  if (segments.length === 0) {
    return "No transcript captured yet.";
  }

  return segments.map((segment) => `${formatTime(segment.timestamp)} ${segment.text}`).join("\n\n");
}

function transcriptAsMarkdown(segments: ReadonlyArray<TranscriptSegment>): string {
  if (segments.length === 0) {
    return "- No transcript captured yet.";
  }

  return segments.map((segment) => `- ${formatTime(segment.timestamp)} ${segment.text}`).join("\n");
}

function formatSessionSource(session: SessionSnapshot | null): string {
  switch (session?.session.source) {
    case "microphone":
      return "Mic";
    case "tab-audio":
      return "Tab audio";
    default:
      return "Live";
  }
}

function hasLiveContent(session: SessionSnapshot | null): boolean {
  return session !== null && (session.session.phase !== "idle" || session.transcript.length > 0);
}

function describeLivePhase(session: SessionSnapshot | null): string {
  const phase = session?.session.phase ?? "idle";
  const transcript = session?.transcript ?? [];

  if (phase === "idle" && transcript.length > 0) {
    return "Transcript ready";
  }

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

function buildLiveView(session: SessionSnapshot | null): TranscriptView | null {
  if (!session) {
    return null;
  }

  const transcript = [...session.transcript];
  const startedAt = session.session.startedAt ?? transcript[0]?.timestamp ?? null;
  const endedAt = session.session.endedAt ?? null;
  const latestSegment = transcript[transcript.length - 1];

  return {
    kind: "live",
    sessionId: session.session.sessionId ?? "live-session",
    meetingId: session.session.meetingId ?? session.session.sessionId ?? "live-session",
    startedAt,
    endedAt,
    updatedAt: session.session.updatedAt ?? session.session.transcriptUpdatedAt ?? startedAt,
    transcript,
    heading: "Current session",
    summary:
      transcript.length > 0
        ? `${transcript.length} segment${transcript.length === 1 ? "" : "s"} captured`
        : "Start captions to capture the first live segment.",
    range: formatRange(startedAt, endedAt),
    preview: latestSegment ? formatPreview(latestSegment.text) : "",
  };
}

function buildHistoryView(record: TranscriptSessionRecord): TranscriptView {
  const transcript = [...record.transcript];
  const startedAt = record.startedAt ?? transcript[0]?.timestamp ?? null;
  const latestSegment = transcript[transcript.length - 1];

  return {
    kind: "history",
    sessionId: record.sessionId,
    meetingId: record.meetingId,
    startedAt,
    endedAt: record.endedAt,
    updatedAt: record.updatedAt,
    transcript,
    heading: formatDateTime(record.updatedAt ?? record.endedAt ?? startedAt ?? Date.now()),
    summary:
      transcript.length > 0
        ? `${transcript.length} saved segment${transcript.length === 1 ? "" : "s"}`
        : "Saved session with no transcript",
    range: formatRange(startedAt, record.endedAt),
    preview: latestSegment ? formatPreview(latestSegment.text) : "No transcript stored.",
  };
}

function sortByRecency(records: TranscriptSessionRecord[]): TranscriptSessionRecord[] {
  return [...records].sort((left, right) => {
    const leftStamp = left.updatedAt ?? left.endedAt ?? left.startedAt ?? 0;
    const rightStamp = right.updatedAt ?? right.endedAt ?? right.startedAt ?? 0;
    return rightStamp - leftStamp;
  });
}

function normalizeTranscriptSegment(value: unknown): TranscriptSegment | null {
  if (!isRecord(value)) {
    return null;
  }

  const status = value.status === "final" ? "final" : value.status === "partial" ? "partial" : null;
  const sessionId = typeof value.sessionId === "string" && value.sessionId.length > 0 ? value.sessionId : null;
  const meetingId = typeof value.meetingId === "string" && value.meetingId.length > 0 ? value.meetingId : null;
  const text = typeof value.text === "string" ? value.text : "";

  if (!status || !sessionId || !meetingId) {
    return null;
  }

  return {
    segmentId: typeof value.segmentId === "string" && value.segmentId.length > 0 ? value.segmentId : `${sessionId}:${meetingId}:${status}:${text}`,
    sessionId,
    meetingId,
    status,
    text,
    timestamp: typeof value.timestamp === "number" ? value.timestamp : Date.now(),
    chunkIndex: typeof value.chunkIndex === "number" ? value.chunkIndex : null,
    sampleRate: typeof value.sampleRate === "number" ? value.sampleRate : null,
    channels: typeof value.channels === "number" ? value.channels : null,
    confidence: typeof value.confidence === "number" ? value.confidence : null,
    source: value.source === "microphone" ? "microphone" : "tab-audio",
    speakerLabel: typeof value.speakerLabel === "string" ? value.speakerLabel : null,
  };
}

function normalizeTranscriptRecord(value: unknown): TranscriptSessionRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const sessionId = typeof value.sessionId === "string" && value.sessionId.length > 0 ? value.sessionId : "";
  const meetingId = typeof value.meetingId === "string" && value.meetingId.length > 0 ? value.meetingId : sessionId;

  if (!sessionId || !meetingId) {
    return null;
  }

  return {
    sessionId,
    meetingId,
    startedAt: typeof value.startedAt === "number" ? value.startedAt : null,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : null,
    endedAt: typeof value.endedAt === "number" ? value.endedAt : null,
    segmentCount:
      typeof value.segmentCount === "number" && Number.isFinite(value.segmentCount)
        ? value.segmentCount
        : Array.isArray(value.transcript)
          ? value.transcript.length
          : 0,
    transcript: Array.isArray(value.transcript)
      ? value.transcript.map(normalizeTranscriptSegment).filter((segment): segment is TranscriptSegment => segment !== null)
      : [],
  };
}

function normalizeTranscriptStoreSnapshot(value: unknown): TranscriptStoreSnapshot | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.sessions)) {
    return null;
  }

  const sessions = value.sessions.map(normalizeTranscriptRecord).filter(
    (record): record is TranscriptSessionRecord => record !== null,
  );

  return {
    version: 1,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
    sessions,
  };
}

function getTranscriptStoreSnapshot(): Promise<TranscriptStoreSnapshot | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(TRANSCRIPT_STORE_KEY, (items) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

      resolve(normalizeTranscriptStoreSnapshot(items[TRANSCRIPT_STORE_KEY]));
    });
  });
}

function getSessionSnapshot(): Promise<SessionSnapshot | null> {
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

function resolveVisibleView(): TranscriptView | null {
  const liveView = buildLiveView(state.liveSession);
  const historyViews = sortByRecency(state.history).map(buildHistoryView);

  if (state.followLatest && liveView && hasLiveContent(state.liveSession)) {
    return liveView;
  }

  if (state.selectedSessionId !== null) {
    if (liveView?.sessionId === state.selectedSessionId) {
      return liveView;
    }

    const selectedHistory = historyViews.find((view) => view.sessionId === state.selectedSessionId);
    if (selectedHistory) {
      return selectedHistory;
    }
  }

  return liveView ?? historyViews[0] ?? null;
}

function renderHistory(
  historyList: HTMLElement | null,
  historyEmpty: HTMLElement | null,
  historyCount: HTMLElement | null,
  selectedSessionId: string | null,
): void {
  if (!historyList || !historyEmpty) {
    return;
  }

  const historyViews = sortByRecency(state.history).map(buildHistoryView);

  if (historyCount) {
    historyCount.textContent = `${historyViews.length} saved`;
  }

  if (historyViews.length === 0) {
    historyList.innerHTML = "";
    historyEmpty.hidden = false;
    return;
  }

  historyEmpty.hidden = true;
  historyList.innerHTML = historyViews
    .map((view) => {
      const isActive = view.sessionId === selectedSessionId;
      return `
        <button class="history-card${isActive ? " history-card--active" : ""}" type="button" data-session-id="${escapeHtml(view.sessionId)}" aria-current="${isActive ? "true" : "false"}">
          <span class="history-date">${escapeHtml(view.heading)}</span>
          <span class="history-range">${escapeHtml(view.range)}</span>
          <span class="history-summary">${escapeHtml(view.summary)}</span>
          <span class="history-preview">${escapeHtml(view.preview)}</span>
        </button>
      `;
    })
    .join("");
}

function renderTranscript(
  stream: HTMLElement | null,
  emptyState: HTMLElement | null,
  emptyTitle: HTMLElement | null,
  emptyCopy: HTMLElement | null,
  view: TranscriptView | null,
): void {
  if (!stream || !emptyState || !emptyTitle || !emptyCopy) {
    return;
  }

  const transcript = view?.transcript ?? [];

  if (transcript.length === 0) {
    stream.innerHTML = "";
    emptyState.hidden = false;
    emptyTitle.textContent = view?.kind === "history" ? "No transcript stored" : "No transcript yet";
    emptyCopy.textContent =
      view?.kind === "history"
        ? "Choose another session or start captions to capture a new one."
        : "Start captions to capture the first live segment.";
    return;
  }

  emptyState.hidden = true;
  stream.innerHTML = transcript
    .map((segment) => {
      const partialClass = segment.status === "partial" ? " segment-card--partial" : "";
      return `
        <article class="segment-card${partialClass}">
          <div class="segment-time">${escapeHtml(formatTime(segment.timestamp))}</div>
          <p class="segment-text">${escapeHtml(segment.text)}</p>
        </article>
      `;
    })
    .join("");
}

function renderSummary(
  statusPill: HTMLElement | null,
  viewBadge: HTMLElement | null,
  viewTitle: HTMLElement | null,
  viewCopy: HTMLElement | null,
  viewRange: HTMLElement | null,
  view: TranscriptView | null,
): void {
  const liveSession = state.liveSession;

  if (statusPill) {
    statusPill.textContent = describeLivePhase(liveSession);
    statusPill.classList.toggle("status-pill--live", hasLiveContent(liveSession));
  }

  if (viewBadge) {
    viewBadge.textContent = view?.kind === "live" ? formatSessionSource(liveSession) : view ? "Saved" : "Waiting";
  }

  if (viewTitle) {
    viewTitle.textContent = view?.kind === "history" ? "Transcript history" : "Current session";
  }

  if (viewCopy) {
    viewCopy.textContent = view
      ? view.transcript.length > 0
        ? `${view.transcript.length} segment${view.transcript.length === 1 ? "" : "s"} captured`
        : view.kind === "history"
          ? "Saved session with no transcript"
          : "Start captions to capture the first live segment."
      : "Waiting for transcript data.";
  }

  if (viewRange) {
    viewRange.textContent = view ? `${view.range} | ${view.kind === "live" ? formatSessionSource(liveSession) : "Saved"}` : "Waiting for session";
  }
}

function scrollLatestTranscript(shell: HTMLElement): void {
  const stream = shell.querySelector<HTMLElement>("[data-transcript-stream]");
  const latestCard = stream?.querySelector<HTMLElement>(".segment-card:last-child");

  if (!stream || !latestCard) {
    return;
  }

  stream.scrollTop = stream.scrollHeight;
  latestCard.classList.add("segment-card--focused");
  window.setTimeout(() => {
    latestCard.classList.remove("segment-card--focused");
  }, 1200);
}

function render(shell: HTMLElement): void {
  const stream = shell.querySelector<HTMLElement>("[data-transcript-stream]");
  const emptyState = shell.querySelector<HTMLElement>("[data-empty-state]");
  const emptyTitle = shell.querySelector<HTMLElement>("[data-empty-title]");
  const emptyCopy = shell.querySelector<HTMLElement>("[data-empty-copy]");
  const historyList = shell.querySelector<HTMLElement>("[data-history-list]");
  const historyEmpty = shell.querySelector<HTMLElement>("[data-history-empty]");
  const historyCount = shell.querySelector<HTMLElement>("[data-history-count]");
  const statusPill = shell.querySelector<HTMLElement>("[data-status-pill]");
  const viewBadge = shell.querySelector<HTMLElement>("[data-view-badge]");
  const viewTitle = shell.querySelector<HTMLElement>("[data-view-title]");
  const viewCopy = shell.querySelector<HTMLElement>("[data-view-copy]");
  const viewRange = shell.querySelector<HTMLElement>("[data-view-range]");
  const view = resolveVisibleView();
  const selectedSessionId = view?.sessionId ?? null;

  if (view) {
    state.selectedSessionId = selectedSessionId;
  }

  renderTranscript(stream, emptyState, emptyTitle, emptyCopy, view);
  renderHistory(historyList, historyEmpty, historyCount, selectedSessionId);
  renderSummary(statusPill, viewBadge, viewTitle, viewCopy, viewRange, view);

  shell.dataset.sidebarState =
    view === null
      ? "empty"
      : view.kind === "live"
        ? "live"
        : view.transcript.length > 0
          ? "history"
          : "empty";
  shell.dataset.viewKind = view?.kind ?? "none";
  shell.dataset.viewSessionId = view?.sessionId ?? "";

  if (state.followLatest && view?.kind === "live" && view.transcript.length > 0) {
    window.requestAnimationFrame(() => scrollLatestTranscript(shell));
  }
}

async function refresh(shell: HTMLElement): Promise<void> {
  const [liveSession, storeSnapshot] = await Promise.all([getSessionSnapshot(), getTranscriptStoreSnapshot()]);
  state.liveSession = liveSession;
  state.history = storeSnapshot?.sessions ?? [];

  if (state.followLatest) {
    state.selectedSessionId = hasLiveContent(liveSession) ? liveSession?.session.sessionId ?? null : state.history[0]?.sessionId ?? null;
  } else {
    const historyIds = new Set(state.history.map((record) => record.sessionId));
    if (state.selectedSessionId !== null && !historyIds.has(state.selectedSessionId) && state.selectedSessionId !== liveSession?.session.sessionId) {
      state.selectedSessionId = null;
    }
  }

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

function buildTxtExport(view: TranscriptView | null): string {
  const transcript = view?.transcript ?? [];
  const startedAt = view?.startedAt ?? transcript[0]?.timestamp ?? null;
  const endedAt = view?.endedAt ?? null;
  const title = view?.kind === "history" ? "Saved session" : "Current session";

  return [
    "Kontur Talk Live Captions",
    `Session: ${title}`,
    `Session date: ${startedAt !== null ? formatDateTime(startedAt) : "Waiting"}`,
    `Duration: ${formatDuration(startedAt, endedAt)}`,
    `Source: ${view?.kind === "live" ? formatSessionSource(state.liveSession) : "Saved"}`,
    "",
    transcriptText(transcript),
  ].join("\n");
}

function buildMarkdownExport(view: TranscriptView | null): string {
  const transcript = view?.transcript ?? [];
  const startedAt = view?.startedAt ?? transcript[0]?.timestamp ?? null;
  const endedAt = view?.endedAt ?? null;
  const title = view?.kind === "history" ? "Saved session" : "Current session";

  return [
    "# Kontur Talk Live Captions",
    "",
    `- Session: ${title}`,
    `- Session date: ${startedAt !== null ? formatDateTime(startedAt) : "Waiting"}`,
    `- Duration: ${formatDuration(startedAt, endedAt)}`,
    `- Source: ${view?.kind === "live" ? formatSessionSource(state.liveSession) : "Saved"}`,
    "",
    "## Transcript",
    "",
    transcriptAsMarkdown(transcript),
  ].join("\n");
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
      const sessionId = historyButton.dataset.sessionId ?? null;
      if (sessionId !== null) {
        state.selectedSessionId = sessionId;
        state.followLatest = false;
        render(shell);
      }
      return;
    }

    if (!actionButton) {
      return;
    }

    const view = resolveVisibleView();
    const action = actionButton.dataset.action;

    switch (action) {
      case "copy-transcript":
        await copyText(transcriptText(view?.transcript ?? []));
        break;
      case "export-txt":
        dispatchExport(shell, "txt", buildTxtExport(view));
        break;
      case "export-markdown":
        dispatchExport(shell, "markdown", buildMarkdownExport(view));
        break;
      case "focus-latest": {
        const liveView = buildLiveView(state.liveSession);
        const recentHistory = sortByRecency(state.history)[0];
        const fallbackView = liveView ?? (recentHistory ? buildHistoryView(recentHistory) : null);

        state.followLatest = hasLiveContent(state.liveSession);
        state.selectedSessionId = fallbackView?.sessionId ?? null;
        render(shell);
        dispatchSimple(shell, "focus-latest");
        break;
      }
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
