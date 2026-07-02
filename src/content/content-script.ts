import { detectMeetingSurface, type MeetingDetectionSnapshot } from './meeting-detection';
import { createSessionManager, type SessionManager, type SessionSnapshot } from '../adapter/session-manager';

export interface ContentScriptSnapshot {
  session: SessionSnapshot;
  detection: MeetingDetectionSnapshot;
}

export interface ContentScriptController {
  getSnapshot(): ContentScriptSnapshot;
  refreshDetection(): MeetingDetectionSnapshot;
  beginSession(): SessionSnapshot;
  stop(reason?: string): SessionSnapshot;
  markAgentReady(reason?: string): SessionSnapshot;
  beginConnecting(reason?: string): SessionSnapshot;
  markListening(reason?: string): SessionSnapshot;
  markReconnecting(reason?: string): SessionSnapshot;
  markUnavailable(reason?: string): SessionSnapshot;
  reset(): SessionSnapshot;
  subscribe(listener: (snapshot: ContentScriptSnapshot) => void): () => void;
  destroy(): void;
}

export interface ContentScriptOptions {
  root?: Document | Element | ShadowRoot;
  pollIntervalMs?: number;
  lossGraceMs?: number;
  now?: () => number;
  sessionManager?: SessionManager;
  autoStart?: boolean;
}

export interface ContentScriptMessage {
  type:
    | 'ktalk.content.getSnapshot'
    | 'ktalk.content.refreshDetection'
    | 'ktalk.content.beginSession'
    | 'ktalk.content.stop'
    | 'ktalk.content.markAgentReady'
    | 'ktalk.content.beginConnecting'
    | 'ktalk.content.markListening'
    | 'ktalk.content.markReconnecting'
    | 'ktalk.content.markUnavailable'
    | 'ktalk.content.reset';
  reason?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_LOSS_GRACE_MS = 1500;

type ChromeLike = {
  runtime?: {
    onMessage?: {
      addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void): void;
      removeListener(listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void): void;
    };
    sendMessage?(message: unknown, callback?: (response: unknown) => void): void;
  };
};

function isContentScriptMessage(message: unknown): message is ContentScriptMessage {
  return message !== null && typeof message === 'object' && 'type' in message;
}

function cloneDetection(detection: MeetingDetectionSnapshot): MeetingDetectionSnapshot {
  return {
    ...detection,
    reasons: [...detection.reasons],
    signals: [...detection.signals],
  };
}

function notifyBackgroundSnapshot(snapshot: ContentScriptSnapshot): void {
  const runtime = (globalThis as typeof globalThis & { chrome?: ChromeLike }).chrome?.runtime;
  if (!runtime?.sendMessage) {
    return;
  }

  try {
    runtime.sendMessage({
      type: 'ktalk.content.snapshot',
      snapshot,
    });
  } catch {
    // Background messaging is best-effort in the content context.
  }
}

