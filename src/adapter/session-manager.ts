import type { MeetingDetectionSnapshot } from '../content/meeting-detection';

export type SessionPhase =
  | 'idle'
  | 'checking-agent'
  | 'connecting'
  | 'listening'
  | 'reconnecting'
  | 'finished';

export interface SessionSnapshot {
  sessionId: string | null;
  meetingId: string | null;
  phase: SessionPhase;
  agentReady: boolean;
  transportReady: boolean;
  reconnectAttempts: number;
  startedAt: number | null;
  connectedAt: number | null;
  lastEventAt: number;
  lastReason: string | null;
  detection: MeetingDetectionSnapshot | null;
}

export interface SessionManagerOptions {
  now?: () => number;
  sessionIdFactory?: () => string;
  onChange?: (snapshot: SessionSnapshot) => void;
}

export interface SessionManager {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void;
  updateDetection(detection: MeetingDetectionSnapshot): SessionSnapshot;
  beginCheckingAgent(reason?: string): SessionSnapshot;
  markAgentReady(reason?: string): SessionSnapshot;
  beginConnecting(reason?: string): SessionSnapshot;
  markTransportReady(reason?: string): SessionSnapshot;
  markListening(reason?: string): SessionSnapshot;
  markReconnecting(reason?: string): SessionSnapshot;
  markUnavailable(reason?: string): SessionSnapshot;
  stop(reason?: string): SessionSnapshot;
  reset(): SessionSnapshot;
}

const DEFAULT_PHASE: SessionPhase = 'idle';

function createSessionId(now: () => number): string {
  return `ktalk-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return {
    ...snapshot,
    detection: snapshot.detection ? { ...snapshot.detection, reasons: [...snapshot.detection.reasons], signals: [...snapshot.detection.signals] } : null,
  };
}

function createInitialSnapshot(now: () => number): SessionSnapshot {
  return {
    sessionId: null,
    meetingId: null,
    phase: DEFAULT_PHASE,
    agentReady: false,
    transportReady: false,
    reconnectAttempts: 0,
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
  const listeners = new Set<(snapshot: SessionSnapshot) => void>();
  let snapshot = createInitialSnapshot(now);

  function emit(next: SessionSnapshot): SessionSnapshot {
    snapshot = cloneSnapshot(next);
    options.onChange?.(cloneSnapshot(snapshot));
    for (const listener of listeners) {
      listener(cloneSnapshot(snapshot));
    }
    return cloneSnapshot(snapshot);
  }

  function update(partial: Partial<SessionSnapshot>, reason: string | null = null): SessionSnapshot {
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

  function setPhase(phase: SessionPhase, reason: string | null = null, extra: Partial<SessionSnapshot> = {}): SessionSnapshot {
    return update(
      {
        ...extra,
        phase,
      },
      reason,
    );
  }

  return {
    getSnapshot() {
      return cloneSnapshot(snapshot);
    },
    subscribe(listener: (snapshot: SessionSnapshot) => void) {
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
        sessionId: snapshot.sessionId,
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

      ensureSessionId();
      return setPhase('connecting', reason, {
        sessionId: snapshot.sessionId,
        startedAt: snapshot.startedAt ?? now(),
        agentReady: true,
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
        connectedAt: snapshot.connectedAt ?? now(),
        startedAt: snapshot.startedAt ?? now(),
      });
    },
    markReconnecting(reason = 'reconnecting') {
      if (!snapshot.sessionId) {
        ensureSessionId();
      }

      return setPhase('reconnecting', reason, {
        reconnectAttempts: snapshot.reconnectAttempts + 1,
        transportReady: false,
      });
    },
    markUnavailable(reason = 'service-unavailable') {
      return setPhase('finished', reason, {
        transportReady: false,
      });
    },
    stop(reason = 'finished') {
      if (!snapshot.sessionId && !snapshot.meetingId) {
        return update({}, reason);
      }

      return setPhase('finished', reason, {
        transportReady: false,
      });
    },
    reset() {
      snapshot = createInitialSnapshot(now);
      return emit(snapshot);
    },
  };
}
