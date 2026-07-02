import {
  CAPTURE_SOURCES,
  PROTOCOL_VERSION,
  SESSION_ERROR_CODES,
  SESSION_PHASES,
  SESSION_TRANSPORT_STATES,
  SERVICE_HEALTH_STATUSES,
  type CaptureSource,
  type ProtocolError,
  type RuntimeRequest,
  type RuntimeResponse,
  type SessionEndRequest,
  type SessionPatch,
  type SessionSeed,
  type SessionSnapshot,
  type SessionState,
  type ServiceHealth,
  type TranscriptSegment,
  type TranscriptSegmentInput,
  createIdleSessionState,
  createIdleServiceHealth,
  createProtocolError,
  LOCAL_ASR_HTTP_URL,
} from "../shared/protocol";

interface ChromeRuntimeAPI {
  lastError?: { message?: string };
  getManifest(): {
    options_ui?: {
      page?: string;
    };
  };
  getURL(path: string): string;
  sendMessage(message: unknown, callback?: (response: unknown) => void): void;
  onInstalled: {
    addListener(callback: (details: { reason: string }) => void): void;
  };
  onStartup: {
    addListener(callback: () => void): void;
  };
  onMessage: {
    addListener(
      callback: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void,
      ) => boolean | void,
    ): void;
  };
}

interface ChromeActionAPI {
  onClicked: {
    addListener(callback: () => void): void;
  };
}

interface ChromeCommandsAPI {
  onCommand: {
    addListener(callback: (command: string) => void): void;
  };
}

type ContentBridgeRequest =
  | { type: "ktalk.content.getSnapshot"; reason?: string }
  | { type: "ktalk.content.refreshDetection"; reason?: string }
  | { type: "ktalk.content.beginSession"; reason?: string }
  | { type: "ktalk.content.stop"; reason?: string }
  | { type: "ktalk.content.markAgentReady"; reason?: string }
  | { type: "ktalk.content.beginConnecting"; reason?: string }
  | { type: "ktalk.content.markListening"; reason?: string }
  | { type: "ktalk.content.markReconnecting"; reason?: string }
  | { type: "ktalk.content.markUnavailable"; reason?: string }
  | { type: "ktalk.content.reset"; reason?: string };

type ContentSnapshotMessage = {
  type: "ktalk.content.snapshot";
  snapshot: ContentScriptSnapshot;
};

type UiBridgeRequest = {
  type: "ktalk.ui.openSidebar";
};

interface ContentSessionSnapshot {
  sessionId: string | null;
  meetingId: string | null;
  phase: SessionState["phase"];
  agentReady: boolean;
  transportReady: boolean;
  reconnectAttempts: number;
  reconnectDelayMs: number | null;
  reconnectBudgetExceeded: boolean;
  startedAt: number | null;
  connectedAt: number | null;
  lastEventAt: number;
  lastReason: string | null;
}

interface ContentScriptSnapshot {
  session: ContentSessionSnapshot;
  detection: {
    detected: boolean;
    meetingId: string | null;
    surfaceId: string | null;
  };
}

type UiBroadcastMessage = {
  type: "ktalk.ui.refresh";
};

interface ChromeStorageArea {
  get(
    keys: string | string[] | Record<string, unknown> | null,
    callback: (items: Record<string, unknown>) => void,
  ): void;
  set(items: Record<string, unknown>, callback?: () => void): void;
  clear(callback?: () => void): void;
}

interface ChromeTabsAPI {
  query(
    queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
      url?: string;
    },
    callback: (tabs: Array<{ id?: number; windowId?: number; url?: string }>) => void,
  ): void;
  onRemoved: {
    addListener(callback: (tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void): void;
  };
  create(
    createProperties: {
      active?: boolean;
      url: string;
    },
    callback?: (tab: { id?: number; windowId?: number } | undefined) => void,
  ): void;
  update(
    tabId: number,
    updateProperties: {
      active?: boolean;
    },
    callback?: (tab: { id?: number; windowId?: number } | undefined) => void,
  ): void;
  sendMessage<TResponse>(
    tabId: number,
    message: ContentBridgeRequest,
    callback: (response: TResponse) => void,
  ): void;
}

interface ChromeExtensionAPI {
  action: ChromeActionAPI;
  commands: ChromeCommandsAPI;
  runtime: ChromeRuntimeAPI;
  tabs: ChromeTabsAPI;
  storage: {
    local: ChromeStorageArea;
  };
}

declare const chrome: ChromeExtensionAPI;

export const SESSION_STORAGE_KEY = "ktalk-live-captions.session.v1";
const UI_ROUTING_STORAGE_KEY = "ktalk-live-captions.ui-routing.v1";

interface UiRoutingState {
  onboardingSeen: boolean;
}

