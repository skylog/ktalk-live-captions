import { LOCAL_ASR_HTTP_URL } from "../shared/protocol";

type ServiceCheckState = "checking" | "ready" | "missing" | "failed";
type PermissionCheckState = "ready" | "warning" | "unsupported";
type SupportCheckState = "ready" | "warning" | "unsupported";

type ServiceCheckResult = {
  state: ServiceCheckState;
  detail: string;
  checkedAt: number;
  latencyMs: number | null;
};

type PermissionCheckResult = {
  state: PermissionCheckState;
  detail: string;
  missingPermissions: ReadonlyArray<string>;
  missingOrigins: ReadonlyArray<string>;
};

type SupportCheckResult = {
  state: SupportCheckState;
  detail: string;
  recovery: string;
};

const serviceStatusEl = document.getElementById("service-status");
const serviceDetailEl = document.getElementById("service-detail");
const serviceEndpointEl = document.getElementById("service-endpoint");
const serviceTimestampEl = document.getElementById("service-timestamp");
const supportStatusEl = document.getElementById("support-status");
const supportDetailEl = document.getElementById("support-detail");
const supportListEl = document.getElementById("support-list");
const permissionStatusEl = document.getElementById("permission-status");
const permissionDetailEl = document.getElementById("permission-detail");
const permissionListEl = document.getElementById("permission-list");
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

function replaceListItems(element: HTMLElement | null, items: ReadonlyArray<string>): void {
  if (!element) {
    return;
  }

  element.replaceChildren();

  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    element.append(li);
  }
}

