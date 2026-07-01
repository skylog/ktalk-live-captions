import type { SessionSnapshot, SessionState, TranscriptSegment } from "../shared/protocol";

export const SESSION_HISTORY_KEY = "ktalk-live-captions.session-history.v1" as const;

interface ChromeStorageArea {
  get(
    keys: string | string[] | Record<string, unknown> | null,
    callback: (items: Record<string, unknown>) => void,
  ): void;
  set(items: Record<string, unknown>, callback?: () => void): void;
}

interface ChromeExtensionAPI {
  storage: {
    local: ChromeStorageArea;
  };
}

interface SessionHistoryState {
  version: 1;
  updatedAt: number;
  sessions: SessionHistoryRecord[];
}

export interface SessionHistoryRecord {
  sessionId: string;
  meetingId: string;
  startedAt: number | null;
  updatedAt: number | null;
  endedAt: number | null;
  phase: SessionState["phase"];
  transport: SessionState["transport"];
  source: SessionState["source"];
  segmentCount: number;
  transcriptUpdatedAt: number | null;
  currentPartialText: string;
  lastFinalText: string;
  preview: string;
  transcript: TranscriptSegment[];
}

export interface SessionHistoryOptions {
  maxSessions?: number;
  maxAgeDays?: number;
  clock?: () => number;
}

export interface SessionHistoryLookupOptions {
  limit?: number;
}

export interface SessionHistorySnapshot {
  version: 1;
  updatedAt: number;
  sessions: SessionHistoryRecord[];
}

type StoreAdapter = {
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, value: T): Promise<void>;
};

