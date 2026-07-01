import {
  LOCAL_ASR_HTTP_URL,
  PROTOCOL_VERSION,
  type ProtocolError,
  type RuntimeRequest,
  type RuntimeResponse,
  type SessionSnapshot,
  type ServiceHealth,
  type SessionErrorCode,
} from "../shared/protocol";

export const DIAGNOSTICS_EVENTS = {
  refreshRequested: "ktalk.diagnostics.refresh-requested",
  stateChanged: "ktalk.diagnostics.state-changed",
  snapshotCopied: "ktalk.diagnostics.snapshot-copied",
} as const;

type DiagnosticsStatus = "healthy" | "warning" | "error" | "unknown";

type PermissionProbeState = {
  status: DiagnosticsStatus;
  detail: string;
  missingPermissions: string[];
  missingOrigins: string[];
};

type RuntimeProbeState = {
  status: DiagnosticsStatus;
  detail: string;
  version: string;
  protocolVersion: number | null;
};

type ServiceProbeState = {
  status: DiagnosticsStatus;
  label: string;
  detail: string;
  endpoint: string;
  checkedAt: number | null;
  latencyMs: number | null;
  reason: string | null;
};

type ReconnectProbeState = {
  status: DiagnosticsStatus;
  label: string;
  detail: string;
  sessionPhase: SessionSnapshot["session"]["phase"];
  transport: SessionSnapshot["session"]["transport"];
  reconnectAttempts: number;
  reconnectDelayMs: number | null;
  reconnectBudgetExceeded: boolean;
  lastError: ProtocolError | null;
  nextStep: string;
};

type ErrorCatalogEntry = {
  code: SessionErrorCode;
  title: string;
  description: string;
  recovery: string;
  severity: DiagnosticsStatus;
};

export type DiagnosticsState = {
  updatedAt: number | null;
  runtime: RuntimeProbeState;
  service: ServiceProbeState;
  capture: PermissionProbeState;
  reconnect: ReconnectProbeState;
  snapshot: SessionSnapshot | null;
  catalog: ReadonlyArray<ErrorCatalogEntry>;
};

type DiagnosticsElements = {
  status: HTMLElement;
  refreshButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  runtimeStatus: HTMLElement;
  runtimeDetail: HTMLElement;
  runtimeVersion: HTMLElement;
  runtimeProtocol: HTMLElement;
  serviceStatus: HTMLElement;
  serviceDetail: HTMLElement;
  serviceEndpoint: HTMLElement;
  serviceCheckedAt: HTMLElement;
  serviceLatency: HTMLElement;
  serviceReason: HTMLElement;
  captureStatus: HTMLElement;
  captureDetail: HTMLElement;
  captureMissingPermissions: HTMLElement;
  captureMissingOrigins: HTMLElement;
  reconnectStatus: HTMLElement;
  reconnectDetail: HTMLElement;
  reconnectPhase: HTMLElement;
  reconnectTransport: HTMLElement;
  reconnectAttempts: HTMLElement;
  reconnectDelay: HTMLElement;
  reconnectBudget: HTMLElement;
  reconnectError: HTMLElement;
  reconnectNextStep: HTMLElement;
  snapshot: HTMLElement;
  note: HTMLElement;
  catalog: HTMLElement;
};

const REQUIRED_PERMISSIONS = ["activeTab", "tabs", "storage", "tabCapture"] as const;
const REQUIRED_ORIGINS = ["http://localhost:8000/*", "ws://localhost:8000/*"] as const;

