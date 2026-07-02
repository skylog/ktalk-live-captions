import { assertLocalAsrHttpUrl, LOCAL_ASR_HTTP_URL } from "../shared/protocol";

export const INSTALLER_STATE_EVENT = "ktalk-installer:statechange";
export const INSTALLER_CHECK_EVENT = "ktalk-installer:check";
export const INSTALLER_PAGE_PATH = "src/installer/installer.html";

export type InstallerPhase = "checking" | "retrying" | "ready" | "missing";

export type ServiceDiscoveryResult = {
  reachable: boolean;
  checkedAt: number;
  latencyMs: number | null;
  detail: string;
  endpoint: string;
};

export type InstallerSnapshot = {
  phase: InstallerPhase;
  endpoint: string;
  detail: string;
  checkedAt: number | null;
  latencyMs: number | null;
  reachable: boolean | null;
  retryCount: number;
};

export type InstallerController = {
  refresh: () => Promise<ServiceDiscoveryResult>;
  getState: () => InstallerSnapshot;
  destroy: () => void;
};

const discoveryTimeoutMs = 2000;

const defaultSnapshot: InstallerSnapshot = {
  phase: "checking",
  endpoint: LOCAL_ASR_HTTP_URL,
  detail: "Waiting for the first local check.",
  checkedAt: null,
  latencyMs: null,
  reachable: null,
  retryCount: 0,
};

const state: InstallerSnapshot = { ...defaultSnapshot };

const elements = {
  primaryAction: document.getElementById("retry-discovery") as HTMLButtonElement | null,
  installerPhase: document.getElementById("installer-phase"),
  installerSummary: document.getElementById("installer-summary"),
  installerAttempts: document.getElementById("installer-attempts"),
  installerMode: document.getElementById("installer-mode"),
  installerLatency: document.getElementById("installer-latency"),
  serviceStatus: document.getElementById("service-status"),
  serviceDetail: document.getElementById("service-detail"),
  serviceEndpoint: document.getElementById("service-endpoint"),
  serviceTimestamp: document.getElementById("service-timestamp"),
  pathStatus: document.getElementById("path-status"),
  pathDetail: document.getElementById("path-detail"),
  supportNote: document.getElementById("support-note"),
  missingDetail: document.getElementById("missing-detail"),
  footerNote: document.getElementById("footer-note"),
  telemetry: document.getElementById("installer-telemetry"),
} as const;

let activeProbeToken = 0;
let destroyed = false;