function now(): number {
  return Date.now();
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

function cloneHistoryRecord(record: SessionHistoryRecord): SessionHistoryRecord {
  return {
    sessionId: record.sessionId,
    meetingId: record.meetingId,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    endedAt: record.endedAt,
    phase: record.phase,
    transport: record.transport,
    source: record.source,
    segmentCount: record.segmentCount,
    transcriptUpdatedAt: record.transcriptUpdatedAt,
    currentPartialText: record.currentPartialText,
    lastFinalText: record.lastFinalText,
    preview: record.preview,
    transcript: record.transcript.map(cloneTranscriptSegment),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getChromeStorageArea(): ChromeStorageArea | null {
  const chromeApi = globalThis as typeof globalThis & { chrome?: ChromeExtensionAPI };
  return chromeApi.chrome?.storage.local ?? null;
}

function createStorageAdapter(): StoreAdapter {
  const area = getChromeStorageArea();
  const memory = new Map<string, unknown>();

  return {
    async read<T>(key: string): Promise<T | null> {
      if (!area) {
        return (memory.get(key) as T | undefined) ?? null;
      }

      return new Promise((resolve, reject) => {
        area.get(key, (items) => {
          const runtime = (globalThis as typeof globalThis & {
            chrome?: { runtime?: { lastError?: { message?: string } } };
          }).chrome?.runtime;

          if (runtime?.lastError) {
            reject(new Error(runtime.lastError.message ?? "Storage read failed"));
            return;
          }

          const value = items[key];
          resolve((value as T | undefined) ?? null);
        });
      });
    },
    async write<T>(key: string, value: T): Promise<void> {
      if (!area) {
        memory.set(key, value as unknown);
        return;
      }

      return new Promise((resolve, reject) => {
        area.set({ [key]: value as unknown }, () => {
          const runtime = (globalThis as typeof globalThis & {
            chrome?: { runtime?: { lastError?: { message?: string } } };
          }).chrome?.runtime;

          if (runtime?.lastError) {
            reject(new Error(runtime.lastError.message ?? "Storage write failed"));
            return;
          }

          resolve();
        });
      });
    },
  };
}

function sortByRecency(records: SessionHistoryRecord[]): SessionHistoryRecord[] {
  return [...records].sort((a, b) => {
    const left = a.updatedAt ?? a.endedAt ?? a.startedAt ?? 0;
    const right = b.updatedAt ?? b.endedAt ?? b.startedAt ?? 0;
    return right - left;
  });
}

function normalizeState(state: unknown): SessionHistoryState {
  if (!isRecord(state) || state.version !== 1 || !Array.isArray(state.sessions)) {
    return {
      version: 1,
      updatedAt: now(),
      sessions: [],
    };
  }

  const sessions = state.sessions
    .filter(isRecord)
    .map((entry): SessionHistoryRecord => {
      const transcript = Array.isArray(entry.transcript)
        ? entry.transcript.filter(isRecord).map((segment): TranscriptSegment => ({
            segmentId: typeof segment.segmentId === "string" ? segment.segmentId : "",
            sessionId: typeof segment.sessionId === "string" ? segment.sessionId : "",
            meetingId: typeof segment.meetingId === "string" ? segment.meetingId : "",
            status: segment.status === "final" ? "final" : "partial",
            text: typeof segment.text === "string" ? segment.text : "",
            timestamp: typeof segment.timestamp === "number" ? segment.timestamp : now(),
            chunkIndex: typeof segment.chunkIndex === "number" ? segment.chunkIndex : null,
            sampleRate: typeof segment.sampleRate === "number" ? segment.sampleRate : null,
            channels: typeof segment.channels === "number" ? segment.channels : null,
            confidence: typeof segment.confidence === "number" ? segment.confidence : null,
            source: segment.source === "microphone" ? "microphone" : "tab-audio",
            speakerLabel:
              typeof segment.speakerLabel === "string" ? segment.speakerLabel : null,
          }))
        : [];

      return {
        sessionId: typeof entry.sessionId === "string" ? entry.sessionId : "",
        meetingId: typeof entry.meetingId === "string" ? entry.meetingId : "",
        startedAt: typeof entry.startedAt === "number" ? entry.startedAt : null,
        updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : null,
        endedAt: typeof entry.endedAt === "number" ? entry.endedAt : null,
        phase:
          entry.phase === "checking-agent" ||
          entry.phase === "connecting" ||
          entry.phase === "listening" ||
          entry.phase === "reconnecting" ||
          entry.phase === "finished"
            ? entry.phase
            : "idle",
        transport:
          entry.transport === "connecting" ||
          entry.transport === "connected" ||
          entry.transport === "reconnecting" ||
          entry.transport === "error"
            ? entry.transport
            : "idle",
        source: entry.source === "microphone" ? "microphone" : entry.source === "tab-audio" ? "tab-audio" : null,
        segmentCount:
          typeof entry.segmentCount === "number" && Number.isFinite(entry.segmentCount)
            ? entry.segmentCount
            : transcript.length,
        transcriptUpdatedAt:
          typeof entry.transcriptUpdatedAt === "number" ? entry.transcriptUpdatedAt : null,
        currentPartialText:
          typeof entry.currentPartialText === "string" ? entry.currentPartialText : "",
        lastFinalText: typeof entry.lastFinalText === "string" ? entry.lastFinalText : "",
        preview: typeof entry.preview === "string" ? entry.preview : "",
        transcript,
      } satisfies SessionHistoryRecord;
    })
    .filter((entry) => entry.sessionId.length > 0);

  return {
    version: 1,
    updatedAt: typeof state.updatedAt === "number" ? state.updatedAt : now(),
    sessions,
  };
}

function makePreview(snapshot: SessionSnapshot): string {
  const session = snapshot.session;
  if (session.lastFinalText.trim().length > 0) {
    return session.lastFinalText.trim();
  }

  if (session.currentPartialText.trim().length > 0) {
    return session.currentPartialText.trim();
  }

  const transcript = snapshot.transcript;
  if (transcript.length === 0) {
    return "";
  }

  const latestFinal = [...transcript].reverse().find((segment) => segment.status === "final");
  if (latestFinal) {
    return latestFinal.text.trim();
  }

  return transcript[transcript.length - 1].text.trim();
}

function makeEmptyState(clock: () => number): SessionHistoryState {
  return {
    version: 1,
    updatedAt: clock(),
    sessions: [],
  };
}

export class SessionHistoryStore {
  private readonly adapter: StoreAdapter;

  private readonly clock: () => number;

  private readonly maxSessions: number;

  private readonly maxAgeDays: number;

  constructor(options: SessionHistoryOptions = {}) {
    this.adapter = createStorageAdapter();
    this.clock = options.clock ?? now;
    this.maxSessions = options.maxSessions ?? 100;
    this.maxAgeDays = options.maxAgeDays ?? 60;
  }

  private async readState(): Promise<SessionHistoryState> {
    const stored = await this.adapter.read<unknown>(SESSION_HISTORY_KEY);
    return stored ? normalizeState(stored) : makeEmptyState(this.clock);
  }

  private async writeState(state: SessionHistoryState): Promise<void> {
    await this.adapter.write(SESSION_HISTORY_KEY, state);
  }

  private pruneState(state: SessionHistoryState): SessionHistoryState {
    const cutoff = this.maxAgeDays > 0 ? this.clock() - this.maxAgeDays * 24 * 60 * 60 * 1000 : null;
    const sessions = sortByRecency(state.sessions)
      .filter((entry) => {
        if (cutoff === null) {
          return true;
        }

        const stamp = entry.updatedAt ?? entry.endedAt ?? entry.startedAt ?? 0;
        return stamp >= cutoff;
      })
      .slice(0, this.maxSessions)
      .map(cloneHistoryRecord);

    return {
      version: 1,
      updatedAt: this.clock(),
      sessions,
    };
  }

  async upsertSnapshot(snapshot: SessionSnapshot): Promise<SessionHistoryRecord | null> {
    const session = snapshot.session;
    if (!session.sessionId || !session.meetingId) {
      return null;
    }

    const record: SessionHistoryRecord = {
      sessionId: session.sessionId,
      meetingId: session.meetingId,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      endedAt: session.endedAt,
      phase: session.phase,
      transport: session.transport,
      source: session.source,
      segmentCount: session.segmentCount,
      transcriptUpdatedAt: session.transcriptUpdatedAt,
      currentPartialText: session.currentPartialText,
      lastFinalText: session.lastFinalText,
      preview: makePreview(snapshot),
      transcript: snapshot.transcript.map(cloneTranscriptSegment),
    };

    const state = await this.readState();
    const nextSessions = state.sessions.filter((entry) => entry.sessionId !== record.sessionId);
    nextSessions.unshift(cloneHistoryRecord(record));

    const nextState = this.pruneState({
      version: 1,
      updatedAt: this.clock(),
      sessions: nextSessions,
    });

    await this.writeState(nextState);
    return cloneHistoryRecord(record);
  }

  async getBySessionId(sessionId: string): Promise<SessionHistoryRecord | null> {
    const state = this.pruneState(await this.readState());
    const record = state.sessions.find((entry) => entry.sessionId === sessionId);
    return record ? cloneHistoryRecord(record) : null;
  }

  async getByMeetingId(meetingId: string, options: SessionHistoryLookupOptions = {}): Promise<SessionHistoryRecord[]> {
    const state = this.pruneState(await this.readState());
    const matches = state.sessions.filter((entry) => entry.meetingId === meetingId);
    const limit = typeof options.limit === "number" && options.limit > 0 ? options.limit : matches.length;
    return sortByRecency(matches).slice(0, limit).map(cloneHistoryRecord);
  }

  async listRecent(options: SessionHistoryLookupOptions = {}): Promise<SessionHistoryRecord[]> {
    const state = this.pruneState(await this.readState());
    const limit = typeof options.limit === "number" && options.limit > 0 ? options.limit : state.sessions.length;
    return sortByRecency(state.sessions).slice(0, limit).map(cloneHistoryRecord);
  }

  async removeBySessionId(sessionId: string): Promise<boolean> {
    const state = await this.readState();
    const nextSessions = state.sessions.filter((entry) => entry.sessionId !== sessionId);
    if (nextSessions.length === state.sessions.length) {
      return false;
    }

    await this.writeState({
      version: 1,
      updatedAt: this.clock(),
      sessions: nextSessions,
    });
    return true;
  }

  async clear(): Promise<void> {
    await this.writeState(makeEmptyState(this.clock));
  }
}

export const sessionHistoryStore = new SessionHistoryStore();

export const upsertSessionHistorySnapshot = (
  snapshot: SessionSnapshot,
): Promise<SessionHistoryRecord | null> => sessionHistoryStore.upsertSnapshot(snapshot);

export const getSessionHistoryBySessionId = (
  sessionId: string,
): Promise<SessionHistoryRecord | null> => sessionHistoryStore.getBySessionId(sessionId);

export const getSessionHistoryByMeetingId = (
  meetingId: string,
  options?: SessionHistoryLookupOptions,
): Promise<SessionHistoryRecord[]> => sessionHistoryStore.getByMeetingId(meetingId, options);

export const listRecentSessionHistory = (
  options?: SessionHistoryLookupOptions,
): Promise<SessionHistoryRecord[]> => sessionHistoryStore.listRecent(options);

export const removeSessionHistoryBySessionId = (sessionId: string): Promise<boolean> =>
  sessionHistoryStore.removeBySessionId(sessionId);

export const clearSessionHistoryStore = (): Promise<void> => sessionHistoryStore.clear();