const ERROR_CATALOG: ReadonlyArray<ErrorCatalogEntry> = [
  {
    code: "service-unreachable",
    title: "Local service offline",
    description:
      "The local ASR service did not answer the health probe or returned an unavailable state.",
    recovery:
      "Start the service on localhost:8000, confirm the WebSocket endpoint is reachable, then refresh diagnostics.",
    severity: "error",
  },
  {
    code: "permission-denied",
    title: "Capture permission denied",
    description:
      "Chrome blocked one or more capture permissions required for the local audio pipeline.",
    recovery:
      "Reload the extension, confirm the manifest permissions are present, and grant the capture prompt again.",
    severity: "error",
  },
  {
    code: "capture-failed",
    title: "Audio capture failed",
    description:
      "The browser could not open the chosen audio source or build the capture stream.",
    recovery:
      "Check that the meeting tab is active, audio is playing, and no other tab-capture flow is already running.",
    severity: "warning",
  },
  {
    code: "socket-closed",
    title: "Reconnect loop interrupted",
    description:
      "The transport disconnected while captions were active or while the app was trying to reconnect.",
    recovery:
      "Confirm the local ASR service is still running, then restart the caption session after the transport settles.",
    severity: "warning",
  },
  {
    code: "protocol-error",
    title: "Protocol mismatch",
    description:
      "The background worker received a message shape it did not recognize or could not validate.",
    recovery:
      "Refresh the extension to reload the current bundle and re-run the diagnostics view.",
    severity: "warning",
  },
  {
    code: "unknown",
    title: "Unclassified failure",
    description:
      "The worker reported an error that does not match a known recovery path.",
    recovery:
      "Use the raw snapshot and local logs to identify the failing step, then retry the session.",
    severity: "unknown",
  },
];

const state: DiagnosticsState = {
  updatedAt: null,
  runtime: {
    status: "unknown",
    detail: "The extension bridge has not responded yet.",
    version: "Unknown",
    protocolVersion: PROTOCOL_VERSION,
  },
  service: {
    status: "unknown",
    label: "Checking",
    detail: "The local service probe will appear here.",
    endpoint: LOCAL_ASR_HTTP_URL,
    checkedAt: null,
    latencyMs: null,
    reason: null,
  },
  capture: {
    status: "unknown",
    detail: "Capture permissions will be verified locally.",
    missingPermissions: [],
    missingOrigins: [],
  },
  reconnect: {
    status: "unknown",
    label: "Checking",
    detail: "The current reconnect state will appear here.",
    sessionPhase: "idle",
    transport: "idle",
    reconnectAttempts: 0,
    reconnectDelayMs: null,
    reconnectBudgetExceeded: false,
    lastError: null,
    nextStep: "No action required.",
  },
  snapshot: null,
  catalog: ERROR_CATALOG,
};

let initialized = false;
let refreshTimer: number | null = null;
let inFlightRefresh: Promise<void> | null = null;

function getRequiredElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function getElements(): DiagnosticsElements | null {
  const status = getRequiredElement<HTMLElement>("diagnostics-status");
  const refreshButton = getRequiredElement<HTMLButtonElement>("refresh-diagnostics");
  const copyButton = getRequiredElement<HTMLButtonElement>("copy-diagnostics");
  const runtimeStatus = getRequiredElement<HTMLElement>("runtime-status");
  const runtimeDetail = getRequiredElement<HTMLElement>("runtime-detail");
  const runtimeVersion = getRequiredElement<HTMLElement>("runtime-version");
  const runtimeProtocol = getRequiredElement<HTMLElement>("runtime-protocol");
  const serviceStatus = getRequiredElement<HTMLElement>("service-status");
  const serviceDetail = getRequiredElement<HTMLElement>("service-detail");
  const serviceEndpoint = getRequiredElement<HTMLElement>("service-endpoint");
  const serviceCheckedAt = getRequiredElement<HTMLElement>("service-checked-at");
  const serviceLatency = getRequiredElement<HTMLElement>("service-latency");
  const serviceReason = getRequiredElement<HTMLElement>("service-reason");
  const captureStatus = getRequiredElement<HTMLElement>("capture-status");
  const captureDetail = getRequiredElement<HTMLElement>("capture-detail");
  const captureMissingPermissions = getRequiredElement<HTMLElement>("capture-missing-permissions");
  const captureMissingOrigins = getRequiredElement<HTMLElement>("capture-missing-origins");
  const reconnectStatus = getRequiredElement<HTMLElement>("reconnect-status");
  const reconnectDetail = getRequiredElement<HTMLElement>("reconnect-detail");
  const reconnectPhase = getRequiredElement<HTMLElement>("reconnect-phase");
  const reconnectTransport = getRequiredElement<HTMLElement>("reconnect-transport");
  const reconnectAttempts = getRequiredElement<HTMLElement>("reconnect-attempts");
  const reconnectDelay = getRequiredElement<HTMLElement>("reconnect-delay");
  const reconnectBudget = getRequiredElement<HTMLElement>("reconnect-budget");
  const reconnectError = getRequiredElement<HTMLElement>("reconnect-error");
  const reconnectNextStep = getRequiredElement<HTMLElement>("reconnect-next-step");
  const snapshot = getRequiredElement<HTMLElement>("diagnostics-snapshot");
  const note = getRequiredElement<HTMLElement>("diagnostics-note");
  const catalog = getRequiredElement<HTMLElement>("diagnostics-catalog");

  if (
    !status ||
    !refreshButton ||
    !copyButton ||
    !runtimeStatus ||
    !runtimeDetail ||
    !runtimeVersion ||
    !runtimeProtocol ||
    !serviceStatus ||
    !serviceDetail ||
    !serviceEndpoint ||
    !serviceCheckedAt ||
    !serviceLatency ||
    !serviceReason ||
    !captureStatus ||
    !captureDetail ||
    !captureMissingPermissions ||
    !captureMissingOrigins ||
    !reconnectStatus ||
    !reconnectDetail ||
    !reconnectPhase ||
    !reconnectTransport ||
    !reconnectAttempts ||
    !reconnectDelay ||
    !reconnectBudget ||
    !reconnectError ||
    !reconnectNextStep ||
    !snapshot ||
    !note ||
    !catalog
  ) {
    return null;
  }

  return {
    status,
    refreshButton,
    copyButton,
    runtimeStatus,
    runtimeDetail,
    runtimeVersion,
    runtimeProtocol,
    serviceStatus,
    serviceDetail,
    serviceEndpoint,
    serviceCheckedAt,
    serviceLatency,
    serviceReason,
    captureStatus,
    captureDetail,
    captureMissingPermissions,
    captureMissingOrigins,
    reconnectStatus,
    reconnectDetail,
    reconnectPhase,
    reconnectTransport,
    reconnectAttempts,
    reconnectDelay,
    reconnectBudget,
    reconnectError,
    reconnectNextStep,
    snapshot,
    note,
    catalog,
  };
}