function describeServiceOutcome(error: unknown, timedOut: boolean): ServiceCheckResult {
  if (timedOut) {
    return {
      state: "missing",
      detail:
        "The local ASR service did not respond before the timeout. Start WhisperLiveKit on port 8000, then check again.",
      checkedAt: Date.now(),
      latencyMs: null,
    };
  }

  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : "The local ASR service could not be reached.";

  return {
    state: "failed",
    detail:
      `${message} Start WhisperLiveKit locally, confirm localhost:8000 is free, then run the check again.`,
    checkedAt: Date.now(),
    latencyMs: null,
  };
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
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return describeServiceOutcome(error, timedOut);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function checkBrowserSupport(): Promise<SupportCheckResult> {
  if (
    typeof chrome === "undefined" ||
    !chrome.runtime ||
    !chrome.permissions ||
    !chrome.tabs ||
    !chrome.tabCapture
  ) {
    return {
      state: "unsupported",
      detail:
        "This browser does not expose the runtime, permissions, tabs, and tabCapture APIs that live captions rely on.",
      recovery:
        "Use a Chromium-based browser with extension API support, then reopen this page from the extension.",
    };
  }

  if (!window.isSecureContext) {
    return {
      state: "warning",
      detail:
        "This page is not running in a secure extension context, so browser capability checks may be incomplete.",
      recovery:
        "Reopen the page from the installed extension, then run the readiness check again.",
    };
  }

  return {
    state: "ready",
    detail:
      "The browser exposes the extension APIs needed for local capture, permission prompts, and session sync.",
    recovery:
      "No browser change is required. Continue to the service and permission checks below.",
  };
}

async function checkPermissions(): Promise<PermissionCheckResult> {
  if (typeof chrome === "undefined" || !chrome.permissions) {
    return {
      state: "unsupported",
      detail:
        "Chrome permissions metadata is unavailable in this browser context.",
      missingPermissions: [...requiredPermissions],
      missingOrigins: [...requiredHosts],
    };
  }

  const permissionsApi = chrome.permissions;

  const [permissionsGranted, hostGranted] = await Promise.all([
    new Promise<boolean>((resolve) => {
      permissionsApi.contains({ permissions: [...requiredPermissions] }, resolve);
    }),
    new Promise<boolean>((resolve) => {
      permissionsApi.contains({ origins: [...requiredHosts] }, resolve);
    }),
  ]);

  const missingPermissions = permissionsGranted ? [] : [...requiredPermissions];
  const missingOrigins = hostGranted ? [] : [...requiredHosts];

  if (missingPermissions.length === 0 && missingOrigins.length === 0) {
    return {
      state: "ready",
      detail:
        "Required browser permissions and localhost host access are already present in the manifest.",
      missingPermissions,
      missingOrigins,
    };
  }

  const parts = [
    missingPermissions.length > 0 ? `missing ${missingPermissions.join(", ")}` : null,
    missingOrigins.length > 0 ? `missing host access for ${missingOrigins.join(", ")}` : null,
  ].filter(Boolean);

  return {
    state: "warning",
    detail:
      `Capture permission check failed: ${parts.join("; ")}. Reload the extension and grant the missing access when prompted.`,
    missingPermissions,
    missingOrigins,
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

function renderBrowserSupport(result: SupportCheckResult): void {
  setStatusBadge(
    supportStatusEl,
    result.state,
    result.state === "ready"
      ? "Supported"
      : result.state === "warning"
        ? "Review"
        : "Unsupported",
  );

  if (supportDetailEl) {
    supportDetailEl.textContent = `${result.detail} ${result.recovery}`;
  }

  replaceListItems(
    supportListEl,
    result.state === "ready"
      ? [
          "The browser exposes the extension APIs the local caption flow needs.",
          "No browser change is required right now.",
          "Open the popup after the service check passes.",
        ]
      : result.state === "unsupported"
        ? [
            "Use a Chromium browser with extension API support.",
            "Open this page from the installed extension, not a normal tab.",
            "Then run the readiness check again.",
          ]
        : [
            "Reopen the page from the installed extension.",
            "Run the readiness check again after the browser context changes.",
            "Keep this page in the secure extension context.",
          ],
  );
}

function renderPermissions(result: PermissionCheckResult): void {
  setStatusBadge(
    permissionStatusEl,
    result.state,
    result.state === "ready"
      ? "Ready"
      : result.state === "warning"
        ? "Review"
        : "Unsupported",
  );

  if (permissionDetailEl) {
    permissionDetailEl.textContent = result.detail;
  }

  replaceListItems(
    permissionListEl,
    result.state === "ready"
      ? [
          "activeTab, tabs, storage, and tabCapture are already available.",
          `Host access includes ${requiredHosts.join(" and ")}.`,
          "No permission recovery steps are needed right now.",
        ]
      : [
          "Grant activeTab, tabs, storage, and tabCapture when the extension prompts again.",
          `Allow host access for ${requiredHosts.join(" and ")}.`,
          "Reload the extension, accept the prompt, and check again.",
        ],
  );
}

function updateOverallStatus(
  serviceResult: ServiceCheckResult,
  supportResult: SupportCheckResult,
  permissionResult: PermissionCheckResult,
): void {
  if (!overallStatusEl) {
    return;
  }

  if (supportResult.state === "unsupported") {
    overallStatusEl.textContent =
      "This browser cannot run the local caption flow. Use a Chromium-based browser with extension support, then check again.";
    return;
  }

  if (serviceResult.state === "ready" && permissionResult.state === "ready" && supportResult.state === "ready") {
    overallStatusEl.textContent = "Local setup is ready. Open the popup to start captions.";
    return;
  }

  if (serviceResult.state === "missing" || serviceResult.state === "failed") {
    overallStatusEl.textContent =
      "Start WhisperLiveKit on localhost:8000, then check the service again.";
    return;
  }

  if (permissionResult.state !== "ready") {
    overallStatusEl.textContent =
      "Reload the extension, grant the missing permissions, then check again.";
    return;
  }

  overallStatusEl.textContent =
    "Review the browser support guidance, then run the readiness check again.";
}

async function runChecks(): Promise<void> {
  if (overallStatusEl) {
    overallStatusEl.textContent = "Checking local service, browser support, and permissions.";
  }

  setStatusBadge(serviceStatusEl, "checking", "Checking");
  setStatusBadge(supportStatusEl, "checking", "Checking");

  const [serviceResult, supportResult, permissionResult] = await Promise.all([
    checkService(),
    checkBrowserSupport(),
    checkPermissions(),
  ]);

  renderService(serviceResult);
  renderBrowserSupport(supportResult);
  renderPermissions(permissionResult);
  updateOverallStatus(serviceResult, supportResult, permissionResult);

  if (manifestNoteEl) {
    if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
      const manifest = chrome.runtime.getManifest();
      const optionsUi = manifest.options_ui?.page ?? "src/onboarding/onboarding.html";
      manifestNoteEl.textContent = `Reopen this page from the extension options entry at ${optionsUi} if you need to rerun setup or compare a rollback locally.`;
    } else {
      manifestNoteEl.textContent =
        "Reopen this page from the extension after the browser support issue is resolved, then compare diagnostics before changing builds.";
    }
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
      checkBrowserSupport: () => Promise<SupportCheckResult>;
    };
  }
}

window.ktalkOnboarding = {
  refresh: runChecks,
  checkService,
  checkPermissions,
  checkBrowserSupport,
};

export {};