let sessionState: SessionState = createIdleSessionState();
let transcriptSegments: TranscriptSegment[] = [];
let bootstrapPromise: Promise<void> | null = null;

function now(): number {
  return Date.now();
}

function createId(): string {
  return crypto.randomUUID();
}

function cloneHealth(health: ServiceHealth): ServiceHealth {
  return {
    status: health.status,
    endpoint: health.endpoint,
    checkedAt: health.checkedAt,
    latencyMs: health.latencyMs,
    reason: health.reason,
  };
}

function cloneSession(state: SessionState): SessionState {
  return {
    sessionId: state.sessionId,
    meetingId: state.meetingId,
    tabId: state.tabId,
    source: state.source,
    phase: state.phase,
    transport: state.transport,
    reconnectAttempts: state.reconnectAttempts,
    reconnectDelayMs: state.reconnectDelayMs,
    reconnectBudgetExceeded: state.reconnectBudgetExceeded,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    endedAt: state.endedAt,
    currentPartialText: state.currentPartialText,
    lastFinalText: state.lastFinalText,
    segmentCount: state.segmentCount,
    transcriptUpdatedAt: state.transcriptUpdatedAt,
    lastError: state.lastError
      ? {
          code: state.lastError.code,
          message: state.lastError.message,
          recoverable: state.lastError.recoverable,
          timestamp: state.lastError.timestamp,
          details: state.lastError.details,
        }
      : null,
    health: cloneHealth(state.health),
  };
}

function cloneTranscriptSegment(segment: TranscriptSegment): TranscriptSegment {
  return {
    segmentId: segment.segmentId,
    sessionId: segment.sessionId,
    meetingId: segment.meetingId,
    status: segment.status,
    text: segment.text,
    timestamp: segment.timestamp,
    chunkIndex: segment.chunkIndex,
    sampleRate: segment.sampleRate,
    channels: segment.channels,
    confidence: segment.confidence,
    source: segment.source,
    speakerLabel: segment.speakerLabel,
  };
}

function isContentSessionPhase(value: unknown): value is SessionState["phase"] {
  return typeof value === "string" && (SESSION_PHASES as readonly string[]).includes(value);
}

function isContentScriptSnapshot(value: unknown): value is ContentScriptSnapshot {
  if (!isRecord(value) || !isRecord(value.session)) {
    return false;
  }

  return (
    (typeof value.session.sessionId === "string" || value.session.sessionId === null) &&
    (typeof value.session.meetingId === "string" || value.session.meetingId === null) &&
    isContentSessionPhase(value.session.phase)
  );
}

function isContentSessionSnapshot(value: unknown): value is ContentSessionSnapshot {
  return (
    isRecord(value) &&
    (typeof value.sessionId === "string" || value.sessionId === null) &&
    (typeof value.meetingId === "string" || value.meetingId === null) &&
    isContentSessionPhase(value.phase)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getSenderTabId(sender: unknown): number | null {
  if (!isRecord(sender) || !isRecord(sender.tab)) {
    return null;
  }

  return typeof sender.tab.id === "number" ? sender.tab.id : null;
}

function normalizeUiRoutingState(value: unknown): UiRoutingState {
  if (!isRecord(value)) {
    return {
      onboardingSeen: false,
    };
  }

  return {
    onboardingSeen: typeof value.onboardingSeen === "boolean" ? value.onboardingSeen : false,
  };
}

function isContentBridgeMessage(message: unknown): message is ContentBridgeRequest {
  return isRecord(message) && typeof message.type === "string" && message.type.startsWith("ktalk.content.");
}

function isContentSnapshotMessage(message: unknown): message is ContentSnapshotMessage {
  return (
    isRecord(message) &&
    message.type === "ktalk.content.snapshot" &&
    isContentScriptSnapshot(message.snapshot)
  );
}

function isUiBroadcastMessage(message: unknown): message is UiBroadcastMessage {
  return isRecord(message) && message.type === "ktalk.ui.refresh";
}

function getActiveTabId(): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(typeof tabs[0]?.id === "number" ? tabs[0].id : null);
    });
  });
}

async function sendContentBridgeMessage<T>(message: ContentBridgeRequest): Promise<T | null> {
  const tabId = sessionState.tabId ?? (await getActiveTabId());
  if (tabId === null) {
    return null;
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage<T>(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

      resolve(response ?? null);
    });
  });
}

function notifyUiRefresh(): void {
  void chrome.runtime.sendMessage({ type: "ktalk.ui.refresh" } satisfies UiBroadcastMessage);
}

function isSessionEndRequest(message: unknown): message is SessionEndRequest {
  return isRecord(message) && message.type === "session.end";
}

function isCaptureSource(value: unknown): value is CaptureSource {
  return typeof value === "string" && (CAPTURE_SOURCES as readonly string[]).includes(value);
}