export function createContentScriptController(options: ContentScriptOptions = {}): ContentScriptController {
  const root = options.root ?? document;
  const now = options.now ?? Date.now;
  const sessionManager = options.sessionManager ?? createSessionManager({ now });
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const lossGraceMs = options.lossGraceMs ?? DEFAULT_LOSS_GRACE_MS;

  let detection = detectMeetingSurface({ root, now });
  let disposed = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let lossTimer: ReturnType<typeof setTimeout> | null = null;
  let mutationObserver: MutationObserver | null = null;
  const listeners = new Set<(snapshot: ContentScriptSnapshot) => void>();

  function currentSnapshot(): ContentScriptSnapshot {
    return {
      session: sessionManager.getSnapshot(),
      detection: cloneDetection(detection),
    };
  }

  function emit(): void {
    const snapshot = currentSnapshot();
    notifyBackgroundSnapshot(snapshot);
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  function clearLossTimer(): void {
    if (lossTimer) {
      clearTimeout(lossTimer);
      lossTimer = null;
    }
  }

  function schedulePoll(): void {
    if (disposed) {
      return;
    }

    if (pollTimer) {
      return;
    }

    pollTimer = setTimeout(() => {
      pollTimer = null;
      refreshDetection();
      schedulePoll();
    }, pollIntervalMs);
  }

  function handleLostMeeting(): void {
    if (lossTimer) {
      return;
    }

    lossTimer = setTimeout(() => {
      lossTimer = null;
      const latest = detectMeetingSurface({ root, now });
      detection = latest;
      sessionManager.updateDetection(latest);
      if (!latest.detected) {
        sessionManager.stop('meeting-surface-lost');
        emit();
      }
    }, lossGraceMs);
  }

  function refreshDetection(): MeetingDetectionSnapshot {
    if (disposed) {
      return detection;
    }

    const next = detectMeetingSurface({ root, now });
    detection = next;
    sessionManager.updateDetection(next);

    if (next.detected) {
      clearLossTimer();
    } else if (sessionManager.getSnapshot().phase === 'listening' || sessionManager.getSnapshot().phase === 'connecting' || sessionManager.getSnapshot().phase === 'reconnecting') {
      handleLostMeeting();
    }

    emit();
    return cloneDetection(detection);
  }

  if (root) {
    mutationObserver = new MutationObserver(() => {
      refreshDetection();
    });
    mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  }

  schedulePoll();
  refreshDetection();

  const controller: ContentScriptController = {
    getSnapshot() {
      return currentSnapshot();
    },
    refreshDetection() {
      return refreshDetection();
    },
    beginSession() {
      if (!detection.detected) {
        refreshDetection();
      }

      sessionManager.beginCheckingAgent('session-requested');
      if (options.autoStart !== false) {
        sessionManager.beginConnecting('auto-connect');
      }

      emit();
      return sessionManager.getSnapshot();
    },
    stop(reason = 'stop-requested') {
      clearLossTimer();
      const snapshot = sessionManager.stop(reason);
      emit();
      return snapshot;
    },
    markAgentReady(reason = 'agent-ready') {
      const snapshot = sessionManager.markAgentReady(reason);
      emit();
      return snapshot;
    },
    beginConnecting(reason = 'connecting') {
      const snapshot = sessionManager.beginConnecting(reason);
      emit();
      return snapshot;
    },
    markListening(reason = 'listening') {
      const snapshot = sessionManager.markListening(reason);
      emit();
      return snapshot;
    },
    markReconnecting(reason = 'reconnecting') {
      const snapshot = sessionManager.markReconnecting(reason);
      emit();
      return snapshot;
    },
    markUnavailable(reason = 'service-unavailable') {
      const snapshot = sessionManager.markUnavailable(reason);
      emit();
      return snapshot;
    },
    reset() {
      clearLossTimer();
      const snapshot = sessionManager.reset();
      detection = detectMeetingSurface({ root, now });
      emit();
      return snapshot;
    },
    subscribe(listener: (snapshot: ContentScriptSnapshot) => void) {
      listeners.add(listener);
      listener(currentSnapshot());
      return () => listeners.delete(listener);
    },
    destroy() {
      disposed = true;
      clearLossTimer();
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      mutationObserver?.disconnect();
      mutationObserver = null;
      listeners.clear();
    },
  };

  return controller;
}

function attachRuntimeBridge(controller: ContentScriptController): void {
  const runtime = (globalThis as typeof globalThis & { chrome?: ChromeLike }).chrome?.runtime;
  if (!runtime?.onMessage?.addListener) {
    return;
  }

  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isContentScriptMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'ktalk.content.getSnapshot':
        sendResponse(controller.getSnapshot());
        return;
      case 'ktalk.content.refreshDetection':
        sendResponse(controller.refreshDetection());
        return;
      case 'ktalk.content.beginSession':
        sendResponse(controller.beginSession());
        return;
      case 'ktalk.content.stop':
        sendResponse(controller.stop(message.reason));
        return;
      case 'ktalk.content.markAgentReady':
        sendResponse(controller.markAgentReady(message.reason));
        return;
      case 'ktalk.content.beginConnecting':
        sendResponse(controller.beginConnecting(message.reason));
        return;
      case 'ktalk.content.markListening':
        sendResponse(controller.markListening(message.reason));
        return;
      case 'ktalk.content.markReconnecting':
        sendResponse(controller.markReconnecting(message.reason));
        return;
      case 'ktalk.content.markUnavailable':
        sendResponse(controller.markUnavailable(message.reason));
        return;
      case 'ktalk.content.reset':
        sendResponse(controller.reset());
        return;
      default:
        return;
    }
  });
}

export function bootstrapContentScript(options: ContentScriptOptions = {}): ContentScriptController {
  const controller = createContentScriptController(options);
  attachRuntimeBridge(controller);
  return controller;
}

export const contentScript: ContentScriptController | null =
  typeof document !== 'undefined' && typeof MutationObserver !== 'undefined'
    ? bootstrapContentScript()
    : null;