function formatCheckedAt(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function setStatusBadge(element: HTMLElement | null, status: string, label: string): void {
  if (!element) {
    return;
  }

  element.dataset.status = status;
  element.textContent = label;
}

function setText(element: HTMLElement | null, value: string): void {
  if (element) {
    element.textContent = value;
  }
}

function describePhase(state: InstallerSnapshot): string {
  switch (state.phase) {
    case "ready":
      return "Local service found";
    case "missing":
      return state.retryCount > 0
        ? "Retry complete, no local service answered"
        : "Initial check found no local service";
    case "retrying":
      return `Retrying local discovery, attempt ${state.retryCount + 1}`;
    case "checking":
    default:
      return state.retryCount > 0
        ? `Checking local service again, attempt ${state.retryCount + 1}`
        : "Performing the first local discovery check";
  }
}

function describeLatency(state: InstallerSnapshot): string {
  if (typeof state.latencyMs === "number") {
    return `${state.latencyMs} ms on localhost`;
  }

  if (state.phase === "checking" || state.phase === "retrying") {
    return "Waiting for a local response";
  }

  return "No response time recorded";
}

function describeSupportNote(state: InstallerSnapshot): string {
  if (state.phase === "ready") {
    return "The local endpoint answered. If WhisperLiveKit restarts later, run the check again from this page or copy diagnostics before changing builds.";
  }

  if (state.phase === "missing") {
    return "Start WhisperLiveKit on this machine, then check localhost:8000/asr again. If this failure followed a release update, capture diagnostics before rolling back.";
  }

  return "Discovery only probes localhost:8000/asr. No cloud endpoints are contacted, and diagnostics stays available for local handoff.";
}

function describeFooterNote(state: InstallerSnapshot): string {
  if (state.phase === "ready") {
    return "Ready to continue. Open the popup to start captions, or use diagnostics if you need to compare builds.";
  }

  if (state.phase === "missing") {
    return "The installer stays local while it waits for the ASR service to come online. Keep the current snapshot if you need a rollback trail.";
  }

  return "The installer keeps checking the local ASR endpoint used by the extension. No remote recovery path is involved.";
}

function getPrimaryActionLabel(state: InstallerSnapshot): string {
  if (state.phase === "checking") {
    return "Checking local service";
  }

  if (state.phase === "retrying") {
    return "Retrying discovery";
  }

  if (state.phase === "missing") {
    return "Retry local service";
  }

  if (state.phase === "ready") {
    return "Recheck local service";
  }

  return "Check local service";
}

function emitStateEvent(): void {
  const snapshot = getInstallerState();
  window.dispatchEvent(
    new CustomEvent<InstallerSnapshot>(INSTALLER_STATE_EVENT, {
      detail: snapshot,
    }),
  );
}

function render(): void {
  setStatusBadge(
    elements.installerPhase,
    state.phase === "ready" ? "ready" : state.phase === "missing" ? "missing" : state.phase,
    state.phase === "ready"
      ? "Service ready"
      : state.phase === "missing"
        ? "Missing"
        : state.phase === "retrying"
          ? "Retrying"
          : "Checking",
  );

  setStatusBadge(
    elements.serviceStatus,
    state.phase === "ready" ? "ready" : state.phase === "missing" ? "missing" : state.phase,
    state.phase === "ready"
      ? "Ready"
      : state.phase === "missing"
        ? "Missing"
        : state.phase === "retrying"
          ? "Retrying"
          : "Checking",
  );

  setStatusBadge(
    elements.pathStatus,
    state.phase === "ready" ? "ready" : state.phase === "missing" ? "missing" : "local",
    "Local only",
  );

  if (elements.primaryAction) {
    elements.primaryAction.disabled = state.phase === "checking" || state.phase === "retrying";
    elements.primaryAction.textContent = getPrimaryActionLabel(state);
  }

  setText(elements.installerSummary, state.detail);
  setText(elements.installerAttempts, `${state.retryCount}`);
  setText(elements.installerMode, describePhase(state));
  setText(elements.installerLatency, describeLatency(state));
  setText(elements.serviceDetail, state.detail);
  setText(elements.serviceEndpoint, state.endpoint);
  setText(
    elements.serviceTimestamp,
    state.checkedAt ? `${formatCheckedAt(state.checkedAt)}${typeof state.latencyMs === "number" ? `, ${state.latencyMs} ms` : ""}` : "Not checked yet",
  );

  if (state.phase === "ready") {
    setText(
      elements.pathDetail,
      "The local ASR service is reachable. Open the popup to start captions without leaving the local path, and keep diagnostics nearby if you are validating a release change.",
    );
    setText(elements.supportNote, describeSupportNote(state));
    setText(
      elements.missingDetail,
      "No recovery steps are needed right now. The local endpoint answered the discovery probe.",
    );
    setText(
      elements.footerNote,
      describeFooterNote(state),
    );
  } else if (state.phase === "missing") {
    setText(
      elements.pathDetail,
      "The local ASR service is still missing. Start WhisperLiveKit on this machine, then press Check local service again.",
    );
    setText(elements.supportNote, describeSupportNote(state));
    setText(
      elements.missingDetail,
      "If the endpoint does not answer, confirm that WhisperLiveKit is running on localhost:8000 and that nothing else is bound to the same port. If the issue appeared after an update, copy diagnostics before restoring the previous local build.",
    );
    setText(
      elements.footerNote,
      describeFooterNote(state),
    );
  } else {
    setText(
      elements.pathDetail,
      "The installer is probing localhost now. Keep the service local so the extension stays on-device and the recovery path stays local-only.",
    );
    setText(elements.supportNote, describeSupportNote(state));
    setText(
      elements.missingDetail,
      "If the service is absent, the first check will classify it as missing and keep the flow on this page.",
    );
    setText(
      elements.footerNote,
      describeFooterNote(state),
    );
  }

  setText(
    elements.telemetry,
    state.phase === "ready"
      ? "Local service discovered successfully. Open the popup to continue or diagnostics to capture a local handoff."
      : state.phase === "missing"
        ? "Discovery completed with no reachable local service. Start WhisperLiveKit and try again, or keep diagnostics open for rollback notes."
        : "Probing localhost for a local ASR service. No remote recovery path is involved.",
  );
}

function updateState(nextState: Partial<InstallerSnapshot>): void {
  Object.assign(state, nextState);
  render();
  emitStateEvent();
}

export async function probeLocalService(endpoint: string = LOCAL_ASR_HTTP_URL): Promise<ServiceDiscoveryResult> {
  const localEndpoint = assertLocalAsrHttpUrl(endpoint);
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), discoveryTimeoutMs);

  try {
    await fetch(localEndpoint, {
      method: "GET",
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal,
    });

    return {
      reachable: true,
      checkedAt: Date.now(),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: "The local ASR service responded. The extension can connect to localhost:8000/asr.",
      endpoint: localEndpoint,
    };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";

    return {
      reachable: false,
      checkedAt: Date.now(),
      latencyMs: null,
      detail: timedOut
        ? "The local ASR service did not answer before the timeout. Start WhisperLiveKit locally and check again."
        : "The local ASR service could not be reached. Start WhisperLiveKit locally and check again.",
      endpoint: localEndpoint,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function getInstallerState(): InstallerSnapshot {
  return { ...state };
}

export async function refreshInstallerDiscovery(): Promise<ServiceDiscoveryResult> {
  if (destroyed) {
    return probeLocalService();
  }

  const probeToken = ++activeProbeToken;
  const nextPhase: InstallerPhase = state.retryCount > 0 ? "retrying" : "checking";

  updateState({
    phase: nextPhase,
    detail:
      nextPhase === "retrying"
        ? "Retrying discovery against the local ASR service."
        : "Checking the local ASR service.",
  });

  const result = await probeLocalService();

  if (probeToken !== activeProbeToken) {
    return result;
  }

  updateState({
    phase: result.reachable ? "ready" : "missing",
    endpoint: result.endpoint,
    detail: result.detail,
    checkedAt: result.checkedAt,
    latencyMs: result.latencyMs,
    reachable: result.reachable,
    retryCount: state.retryCount + 1,
  });

  window.dispatchEvent(
    new CustomEvent<ServiceDiscoveryResult>(INSTALLER_CHECK_EVENT, {
      detail: result,
    }),
  );

  return result;
}

export function initInstallerPage(root: Document = document): InstallerController {
  if (root !== document) {
    throw new Error("The installer page must be initialized with the current document.");
  }

  if (!destroyed && elements.serviceEndpoint) {
    setText(elements.serviceEndpoint, LOCAL_ASR_HTTP_URL);
  }

  const onPrimaryAction = (): void => {
    void refreshInstallerDiscovery();
  };

  elements.primaryAction?.addEventListener("click", onPrimaryAction);

  render();
  void refreshInstallerDiscovery();

  return {
    refresh: refreshInstallerDiscovery,
    getState: getInstallerState,
    destroy: () => {
      destroyed = true;
      elements.primaryAction?.removeEventListener("click", onPrimaryAction);
    },
  };
}

declare global {
  interface Window {
    ktalkInstaller?: {
      refresh: () => Promise<ServiceDiscoveryResult>;
      getState: () => InstallerSnapshot;
      probeLocalService: typeof probeLocalService;
    };
  }
}

window.ktalkInstaller = {
  refresh: refreshInstallerDiscovery,
  getState: getInstallerState,
  probeLocalService,
};

export {};