function isSessionPhase(value: unknown): value is SessionState["phase"] {
  return typeof value === "string" && (SESSION_PHASES as readonly string[]).includes(value);
}

function isSessionTransportState(value: unknown): value is SessionState["transport"] {
  return typeof value === "string" && (SESSION_TRANSPORT_STATES as readonly string[]).includes(value);
}

function isServiceHealthStatus(value: unknown): value is ServiceHealth["status"] {
  return typeof value === "string" && (SERVICE_HEALTH_STATUSES as readonly string[]).includes(value);
}

function isSessionErrorCode(value: unknown): value is (typeof SESSION_ERROR_CODES)[number] {
  return typeof value === "string" && (SESSION_ERROR_CODES as readonly string[]).includes(value);
}

function mapPhaseToTransport(phase: SessionState["phase"]): SessionState["transport"] {
  switch (phase) {
    case "checking-agent":
    case "connecting":
      return "connecting";
    case "listening":
      return "connected";
    case "reconnecting":
      return "reconnecting";
    case "finished":
    case "idle":
    default:
      return "idle";
  }
}

function mapContentScriptSnapshotToSessionState(snapshot: ContentScriptSnapshot): SessionState {
  const session = snapshot.session;
  const nowTs = now();

  return normalizeSessionState({
    ...sessionState,
    sessionId: session.sessionId ?? sessionState.sessionId,
    meetingId: session.meetingId ?? snapshot.detection.meetingId ?? sessionState.meetingId,
    phase: isSessionPhase(session.phase) ? session.phase : sessionState.phase,
    transport: mapPhaseToTransport(isSessionPhase(session.phase) ? session.phase : sessionState.phase),
    reconnectAttempts:
      typeof session.reconnectAttempts === "number" ? session.reconnectAttempts : sessionState.reconnectAttempts,
    reconnectDelayMs:
      typeof session.reconnectDelayMs === "number" ? session.reconnectDelayMs : sessionState.reconnectDelayMs,
    reconnectBudgetExceeded:
      typeof session.reconnectBudgetExceeded === "boolean"
        ? session.reconnectBudgetExceeded
        : sessionState.reconnectBudgetExceeded,
    startedAt: session.startedAt ?? sessionState.startedAt,
    updatedAt: session.lastEventAt ?? nowTs,
    endedAt: session.phase === "finished" ? session.lastEventAt ?? nowTs : sessionState.endedAt,
  });
}

function mapContentSessionSnapshotToSessionState(snapshot: ContentSessionSnapshot): SessionState {
  const nowTs = now();

  return normalizeSessionState({
    ...sessionState,
    sessionId: snapshot.sessionId ?? sessionState.sessionId,
    meetingId: snapshot.meetingId ?? sessionState.meetingId,
    phase: isSessionPhase(snapshot.phase) ? snapshot.phase : sessionState.phase,
    transport: mapPhaseToTransport(isSessionPhase(snapshot.phase) ? snapshot.phase : sessionState.phase),
    reconnectAttempts:
      typeof snapshot.reconnectAttempts === "number" ? snapshot.reconnectAttempts : sessionState.reconnectAttempts,
    reconnectDelayMs:
      typeof snapshot.reconnectDelayMs === "number" ? snapshot.reconnectDelayMs : sessionState.reconnectDelayMs,
    reconnectBudgetExceeded:
      typeof snapshot.reconnectBudgetExceeded === "boolean"
        ? snapshot.reconnectBudgetExceeded
        : sessionState.reconnectBudgetExceeded,
    startedAt: snapshot.startedAt ?? sessionState.startedAt,
    updatedAt: snapshot.lastEventAt ?? nowTs,
    endedAt: snapshot.phase === "finished" ? snapshot.lastEventAt ?? nowTs : sessionState.endedAt,
  });
}

function buildHealth(status: ServiceHealth["status"], checkedAt: number, latencyMs: number | null, reason: string | null): ServiceHealth {
  return {
    status,
    endpoint: LOCAL_ASR_HTTP_URL,
    checkedAt,
    latencyMs,
    reason,
  };
}

function describeHealthFailure(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "Health probe timed out.";
    }

    return error.message || "Local ASR health probe failed.";
  }

  return "Local ASR health probe failed.";
}