function cloneState(): DiagnosticsState {
  return {
    ...state,
    runtime: { ...state.runtime },
    service: { ...state.service },
    capture: { ...state.capture, missingPermissions: [...state.capture.missingPermissions], missingOrigins: [...state.capture.missingOrigins] },
    reconnect: {
      ...state.reconnect,
      lastError: state.reconnect.lastError
        ? { ...state.reconnect.lastError }
        : null,
    },
    snapshot: state.snapshot
      ? {
          ...state.snapshot,
          session: { ...state.snapshot.session },
          transcript: [...state.snapshot.transcript],
        }
      : null,
    catalog: [...state.catalog],
  };
}

function createRequestId(): string {
  return `diagnostics-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTimestamp(timestamp: number | null): string {
  if (timestamp === null) {
    return "Not checked yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) {
    return "Unknown";
  }

  return `${latencyMs} ms`;
}

function formatRetryDelay(retryDelayMs: number | null): string {
  if (retryDelayMs === null) {
    return "Unknown";
  }

  return `${retryDelayMs} ms`;
}

function setStatusBadge(element: HTMLElement | null, status: DiagnosticsStatus, label: string): void {
  if (!element) {
    return;
  }

  element.dataset.status = status;
  element.textContent = label;
}

async function sendRuntimeMessage<T extends RuntimeResponse>(message: RuntimeRequest): Promise<T | null> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return null;
  }

  return await new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), 1500);

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

async function probeRuntime(): Promise<RuntimeProbeState> {
  const response = await sendRuntimeMessage<RuntimeResponse>({
    type: "protocol.ping",
    requestId: createRequestId(),
  });

  if (response?.type === "protocol.pong") {
    const manifestVersion = typeof chrome !== "undefined" ? chrome.runtime.getManifest().version : "Unknown";
    return {
      status: "healthy",
      detail: "The background service worker responded to a local ping.",
      version: manifestVersion,
      protocolVersion: response.protocolVersion,
    };
  }

  return {
    status: "error",
    detail: "The background service worker did not respond to the local ping.",
    version: typeof chrome !== "undefined" ? chrome.runtime.getManifest().version : "Unknown",
    protocolVersion: null,
  };
}

async function probeService(): Promise<ServiceProbeState> {
  const response = await sendRuntimeMessage<RuntimeResponse>({
    type: "service.health.get",
    requestId: createRequestId(),
  });

  if (response?.type === "service.health") {
    return mapServiceHealth(response.health);
  }

  return {
    status: "error",
    label: "Blocked",
    detail: "The local ASR service could not be checked through the runtime bridge.",
    endpoint: LOCAL_ASR_HTTP_URL,
    checkedAt: null,
    latencyMs: null,
    reason: "Runtime health request failed.",
  };
}

async function probeSession(): Promise<SessionSnapshot | null> {
  const response = await sendRuntimeMessage<RuntimeResponse>({
    type: "session.get",
    requestId: createRequestId(),
  });

  if (response?.type === "session.snapshot") {
    return response.snapshot;
  }

  return null;
}

async function probeCapturePermission(): Promise<PermissionProbeState> {
  if (typeof chrome === "undefined" || !chrome.permissions?.contains) {
    return {
      status: "unknown",
      detail: "Browser permission APIs are unavailable in this context.",
      missingPermissions: [],
      missingOrigins: [],
    };
  }

  const [permissionsGranted, originGranted] = await Promise.all([
    new Promise<boolean>((resolve) => {
      chrome.permissions.contains({ permissions: [...REQUIRED_PERMISSIONS] }, (granted) => {
        resolve(Boolean(granted));
      });
    }),
    new Promise<boolean>((resolve) => {
      chrome.permissions.contains({ origins: [...REQUIRED_ORIGINS] }, (granted) => {
        resolve(Boolean(granted));
      });
    }),
  ]);

  const missingPermissions = permissionsGranted ? [] : [...REQUIRED_PERMISSIONS];
  const missingOrigins = originGranted ? [] : [...REQUIRED_ORIGINS];

  if (missingPermissions.length === 0 && missingOrigins.length === 0) {
    return {
      status: "healthy",
      detail:
        "Required capture permissions and localhost host access are already available to the extension.",
      missingPermissions,
      missingOrigins,
    };
  }

  const parts = [
    missingPermissions.length > 0 ? `missing ${missingPermissions.join(", ")}` : null,
    missingOrigins.length > 0 ? `missing host access for ${missingOrigins.join(", ")}` : null,
  ].filter(Boolean);

  return {
    status: "error",
    detail:
      `Capture permission check failed: ${parts.join("; ")}. Reload the extension and grant the missing access.`,
    missingPermissions,
    missingOrigins,
  };
}

function mapServiceHealth(health: ServiceHealth): ServiceProbeState {
  switch (health.status) {
    case "ready":
      return {
        status: "healthy",
        label: "Ready",
        detail: "The local ASR endpoint responded to the health probe.",
        endpoint: health.endpoint,
        checkedAt: health.checkedAt,
        latencyMs: health.latencyMs,
        reason: health.reason,
      };
    case "checking":
      return {
        status: "unknown",
        label: "Checking",
        detail: "The local ASR endpoint is still being probed.",
        endpoint: health.endpoint,
        checkedAt: health.checkedAt,
        latencyMs: health.latencyMs,
        reason: health.reason,
      };
    case "degraded":
      return {
        status: "warning",
        label: "Degraded",
        detail: health.reason ?? "The local ASR endpoint responded, but the service is slower than expected.",
        endpoint: health.endpoint,
        checkedAt: health.checkedAt,
        latencyMs: health.latencyMs,
        reason: health.reason,
      };
    case "unreachable":
      return {
        status: "error",
        label: "Missing",
        detail:
          health.reason ?? "The local ASR endpoint did not respond. Start the service before trying again.",
        endpoint: health.endpoint,
        checkedAt: health.checkedAt,
        latencyMs: health.latencyMs,
        reason: health.reason,
      };
    case "unknown":
    default:
      return {
        status: "unknown",
        label: "Unknown",
        detail: health.reason ?? "The service state is not available yet.",
        endpoint: health.endpoint,
        checkedAt: health.checkedAt,
        latencyMs: health.latencyMs,
        reason: health.reason,
      };
  }
}

function findCatalogEntry(code: SessionErrorCode): ErrorCatalogEntry {
  return (
    ERROR_CATALOG.find((entry) => entry.code === code) ?? {
      code,
      title: "Unlisted error",
      description: "The worker returned an error code that is not yet in the local catalog.",
      recovery: "Refresh the diagnostics page and compare the raw snapshot with the worker logs.",
      severity: "unknown",
    }
  );
}

function mapReconnectState(snapshot: SessionSnapshot | null): ReconnectProbeState {
  const session = snapshot?.session;
  const lastError = session?.lastError ?? null;
  const phase = session?.phase ?? "idle";
  const transport = session?.transport ?? "idle";

  if (!session) {
    return {
      status: "unknown",
      label: "No snapshot",
      detail: "The background session snapshot is not available yet.",
      sessionPhase: "idle",
      transport: "idle",
      reconnectAttempts: 0,
      reconnectDelayMs: null,
      reconnectBudgetExceeded: false,
      lastError: null,
      nextStep: "Refresh diagnostics to read the current session state.",
    };
  }

  if (lastError) {
    const catalogEntry = findCatalogEntry(lastError.code);
    return {
      status: catalogEntry.severity === "error" ? "error" : catalogEntry.severity === "warning" ? "warning" : "unknown",
      label: catalogEntry.title,
      detail: `${catalogEntry.description} ${lastError.message}`.trim(),
      sessionPhase: phase,
      transport,
      reconnectAttempts: session.reconnectAttempts,
      reconnectDelayMs: session.reconnectDelayMs,
      reconnectBudgetExceeded: session.reconnectBudgetExceeded,
      lastError,
      nextStep: catalogEntry.recovery,
    };
  }

  if (session.reconnectBudgetExceeded) {
    return {
      status: "error",
      label: "Reconnect budget exhausted",
      detail:
        "The session exceeded the bounded reconnect budget and stopped trying to recover automatically.",
      sessionPhase: phase,
      transport,
      reconnectAttempts: session.reconnectAttempts,
      reconnectDelayMs: session.reconnectDelayMs,
      reconnectBudgetExceeded: true,
      lastError: null,
      nextStep: "Restart the caption session after the local service is stable again.",
    };
  }

  if (phase === "reconnecting" || transport === "reconnecting") {
    return {
      status: "warning",
      label: "Reconnecting",
      detail:
        `The session is still trying to recover the live transport. Retry ${session.reconnectAttempts} is queued${session.reconnectDelayMs ? ` with a ${session.reconnectDelayMs} ms delay` : ""}.`,
      sessionPhase: phase,
      transport,
      reconnectAttempts: session.reconnectAttempts,
      reconnectDelayMs: session.reconnectDelayMs,
      reconnectBudgetExceeded: false,
      lastError: null,
      nextStep:
        session.reconnectDelayMs !== null
          ? "Wait for the backoff window to elapse, then let the session retry automatically."
          : "Wait for the local service to recover, then refresh diagnostics.",
    };
  }

  if (phase === "connecting") {
    return {
      status: "unknown",
      label: "Connecting",
      detail: "The session is preparing the local audio and transport pipeline.",
      sessionPhase: phase,
      transport,
      reconnectAttempts: session.reconnectAttempts,
      reconnectDelayMs: session.reconnectDelayMs,
      reconnectBudgetExceeded: session.reconnectBudgetExceeded,
      lastError: null,
      nextStep: "No action required unless the session stalls for an extended period.",
    };
  }

  return {
    status: "healthy",
    label: "Healthy",
    detail: "No reconnect failure is recorded for the current session.",
    sessionPhase: phase,
    transport,
    reconnectAttempts: session.reconnectAttempts,
    reconnectDelayMs: session.reconnectDelayMs,
    reconnectBudgetExceeded: session.reconnectBudgetExceeded,
    lastError: null,
    nextStep: "No action required.",
  };
}

function renderCatalog(elements: DiagnosticsElements): void {
  elements.catalog.replaceChildren();

  for (const entry of state.catalog) {
    const card = document.createElement("article");
    card.className = "catalog-item";
    card.dataset.severity = entry.severity;

    const head = document.createElement("div");
    head.className = "catalog-item__head";

    const title = document.createElement("div");
    title.className = "catalog-item__title";
    title.textContent = entry.title;

    const code = document.createElement("span");
    code.className = "catalog-item__code";
    code.textContent = entry.code;

    const description = document.createElement("p");
    description.className = "catalog-item__message";
    description.textContent = entry.description;

    const recovery = document.createElement("p");
    recovery.className = "catalog-item__recovery";
    const recoveryLabel = document.createElement("strong");
    recoveryLabel.textContent = "Recovery:";
    recovery.append(recoveryLabel, document.createTextNode(` ${entry.recovery}`));

    head.append(title, code);
    card.append(head, description, recovery);
    elements.catalog.append(card);
  }
}

function render(elements: DiagnosticsElements): void {
  setStatusBadge(elements.runtimeStatus, state.runtime.status, state.runtime.status === "healthy" ? "Ready" : state.runtime.status === "warning" ? "Review" : state.runtime.status === "error" ? "Missing" : "Checking");
  setStatusBadge(elements.serviceStatus, state.service.status, state.service.label);
  setStatusBadge(elements.captureStatus, state.capture.status, state.capture.status === "healthy" ? "Ready" : state.capture.status === "error" ? "Missing" : "Checking");
  setStatusBadge(elements.reconnectStatus, state.reconnect.status, state.reconnect.label);

  elements.runtimeDetail.textContent = state.runtime.detail;
  elements.runtimeVersion.textContent = state.runtime.version;
  elements.runtimeProtocol.textContent = `v${state.runtime.protocolVersion ?? PROTOCOL_VERSION}`;

  elements.serviceDetail.textContent = state.service.detail;
  elements.serviceEndpoint.textContent = state.service.endpoint;
  elements.serviceCheckedAt.textContent = formatTimestamp(state.service.checkedAt);
  elements.serviceLatency.textContent = formatLatency(state.service.latencyMs);
  elements.serviceReason.textContent = state.service.reason ?? "No failure recorded.";

  elements.captureDetail.textContent = state.capture.detail;
  elements.captureMissingPermissions.textContent =
    state.capture.missingPermissions.length > 0 ? state.capture.missingPermissions.join(", ") : "None";
  elements.captureMissingOrigins.textContent =
    state.capture.missingOrigins.length > 0 ? state.capture.missingOrigins.join(", ") : "None";

  elements.reconnectDetail.textContent = state.reconnect.detail;
  elements.reconnectPhase.textContent = state.reconnect.sessionPhase;
  elements.reconnectTransport.textContent = state.reconnect.transport;
  elements.reconnectAttempts.textContent = String(state.reconnect.reconnectAttempts);
  elements.reconnectDelay.textContent = formatRetryDelay(state.reconnect.reconnectDelayMs);
  elements.reconnectBudget.textContent = state.reconnect.reconnectBudgetExceeded ? "Yes" : "No";
  elements.reconnectError.textContent = state.reconnect.lastError
    ? `${state.reconnect.lastError.code}: ${state.reconnect.lastError.message}`
    : "None";
  elements.reconnectNextStep.textContent = state.reconnect.nextStep;

  elements.snapshot.textContent = JSON.stringify(
    {
      updatedAt: state.updatedAt,
      runtime: state.runtime,
      service: state.service,
      capture: state.capture,
      reconnect: {
        status: state.reconnect.status,
        label: state.reconnect.label,
        detail: state.reconnect.detail,
        sessionPhase: state.reconnect.sessionPhase,
        transport: state.reconnect.transport,
        lastError: state.reconnect.lastError,
        nextStep: state.reconnect.nextStep,
      },
      snapshot: state.snapshot,
    },
    null,
    2,
  );

  elements.note.textContent =
    "The snapshot stays local to this browser profile and is meant for debugging service, permission, and reconnect issues.";

  renderCatalog(elements);

  elements.status.textContent = `Last refreshed ${state.updatedAt ? formatTimestamp(state.updatedAt) : "just now"}.`;

  window.dispatchEvent(
    new CustomEvent(DIAGNOSTICS_EVENTS.stateChanged, {
      detail: cloneState(),
    }),
  );
}

function updateState(nextState: Partial<DiagnosticsState>): void {
  if (typeof nextState.updatedAt === "number" || nextState.updatedAt === null) {
    state.updatedAt = nextState.updatedAt;
  }

  if (nextState.runtime) {
    state.runtime = { ...state.runtime, ...nextState.runtime };
  }

  if (nextState.service) {
    state.service = { ...state.service, ...nextState.service };
  }

  if (nextState.capture) {
    state.capture = {
      ...state.capture,
      ...nextState.capture,
      missingPermissions: [...(nextState.capture.missingPermissions ?? state.capture.missingPermissions)],
      missingOrigins: [...(nextState.capture.missingOrigins ?? state.capture.missingOrigins)],
    };
  }

  if (nextState.reconnect) {
    state.reconnect = {
      ...state.reconnect,
      ...nextState.reconnect,
      lastError: nextState.reconnect.lastError ? { ...nextState.reconnect.lastError } : null,
    };
  }

  if (Object.prototype.hasOwnProperty.call(nextState, "snapshot")) {
    state.snapshot = nextState.snapshot
      ? {
          ...nextState.snapshot,
          session: { ...nextState.snapshot.session },
          transcript: [...nextState.snapshot.transcript],
        }
      : null;
  }
}

async function refreshInternal(elements: DiagnosticsElements): Promise<void> {
  if (inFlightRefresh) {
    await inFlightRefresh;
    return;
  }

  window.dispatchEvent(new CustomEvent(DIAGNOSTICS_EVENTS.refreshRequested));
  elements.status.textContent = "Refreshing local diagnostics.";
  setStatusBadge(elements.runtimeStatus, "unknown", "Checking");
  setStatusBadge(elements.serviceStatus, "unknown", "Checking");
  setStatusBadge(elements.captureStatus, "unknown", "Checking");
  setStatusBadge(elements.reconnectStatus, "unknown", "Checking");

  inFlightRefresh = (async () => {
    const [runtime, capture] = await Promise.all([probeRuntime(), probeCapturePermission()]);
    const service = await probeService();
    const snapshot = await probeSession();
    const reconnect = mapReconnectState(snapshot);

    updateState({
      updatedAt: Date.now(),
      runtime,
      service,
      capture,
      reconnect,
      snapshot,
    });

    render(elements);
  })();

  try {
    await inFlightRefresh;
  } finally {
    inFlightRefresh = null;
  }
}

async function copySnapshot(): Promise<boolean> {
  const payload = JSON.stringify(cloneState(), null, 2);

  try {
    await navigator.clipboard.writeText(payload);
    return true;
  } catch {
    return false;
  }
}

export async function refreshDiagnostics(): Promise<DiagnosticsState> {
  const elements = getElements();
  if (!elements) {
    return cloneState();
  }

  await refreshInternal(elements);
  return cloneState();
}

export function getDiagnosticsState(): DiagnosticsState {
  return cloneState();
}

export function initDiagnosticsPage(): void {
  if (initialized) {
    return;
  }

  const elements = getElements();
  if (!elements) {
    return;
  }

  initialized = true;
  renderCatalog(elements);
  render(elements);

  elements.refreshButton.addEventListener("click", () => {
    void refreshDiagnostics();
  });

  elements.copyButton.addEventListener("click", async () => {
    const copied = await copySnapshot();
    elements.note.textContent = copied
      ? "Copied the raw snapshot to the clipboard."
      : "Clipboard access was blocked. Select and copy the raw snapshot manually.";

    window.dispatchEvent(new CustomEvent(DIAGNOSTICS_EVENTS.snapshotCopied, { detail: copied }));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshDiagnostics();
    }
  });

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || typeof message !== "object" || !("type" in message)) {
        return;
      }

      if ((message as { type?: string }).type === "ktalk.ui.refresh") {
        void refreshDiagnostics();
      }
    });
  }

  refreshTimer = window.setInterval(() => {
    void refreshDiagnostics();
  }, 15000);

  window.addEventListener("beforeunload", () => {
    if (refreshTimer !== null) {
      window.clearInterval(refreshTimer);
    }
  });

  void refreshDiagnostics();
}

declare global {
  interface Window {
    ktalkDiagnostics?: {
      refresh: () => Promise<DiagnosticsState>;
      getState: () => DiagnosticsState;
      copySnapshot: () => Promise<boolean>;
      events: typeof DIAGNOSTICS_EVENTS;
    };
  }
}

window.ktalkDiagnostics = {
  refresh: refreshDiagnostics,
  getState: getDiagnosticsState,
  copySnapshot,
  events: DIAGNOSTICS_EVENTS,
};

export {};
