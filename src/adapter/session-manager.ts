import type { MeetingDetectionSnapshot } from '../content/meeting-detection';
import type { SessionPhase as ProtocolSessionPhase } from '../shared/protocol';

export type SessionPhase = ProtocolSessionPhase;

export interface SessionManagerSnapshot {
  sessionId: string | null;
  meetingId: string | null;
  phase: SessionPhase;
  agentReady: boolean;
  transportReady: boolean;
  reconnectAttempts: number;
  reconnectDelayMs: number | null;
  reconnectBudgetExceeded: boolean;
  startedAt: number | null;
  connectedAt: number | null;
  lastEventAt: number;
  lastReason: string | null;
  detection: MeetingDetectionSnapshot | null;
}

export interface SessionManagerOptions {
  now?: () => number;
  sessionIdFactory?: () => string;
  onChange?: (snapshot: SessionManagerSnapshot) => void;
  reconnectMaxAttempts?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

export interface SessionManager {
  getSnapshot(): SessionManagerSnapshot;
  subscribe(listener: (snapshot: SessionManagerSnapshot) => void): () => void;
  updateDetection(detection: MeetingDetectionSnapshot): SessionManagerSnapshot;
  beginCheckingAgent(reason?: string): SessionManagerSnapshot;
  markAgentReady(reason?: string): SessionManagerSnapshot;
  beginConnecting(reason?: string): SessionManagerSnapshot;
  markTransportReady(reason?: string): SessionManagerSnapshot;
  markListening(reason?: string): SessionManagerSnapshot;
  markReconnecting(reason?: string): SessionManagerSnapshot;
  markUnavailable(reason?: string): SessionManagerSnapshot;
  stop(reason?: string): SessionManagerSnapshot;
  reset(): SessionManagerSnapshot;
}

const DEFAULT_PHASE: SessionPhase = 'idle';
const DEFAULT_RECONNECT_MAX_ATTEMPTS = 5;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 400;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 8000;

function createSessionId(now: () => number): string {
  return `ktalk-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type SessionSnapshot = SessionManagerSnapshot;

function cloneSnapshot(snapshot: SessionManagerSnapshot): SessionManagerSnapshot {
  return {
    ...snapshot,
    detection: snapshot.detection ? { ...snapshot.detection, reasons: [...snapshot.detection.reasons], signals: [...snapshot.detection.signals] } : null,
  };
}

function createInitialSnapshot(now: () => number): SessionManagerSnapshot {
  return {
    sessionId: null,
    meetingId: null,
    phase: DEFAULT_PHASE,
    agentReady: false,
    transportReady: false,
    reconnectAttempts: 0,
    reconnectDelayMs: null,
    reconnectBudgetExceeded: false,
    startedAt: null,
    connectedAt: null,
    lastEventAt: now(),
    lastReason: null,
    detection: null,
  };
}

export function createSessionManager(options: SessionManagerOptions = {}): SessionManager {
  const now = options.now ?? Date.now;
  const createId = options.sessionIdFactory ?? (() => createSessionId(now));
  const reconnectMaxAttempts = options.reconnectMaxAttempts ?? DEFAULT_RECONNECT_MAX_ATTEMPTS;
  const reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
  const listeners = new Set<(snapshot: SessionManagerSnapshot) => void>();
  let snapshot = createInitialSnapshot(now);

  function emit(next: SessionManagerSnapshot): SessionManagerSnapshot {
    snapshot = cloneSnapshot(next);
    options.onChange?.(cloneSnapshot(snapshot));
    for (const listener of listeners) {
      listener(cloneSnapshot(snapshot));
    }
    return cloneSnapshot(snapshot);
  }

  function update(partial: Partial<SessionManagerSnapshot>, reason: string | null = null): SessionManagerSnapshot {
    return emit({
      ...snapshot,
      ...partial,
      lastEventAt: now(),
      lastReason: reason ?? snapshot.lastReason,
    });
  }

  function ensureSessionId(): string {
    if (!snapshot.sessionId) {
      const sessionId = createId();
      snapshot = {
        ...snapshot,
        sessionId,
        startedAt: snapshot.startedAt ?? now(),
      };
    }

    return snapshot.sessionId ?? createId();
  }

  function setPhase(
    phase: SessionPhase,
    reason: string | null = null,
    extra: Partial<SessionManagerSnapshot> = {},
  ): SessionManagerSnapshot {
    return update(
      {
        ...extra,
        phase,
      },
      reason,
    );
  }

  function resetReconnectBudget(): Pick<
    SessionManagerSnapshot,
    "reconnectAttempts" | "reconnectDelayMs" | "reconnectBudgetExceeded"
  > {
    return {
      reconnectAttempts: 0,
      reconnectDelayMs: null,
      reconnectBudgetExceeded: false,
    };
  }

  return {
    getSnapshot() {
      return cloneSnapshot(snapshot);
    },
    subscribe(listener: (snapshot: SessionManagerSnapshot) => void) {
      listeners.add(listener);
      listener(cloneSnapshot(snapshot));
      return () => listeners.delete(listener);
    },
    updateDetection(detection: MeetingDetectionSnapshot) {
      const meetingId = detection.detected ? detection.meetingId ?? detection.surfaceId ?? snapshot.meetingId : snapshot.meetingId;
      const nextPhase = !detection.detected && snapshot.phase === DEFAULT_PHASE ? DEFAULT_PHASE : snapshot.phase;

      return update(
        {
          detection,
          meetingId,
          phase: detection.detected && snapshot.phase === DEFAULT_PHASE ? 'checking-agent' : nextPhase,
          reconnectAttempts: detection.detected ? snapshot.reconnectAttempts : snapshot.reconnectAttempts,
        },
        detection.detected ? 'meeting-detected' : 'meeting-not-detected',
      );
    },
    beginCheckingAgent(reason = 'checking-agent') {
      if (snapshot.phase !== 'idle' && snapshot.phase !== 'finished') {
        return update({}, reason);
      }

      return setPhase('checking-agent', reason, {
        meetingId: snapshot.meetingId,
        sessionId: createId(),
        startedAt: now(),
        connectedAt: null,
        agentReady: false,
        transportReady: false,
        ...resetReconnectBudget(),
      });
    },
    markAgentReady(reason = 'agent-ready') {
      return update(
        {
          agentReady: true,
          phase: snapshot.phase === 'idle' ? 'checking-agent' : snapshot.phase,
        },
        reason,
      );
    },
    beginConnecting(reason = 'connecting') {
      if (!snapshot.meetingId) {
        return update({}, 'no-meeting-id');
      }

      const nextSessionId =
        snapshot.phase === 'idle' || snapshot.phase === 'finished' || !snapshot.sessionId
          ? createId()
          : snapshot.sessionId;

      return setPhase('connecting', reason, {
        sessionId: nextSessionId,
        startedAt: snapshot.phase === 'idle' || snapshot.phase === 'finished' ? now() : snapshot.startedAt ?? now(),
        agentReady: true,
        transportReady: false,
        connectedAt: null,
        ...resetReconnectBudget(),
      });
    },
    markTransportReady(reason = 'transport-ready') {
      if (!snapshot.sessionId) {
        ensureSessionId();
      }

      return update(
        {
          transportReady: true,
          phase: snapshot.phase === 'idle' ? 'connecting' : snapshot.phase,
        },
        reason,
      );
    },
    markListening(reason = 'listening') {
      if (!snapshot.sessionId) {
        ensureSessionId();
      }

      return setPhase('listening', reason, {
        transportReady: true,
        agentReady: true,
        reconnectAttempts: 0,
        reconnectDelayMs: null,
        reconnectBudgetExceeded: false,
        connectedAt: snapshot.connectedAt ?? now(),
        startedAt: snapshot.startedAt ?? now(),
      });
    },
    markReconnecting(reason = 'reconnecting') {
      if (!snapshot.sessionId) {
        ensureSessionId();
      }

      const nextReconnectAttempts = snapshot.reconnectAttempts + 1;
      const nextReconnectDelayMs = Math.min(
        reconnectBaseDelayMs * (2 ** Math.max(0, nextReconnectAttempts - 1)),
        reconnectMaxDelayMs,
      );
      const budgetExceeded = nextReconnectAttempts > reconnectMaxAttempts;

      if (budgetExceeded) {
        return setPhase('finished', 'reconnect-budget-exhausted', {
          reconnectAttempts: nextReconnectAttempts,
          reconnectDelayMs: null,
          reconnectBudgetExceeded: true,
          transportReady: false,
          agentReady: false,
          connectedAt: null,
        });
      }

      return setPhase('reconnecting', reason, {
        reconnectAttempts: nextReconnectAttempts,
        reconnectDelayMs: nextReconnectDelayMs,
        reconnectBudgetExceeded: false,
        transportReady: false,
      });
    },
    markUnavailable(reason = 'service-unavailable') {
      return setPhase('finished', reason, {
        agentReady: false,
        transportReady: false,
        connectedAt: null,
        reconnectDelayMs: null,
        reconnectBudgetExceeded: snapshot.reconnectBudgetExceeded,
      });
    },
    stop(reason = 'finished') {
      if (!snapshot.sessionId && !snapshot.meetingId) {
        return update({}, reason);
      }

      return setPhase('finished', reason, {
        agentReady: false,
        transportReady: false,
        reconnectDelayMs: null,
        connectedAt: null,
      });
    },
    reset() {
      snapshot = createInitialSnapshot(now);
      return emit(snapshot);
    },
  };
}