async function probeLocalAsrHealth(reason = "health-probe"): Promise<ServiceHealth> {
  const checkedAt = now();
  const controller = new AbortController();
  const timeoutMs = 2500;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(LOCAL_ASR_HTTP_URL, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    const latencyMs = now() - checkedAt;

    if (response.ok) {
      return buildHealth("ready", checkedAt, latencyMs, null);
    }

    return buildHealth(
      response.status >= 500 ? "unreachable" : "degraded",
      checkedAt,
      latencyMs,
      `${reason}: HTTP ${response.status}`,
    );
  } catch (error) {
    const latencyMs = now() - checkedAt;
    return buildHealth("unreachable", checkedAt, latencyMs, `${reason}: ${describeHealthFailure(error)}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

function transitionSessionState(nextState: SessionState, nextSegments = transcriptSegments): SessionSnapshot {
  sessionState = normalizeSessionState(nextState);
  transcriptSegments = nextSegments.map(cloneTranscriptSegment);
  return makeSnapshot();
}

function applyTranscriptTransportResult(
  segment: TranscriptSegment,
  nextSegments: TranscriptSegment[],
): SessionSnapshot {
  const nextState = {
    ...sessionState,
    sessionId: sessionState.sessionId ?? segment.sessionId,
    meetingId: sessionState.meetingId ?? segment.meetingId,
    source: sessionState.source ?? segment.source,
    phase: sessionState.phase === "idle" || sessionState.phase === "checking-agent"
      ? "listening"
      : sessionState.phase === "connecting" || sessionState.phase === "reconnecting"
        ? "listening"
        : sessionState.phase,
    transport: sessionState.transport === "idle" || sessionState.transport === "connecting" || sessionState.transport === "reconnecting"
      ? "connected"
      : sessionState.transport,
    updatedAt: segment.timestamp,
    transcriptUpdatedAt: segment.timestamp,
    currentPartialText: segment.status === "partial" ? segment.text : sessionState.currentPartialText,
    lastFinalText: segment.status === "final" ? segment.text : sessionState.lastFinalText,
    segmentCount: nextSegments.length,
    endedAt: null,
    lastError: null,
    health: sessionState.health.status === "unknown" || sessionState.health.status === "checking"
      ? {
          ...sessionState.health,
          status: "ready",
          checkedAt: sessionState.health.checkedAt ?? segment.timestamp,
          latencyMs: sessionState.health.latencyMs,
          reason: null,
        }
      : sessionState.health,
  } satisfies SessionState;

  return transitionSessionState(nextState, nextSegments);
}

async function syncSessionStateFromContent(message: ContentBridgeRequest): Promise<SessionSnapshot | null> {
  const response = await sendContentBridgeMessage<unknown>(message);

  if (!isContentSessionSnapshot(response)) {
    return null;
  }

  const nextState = mapContentSessionSnapshotToSessionState(response);
  return transitionSessionState({
    ...nextState,
    updatedAt: now(),
  });
}

function applyHealthToSession(health: ServiceHealth): SessionSnapshot {
  const timestamp = health.checkedAt ?? now();
  const activePhase =
    sessionState.phase === "checking-agent" ||
    sessionState.phase === "connecting" ||
    sessionState.phase === "listening" ||
    sessionState.phase === "reconnecting";

  const nextState: SessionState = normalizeSessionState({
    ...sessionState,
    health,
    updatedAt: timestamp,
    lastError:
      health.status === "ready"
        ? null
        : activePhase
          ? createProtocolError(
              "service-unreachable",
              health.reason ?? "Local ASR service is unavailable.",
              true,
              health.endpoint,
              timestamp,
            )
          : sessionState.lastError,
    phase:
      health.status === "ready"
        ? sessionState.phase === "checking-agent" || sessionState.phase === "reconnecting"
          ? "connecting"
          : sessionState.phase
        : activePhase
          ? "reconnecting"
          : sessionState.phase,
    transport:
      health.status === "ready"
        ? sessionState.transport === "idle" || sessionState.transport === "reconnecting"
          ? "connecting"
          : sessionState.transport
        : activePhase
          ? "reconnecting"
          : sessionState.transport,
    endedAt:
      health.status === "ready"
        ? sessionState.endedAt
        : activePhase
          ? sessionState.endedAt
          : sessionState.endedAt,
  });

  return transitionSessionState(nextState);
}

async function refreshSessionHealth(reason = "health-probe"): Promise<ServiceHealth> {
  const health = await probeLocalAsrHealth(reason);
  applyHealthToSession(health);
  return health;
}

function normalizeProtocolError(
  error: ProtocolError | null | undefined,
): ProtocolError | null {
  if (!error) {
    return null;
  }

  return {
    code: isSessionErrorCode(error.code) ? error.code : "unknown",
    message: typeof error.message === "string" ? error.message : "Unknown error",
    recoverable: Boolean(error.recoverable),
    timestamp: typeof error.timestamp === "number" ? error.timestamp : now(),
    details: typeof error.details === "string" ? error.details : null,
  };
}

function normalizeServiceHealth(health: ServiceHealth | null | undefined): ServiceHealth {
  if (!health || !isRecord(health)) {
    return createIdleServiceHealth();
  }

  return {
    status: isServiceHealthStatus(health.status) ? health.status : "unknown",
    endpoint:
      typeof health.endpoint === "string" && health.endpoint.length > 0
        ? health.endpoint
        : LOCAL_ASR_HTTP_URL,
    checkedAt: typeof health.checkedAt === "number" ? health.checkedAt : null,
    latencyMs: typeof health.latencyMs === "number" ? health.latencyMs : null,
    reason: typeof health.reason === "string" ? health.reason : null,
  };
}

function normalizeSessionState(state: SessionState | null | undefined): SessionState {
  if (!state || !isRecord(state)) {
    return createIdleSessionState();
  }

  return {
    sessionId: typeof state.sessionId === "string" ? state.sessionId : null,
    meetingId: typeof state.meetingId === "string" ? state.meetingId : null,
    tabId: typeof state.tabId === "number" ? state.tabId : null,
    source: isCaptureSource(state.source) ? state.source : null,
    phase: isSessionPhase(state.phase) ? state.phase : "idle",
    transport: isSessionTransportState(state.transport) ? state.transport : "idle",
    reconnectAttempts:
      typeof state.reconnectAttempts === "number" && Number.isFinite(state.reconnectAttempts)
        ? state.reconnectAttempts
        : 0,
    reconnectDelayMs:
      typeof state.reconnectDelayMs === "number" && Number.isFinite(state.reconnectDelayMs)
        ? state.reconnectDelayMs
        : null,
    reconnectBudgetExceeded: typeof state.reconnectBudgetExceeded === "boolean" ? state.reconnectBudgetExceeded : false,
    startedAt: typeof state.startedAt === "number" ? state.startedAt : null,
    updatedAt: typeof state.updatedAt === "number" ? state.updatedAt : null,
    endedAt: typeof state.endedAt === "number" ? state.endedAt : null,
    currentPartialText:
      typeof state.currentPartialText === "string" ? state.currentPartialText : "",
    lastFinalText: typeof state.lastFinalText === "string" ? state.lastFinalText : "",
    segmentCount:
      typeof state.segmentCount === "number" && Number.isFinite(state.segmentCount)
        ? state.segmentCount
        : 0,
    transcriptUpdatedAt:
      typeof state.transcriptUpdatedAt === "number" ? state.transcriptUpdatedAt : null,
    lastError: normalizeProtocolError(state.lastError as ProtocolError | null | undefined),
    health: normalizeServiceHealth(state.health as ServiceHealth | null | undefined),
  };
}

function normalizeTranscriptSegment(
  segment: TranscriptSegmentInput,
  session: SessionState,
): TranscriptSegment {
  const timestamp = typeof segment.timestamp === "number" ? segment.timestamp : now();
  const sessionId = typeof segment.sessionId === "string" && segment.sessionId.length > 0
    ? segment.sessionId
    : session.sessionId ?? createId();
  const meetingId = typeof segment.meetingId === "string" && segment.meetingId.length > 0
    ? segment.meetingId
    : session.meetingId ?? sessionId;

  return {
    segmentId:
      typeof segment.segmentId === "string" && segment.segmentId.length > 0
        ? segment.segmentId
        : createId(),
    sessionId,
    meetingId,
    status: segment.status,
    text: segment.text,
    timestamp,
    chunkIndex: typeof segment.chunkIndex === "number" ? segment.chunkIndex : null,
    sampleRate: typeof segment.sampleRate === "number" ? segment.sampleRate : null,
    channels: typeof segment.channels === "number" ? segment.channels : null,
    confidence: typeof segment.confidence === "number" ? segment.confidence : null,
    source: isCaptureSource(segment.source) ? segment.source : session.source ?? "tab-audio",
    speakerLabel: typeof segment.speakerLabel === "string" ? segment.speakerLabel : null,
  };
}

function makeSnapshot(): SessionSnapshot {
  return {
    protocolVersion: PROTOCOL_VERSION,
    session: cloneSession(sessionState),
    transcript: transcriptSegments.map(cloneTranscriptSegment),
  };
}

function getStorageItems(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? "Storage read failed"));
        return;
      }

      resolve(items);
    });
  });
}

function getStorageBlob(): Promise<Record<string, unknown>> {
  return getStorageItems(SESSION_STORAGE_KEY);
}

function setStorageBlob(snapshot: SessionSnapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [SESSION_STORAGE_KEY]: snapshot }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? "Storage write failed"));
        return;
      }

      resolve();
    });
  });
}

function setStorageItems(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? "Storage write failed"));
        return;
      }

      resolve();
    });
  });
}

function getOptionsPageUrl(): string {
  const manifest = chrome.runtime.getManifest();
  const page = manifest.options_ui?.page ?? "src/onboarding/onboarding.html";
  return chrome.runtime.getURL(page);
}

function getPopupPageUrl(): string {
  return chrome.runtime.getURL("src/popup/popup.html");
}

function getSidebarPageUrl(): string {
  return chrome.runtime.getURL("src/sidebar/sidebar.html");
}

async function getUiRoutingState(): Promise<UiRoutingState> {
  const items = await getStorageItems(UI_ROUTING_STORAGE_KEY);
  return normalizeUiRoutingState(items[UI_ROUTING_STORAGE_KEY]);
}

async function setUiRoutingState(state: UiRoutingState): Promise<void> {
  await setStorageItems({ [UI_ROUTING_STORAGE_KEY]: state });
}

async function focusTab(tab: { id?: number; windowId?: number }): Promise<void> {
  if (typeof tab.id === "number") {
    await new Promise<void>((resolve) => {
      chrome.tabs.update(tab.id as number, { active: true }, () => {
        resolve();
      });
    });
  }
}

async function queryTabsByUrl(url: string): Promise<Array<{ id?: number; windowId?: number; url?: string }>> {
  return new Promise((resolve) => {
    chrome.tabs.query({ url }, (tabs) => {
      resolve(tabs);
    });
  });
}

async function openPageInTab(url: string): Promise<void> {
  const tabs = await queryTabsByUrl(url);
  const existingTab = tabs[0];

  if (existingTab) {
    await focusTab(existingTab);
    return;
  }

  await new Promise<void>((resolve) => {
    chrome.tabs.create({ url, active: true }, () => {
      resolve();
    });
  });
}

async function openOnboardingSurface(): Promise<void> {
  await openPageInTab(getOptionsPageUrl());
}

async function openPopupSurface(): Promise<void> {
  await openPageInTab(getPopupPageUrl());
}

async function openSidebarSurface(): Promise<void> {
  await openPageInTab(getSidebarPageUrl());
}

async function handleActionClick(): Promise<void> {
  await bootstrapServiceWorker();

  const routingState = await getUiRoutingState();

  if (!routingState.onboardingSeen) {
    await openOnboardingSurface();
    await setUiRoutingState({ onboardingSeen: true });
    return;
  }

  await openPopupSurface();
}

async function toggleCaptionsFromShortcut(): Promise<void> {
  await bootstrapServiceWorker();

  if (isCaptionsActivePhase(sessionState.phase)) {
    await endSession({
      type: "session.end",
      reason: "shortcut-stop-requested",
    });
    return;
  }

  await startSession();
}

async function handleCommand(command: string): Promise<void> {
  switch (command) {
    case "toggle-captions":
      await toggleCaptionsFromShortcut();
      break;
    case "open-transcript":
      await openSidebarSurface();
      break;
    default:
      break;
  }
}

async function handleUiBridgeRequest(message: UiBridgeRequest): Promise<void> {
  switch (message.type) {
    case "ktalk.ui.openSidebar":
      await openSidebarSurface();
      break;
    default:
      break;
  }
}

function isCaptionsActivePhase(phase: SessionState["phase"]): boolean {
  return phase === "checking-agent" || phase === "connecting" || phase === "listening" || phase === "reconnecting";
}

async function persistState(): Promise<void> {
  await setStorageBlob(makeSnapshot());
}

function applySessionState(nextState: SessionState, nextSegments = transcriptSegments): SessionSnapshot {
  sessionState = normalizeSessionState(nextState);
  transcriptSegments = nextSegments.map(cloneTranscriptSegment);
  return makeSnapshot();
}

function applySessionPatch(patch: SessionPatch): SessionSnapshot {
  sessionState = normalizeSessionState({
    ...sessionState,
    ...patch,
    lastError: normalizeProtocolError(patch.lastError ?? sessionState.lastError),
    health: patch.health ? normalizeServiceHealth(patch.health) : sessionState.health,
  });

  return makeSnapshot();
}

export async function bootstrapServiceWorker(): Promise<void> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    try {
      const items = await getStorageBlob();
      const stored = items[SESSION_STORAGE_KEY];

      if (isRecord(stored)) {
        sessionState = normalizeSessionState(stored.session as SessionState | undefined);
        transcriptSegments = Array.isArray(stored.transcript)
          ? stored.transcript
              .filter(isRecord)
              .map((entry) =>
                normalizeTranscriptSegment(
                  {
                    segmentId: typeof entry.segmentId === "string" ? entry.segmentId : undefined,
                    sessionId: typeof entry.sessionId === "string" ? entry.sessionId : undefined,
                    meetingId: typeof entry.meetingId === "string" ? entry.meetingId : undefined,
                    status: entry.status === "final" ? "final" : "partial",
                    text: typeof entry.text === "string" ? entry.text : "",
                    timestamp: typeof entry.timestamp === "number" ? entry.timestamp : now(),
                    chunkIndex:
                      typeof entry.chunkIndex === "number" ? entry.chunkIndex : null,
                    sampleRate:
                      typeof entry.sampleRate === "number" ? entry.sampleRate : null,
                    channels: typeof entry.channels === "number" ? entry.channels : null,
                    confidence:
                      typeof entry.confidence === "number" ? entry.confidence : null,
                    source: isCaptureSource(entry.source) ? entry.source : null,
                    speakerLabel:
                      typeof entry.speakerLabel === "string" ? entry.speakerLabel : null,
                  },
                  sessionState,
                ),
              )
          : [];
        return;
      }

      await persistState();
    } catch {
      sessionState = createIdleSessionState();
      transcriptSegments = [];
      await persistState();
    }

    await refreshSessionHealth("bootstrap");
    await persistState();
    notifyUiRefresh();
  })();

  await bootstrapPromise;
}

export function getSessionSnapshot(): SessionSnapshot {
  return makeSnapshot();
}

export async function startSession(seed: SessionSeed = {}): Promise<SessionSnapshot> {
  await bootstrapServiceWorker();

  const timestamp = typeof seed.startedAt === "number" ? seed.startedAt : now();
  const activeTabId = typeof seed.tabId === "number" ? seed.tabId : await getActiveTabId();
  const sessionId = typeof seed.sessionId === "string" && seed.sessionId.length > 0
    ? seed.sessionId
    : createId();
  const meetingId = typeof seed.meetingId === "string" && seed.meetingId.length > 0
    ? seed.meetingId
    : sessionId;

  transitionSessionState(
    {
      ...createIdleSessionState(),
      sessionId,
      meetingId,
      tabId: activeTabId,
      source: isCaptureSource(seed.source) ? seed.source : null,
      phase: "checking-agent",
      transport: "connecting",
      startedAt: timestamp,
      updatedAt: timestamp,
      health: buildHealth("checking", timestamp, null, "Checking local ASR availability."),
    },
    [],
  );

  await persistState();

  const health = await refreshSessionHealth("session-start");
  if (health.status !== "ready") {
    const failedAt = health.checkedAt ?? now();
    transitionSessionState({
      ...sessionState,
      phase: "finished",
      transport: "idle",
      endedAt: failedAt,
      updatedAt: failedAt,
      lastError: createProtocolError(
        "service-unreachable",
        health.reason ?? "Local ASR service is unavailable.",
        true,
        health.endpoint,
        failedAt,
      ),
      health,
    });
    await persistState();
    await syncSessionStateFromContent({
      type: "ktalk.content.markUnavailable",
      reason: health.reason ?? "local-asr-unavailable",
    });
    await persistState();
    notifyUiRefresh();
    return makeSnapshot();
  }

  const synced = await syncSessionStateFromContent({
    type: "ktalk.content.beginSession",
  });

  if (!synced) {
    transitionSessionState({
      ...sessionState,
      phase: "connecting",
      transport: "connecting",
      updatedAt: now(),
      health,
    });
  }

  await persistState();
  notifyUiRefresh();
  return makeSnapshot();
}

export async function updateSession(patch: SessionPatch): Promise<SessionSnapshot> {
  await bootstrapServiceWorker();
  applySessionPatch({
    ...patch,
    updatedAt: patch.updatedAt ?? now(),
    lastError: normalizeProtocolError(patch.lastError),
    health: patch.health ? normalizeServiceHealth(patch.health) : sessionState.health,
  });
  await persistState();
  return makeSnapshot();
}

export async function endSession(request: SessionEndRequest = { type: "session.end" }): Promise<SessionSnapshot> {
  await bootstrapServiceWorker();

  const timestamp = now();
  const reason = typeof request.reason === "string" ? request.reason : null;

  transitionSessionState({
    ...sessionState,
    phase: "finished",
    transport: "idle",
    endedAt: timestamp,
    updatedAt: timestamp,
    lastError: reason
      ? createProtocolError("unknown", reason, true, null, timestamp)
      : null,
  });

  await persistState();
  await syncSessionStateFromContent({
    type: "ktalk.content.stop",
    reason: reason ?? undefined,
  });
  await persistState();
  notifyUiRefresh();
  return makeSnapshot();
}

export async function resetSession(): Promise<SessionSnapshot> {
  await bootstrapServiceWorker();

  transitionSessionState(createIdleSessionState(), []);
  await persistState();
  await syncSessionStateFromContent({ type: "ktalk.content.reset" });
  await persistState();
  notifyUiRefresh();
  return makeSnapshot();
}

export async function appendTranscriptSegment(
  input: TranscriptSegmentInput,
): Promise<SessionSnapshot> {
  await bootstrapServiceWorker();

  const normalized = normalizeTranscriptSegment(input, sessionState);
  const nextSegments = [...transcriptSegments];
  const existingIndex = nextSegments.findIndex((segment) => segment.segmentId === normalized.segmentId);

  if (existingIndex >= 0) {
    nextSegments[existingIndex] = normalized;
  } else {
    nextSegments.push(normalized);
  }

  applyTranscriptTransportResult(normalized, nextSegments);
  await persistState();
  notifyUiRefresh();
  return makeSnapshot();
}

export async function setServiceHealth(health: ServiceHealth): Promise<SessionSnapshot> {
  await bootstrapServiceWorker();
  applyHealthToSession(normalizeServiceHealth(health));
  await persistState();
  notifyUiRefresh();
  return makeSnapshot();
}

export async function handleRuntimeMessage(
  message: RuntimeRequest | unknown,
): Promise<RuntimeResponse> {
  await bootstrapServiceWorker();

  if (!isRecord(message) || typeof message.type !== "string") {
    return {
      ok: false,
      requestId: null,
      type: "error",
      error: createProtocolError(
        "protocol-error",
        "Unsupported runtime message.",
        false,
        "Message payload is not a recognized request shape.",
      ),
    };
  }

  const requestId = typeof message.requestId === "string" ? message.requestId : null;

  switch (message.type) {
    case "protocol.ping":
      return {
        ok: true,
        requestId,
        type: "protocol.pong",
        protocolVersion: PROTOCOL_VERSION,
      };
    case "session.get":
      return {
        ok: true,
        requestId,
        type: "session.snapshot",
        snapshot: makeSnapshot(),
      };
    case "session.start":
      return {
        ok: true,
        requestId,
        type: "session.snapshot",
        snapshot: await startSession((message as { session?: SessionSeed }).session ?? {}),
      };
    case "session.update":
      return {
        ok: true,
        requestId,
        type: "session.snapshot",
        snapshot: await updateSession((message as { patch: SessionPatch }).patch),
      };
    case "session.end":
      return {
        ok: true,
        requestId,
        type: "session.snapshot",
        snapshot: await endSession(
          isSessionEndRequest(message)
            ? message
            : { type: "session.end" },
        ),
      };
    case "session.reset":
      return {
        ok: true,
        requestId,
        type: "session.snapshot",
        snapshot: await resetSession(),
      };
    case "transcript.append":
      return {
        ok: true,
        requestId,
        type: "session.snapshot",
        snapshot: await appendTranscriptSegment((message as { segment: TranscriptSegmentInput }).segment),
      };
    case "service.health.get": {
      const health = await refreshSessionHealth("service-health-get");
      await persistState();
      return {
        ok: true,
        requestId,
        type: "service.health",
        health,
      };
    }
    default:
      return {
        ok: false,
        requestId,
        type: "error",
        error: createProtocolError(
          "protocol-error",
          `Unsupported runtime message type: ${message.type}`,
          false,
        ),
      };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void bootstrapServiceWorker();
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrapServiceWorker();
});

chrome.action.onClicked.addListener(() => {
  void handleActionClick();
});

chrome.commands.onCommand.addListener((command) => {
  void handleCommand(command);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (sessionState.tabId !== tabId || !isCaptionsActivePhase(sessionState.phase)) {
    return;
  }

  void endSession({
    type: "session.end",
    reason: "meeting-tab-closed",
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isUiBroadcastMessage(message)) {
    return false;
  }

  if (isContentSnapshotMessage(message)) {
    const nextState = mapContentScriptSnapshotToSessionState(message.snapshot);
    transitionSessionState({
      ...nextState,
      tabId: getSenderTabId(sender) ?? sessionState.tabId,
      updatedAt: now(),
    });
    void persistState();
    notifyUiRefresh();
    sendResponse(makeSnapshot());
    return false;
  }

  if (isContentBridgeMessage(message)) {
    void sendContentBridgeMessage(message).then((response) => {
      sendResponse(response);
    });
    return true;
  }

  if (isRecord(message) && typeof message.type === "string" && message.type.startsWith("ktalk.ui.")) {
    void handleUiBridgeRequest(message as UiBridgeRequest)
      .then(() => {
        sendResponse({
          ok: true,
          requestId: null,
          type: "protocol.pong",
          protocolVersion: PROTOCOL_VERSION,
        } satisfies RuntimeResponse);
      })
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : "Unknown worker failure";
        sendResponse({
          ok: false,
          requestId: null,
          type: "error",
          error: createProtocolError("unknown", messageText, true),
        } satisfies RuntimeResponse);
      });
    return true;
  }

  void handleRuntimeMessage(message)
    .then((response) => {
      sendResponse(response);
    })
    .catch((error: unknown) => {
      const messageText = error instanceof Error ? error.message : "Unknown worker failure";
      sendResponse({
        ok: false,
        requestId: null,
        type: "error",
        error: createProtocolError("unknown", messageText, true),
      } satisfies RuntimeResponse);
    });

  return true;
});

void bootstrapServiceWorker();
