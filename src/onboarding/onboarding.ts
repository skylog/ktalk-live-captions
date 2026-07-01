import { LOCAL_ASR_HTTP_URL } from "../shared/protocol";

type ServiceCheckState = "checking" | "ready" | "missing" | "failed";
type PermissionCheckState = "ready" | "warning";

type ServiceCheckResult = {
  state: ServiceCheckState;
  detail: string;
  checkedAt: number;
  latencyMs: number | null;
};

type PermissionCheckResult = {
  state: PermissionCheckState;
  detail: string;
};

const serviceStatusEl = document.getElementById("service-status");
const serviceDetailEl = document.getElementById("service-detail");
const serviceEndpointEl = document.getElementById("service-endpoint");
const serviceTimestampEl = document.getElementById("service-timestamp");
const permissionStatusEl = document.getElementById("permission-status");
const permissionDetailEl = document.getElementById("permission-detail");
const overallStatusEl = document.getElementById("overall-status");
const manifestNoteEl = document.getElementById("manifest-note");
const recheckButton = document.getElementById("recheck-service");

const requiredPermissions = ["activeTab", "tabs", "storage", "tabCapture"] as const;
const requiredHosts = ["http://localhost:8000/*", "ws://localhost:8000/*"] as const;

function setStatusBadge(
  element: HTMLElement | null,
  state: string,
  label: string,
): void {
  if (!element) {
    return;
  }

  element.dataset.status = state;
  element.textContent = label;
}

function formatCheckedAt(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

async function checkService(): Promise<ServiceCheckResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1800);

  try {
    await fetch(LOCAL_ASR_HTTP_URL, {
      method: "GET",
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal,
    });

    return {
      state: "ready",
      detail:
        "The local ASR endpoint responded. Captions can connect to localhost:8000/asr.",
      checkedAt: Date.now(),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError"
      ? "The service did not respond before the timeout."
      : "The local ASR service could not be reached.";

    return {
      state: error instanceof DOMException && error.name === "AbortError" ? "missing" : "failed",
      detail:
        `${reason} Start WhisperLiveKit locally, then run the check again.`,
      checkedAt: Date.now(),
      latencyMs: null,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function checkPermissions(): Promise<PermissionCheckResult> {
  const permissionsApi = chrome.permissions;
  if (!permissionsApi) {
    return {
      state: "warning",
      detail:
        "Chrome permissions metadata is unavailable, but the extension is still local-only.",
    };
  }

  const [permissionsGranted, hostGranted] = await Promise.all([
    new Promise<boolean>((resolve) => {
      permissionsApi.contains({ permissions: [...requiredPermissions] }, resolve);
    }),
    new Promise<boolean>((resolve) => {
      permissionsApi.contains({ origins: [...requiredHosts] }, resolve);
    }),
  ]);

  if (permissionsGranted && hostGranted) {
    return {
      state: "ready",
      detail:
        "Required browser permissions and localhost access are already present in the manifest.",
    };
  }

  return {
    state: "warning",
    detail:
      "One or more required permissions were not confirmed. Reload the extension and verify that the manifest permissions are enabled.",
  };
}

function renderService(result: ServiceCheckResult): void {
  setStatusBadge(
    serviceStatusEl,
    result.state,
    result.state === "ready"
      ? "Ready"
      : result.state === "checking"
        ? "Checking"
        : result.state === "missing"
          ? "Missing"
          : "Blocked",
  );

  if (serviceDetailEl) {
    serviceDetailEl.textContent = result.detail;
  }

  if (serviceTimestampEl) {
    serviceTimestampEl.textContent = `${formatCheckedAt(result.checkedAt)}${typeof result.latencyMs === "number" ? `, ${result.latencyMs} ms` : ""}`;
  }
}

function renderPermissions(result: PermissionCheckResult): void {
  setStatusBadge(
    permissionStatusEl,
    result.state === "ready" ? "ready" : "missing",
    result.state === "ready" ? "Ready" : "Review",
  );

  if (permissionDetailEl) {
    permissionDetailEl.textContent = result.detail;
  }
}

async function runChecks(): Promise<void> {
  if (overallStatusEl) {
    overallStatusEl.textContent = "Checking local service and permissions.";
  }

  setStatusBadge(serviceStatusEl, "checking", "Checking");

  const [serviceResult, permissionResult] = await Promise.all([
    checkService(),
    checkPermissions(),
  ]);

  renderService(serviceResult);
  renderPermissions(permissionResult);

  if (manifestNoteEl) {
    const manifest = chrome.runtime.getManifest();
    const optionsUi = manifest.options_ui?.page ?? "src/onboarding/onboarding.html";
    manifestNoteEl.textContent = `Reopen this onboarding later from the extension options page at ${optionsUi}.`;
  }

  if (overallStatusEl) {
    overallStatusEl.textContent =
      serviceResult.state === "ready" && permissionResult.state === "ready"
        ? "Local setup is ready."
        : "Review the service and permission guidance before starting captions.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (serviceEndpointEl) {
    serviceEndpointEl.textContent = LOCAL_ASR_HTTP_URL;
  }

  void runChecks();
});

recheckButton?.addEventListener("click", () => {
  void runChecks();
});

declare global {
  interface Window {
    ktalkOnboarding?: {
      refresh: () => Promise<void>;
      checkService: () => Promise<ServiceCheckResult>;
      checkPermissions: () => Promise<PermissionCheckResult>;
    };
  }
}

window.ktalkOnboarding = {
  refresh: runChecks,
  checkService,
  checkPermissions,
};

export {};
