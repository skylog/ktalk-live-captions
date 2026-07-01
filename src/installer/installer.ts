import { LOCAL_ASR_HTTP_URL } from "../shared/protocol";

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
  detail: "Waiting for the first discovery pass.",
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
  serviceStatus: document.getElementById("service-status"),
  serviceDetail: document.getElementById("service-detail"),
  serviceEndpoint: document.getElementById("service-endpoint"),
  serviceTimestamp: document.getElementById("service-timestamp"),
  pathStatus: document.getElementById("path-status"),
  pathDetail: document.getElementById("path-detail"),
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
    elements.primaryAction.textContent =
      state.phase === "checking"
        ? "Checking local service"
        : state.phase === "retrying"
          ? "Retrying discovery"
          : "Check local service";
  }

  setText(elements.installerSummary, state.detail);
  setText(elements.serviceDetail, state.detail);
  setText(elements.serviceEndpoint, state.endpoint);
  setText(
    elements.serviceTimestamp,
    state.checkedAt ? `${formatCheckedAt(state.checkedAt)}${typeof state.latencyMs === "number" ? `, ${state.latencyMs} ms` : ""}` : "Not checked yet",
  );

  if (state.phase === "ready") {
    setText(
      elements.pathDetail,
      "The local ASR service is reachable. The app can continue without any cloud dependency.",
    );
    setText(
      elements.missingDetail,
      "No recovery steps are needed right now. The local endpoint answered the discovery probe.",
    );
    setText(
      elements.footerNote,
      "The installer has confirmed the local ASR endpoint and can be opened again later if the service changes.",
    );
  } else if (state.phase === "missing") {
    setText(
      elements.pathDetail,
      "The local ASR service is still missing. Start WhisperLiveKit on this machine, then run discovery again.",
    );
    setText(
      elements.missingDetail,
      "If the endpoint does not answer, confirm that WhisperLiveKit is running on localhost:8000 and that nothing else is bound to the same port.",
    );
    setText(
      elements.footerNote,
      "Discovery stays local. Nothing is uploaded while the installer checks the endpoint.",
    );
  } else {
    setText(
      elements.pathDetail,
      "The installer is probing localhost now. Keep the service local so the extension stays on-device.",
    );
    setText(
      elements.missingDetail,
      "If the service is absent, the first check will classify it as missing and keep the flow on this page.",
    );
    setText(
      elements.footerNote,
      "The installer only probes the localhost endpoint used by the extension.",
    );
  }

  setText(
    elements.telemetry,
    state.phase === "ready"
      ? "Local service discovered successfully."
      : state.phase === "missing"
        ? "Discovery completed with no reachable local service."
        : "Probing localhost for a local ASR service.",
  );
}

function updateState(nextState: Partial<InstallerSnapshot>): void {
  Object.assign(state, nextState);
  render();
  emitStateEvent();
}

export async function probeLocalService(endpoint: string = LOCAL_ASR_HTTP_URL): Promise<ServiceDiscoveryResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), discoveryTimeoutMs);

  try {
    await fetch(endpoint, {
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
      endpoint,
    };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";

    return {
      reachable: false,
      checkedAt: Date.now(),
      latencyMs: null,
      detail: timedOut
        ? "The local ASR service did not answer before the timeout. Start WhisperLiveKit locally and retry discovery."
        : "The local ASR service could not be reached. Start WhisperLiveKit locally and retry discovery.",
      endpoint,
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
