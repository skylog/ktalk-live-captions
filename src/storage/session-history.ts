import type { SessionSnapshot, SessionState, TranscriptSegment } from "../shared/protocol";

export const SESSION_HISTORY_KEY = "ktalk-live-captions.session-history.v1" as const;
export const DEFAULT_SESSION_HISTORY_MAX_SESSIONS = 100 as const;
export const DEFAULT_SESSION_HISTORY_MAX_AGE_DAYS = 60 as const;

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

export interface SessionHistoryExportMetadata {
  generatedAt: number;
  sessionId: string;
  meetingId: string;
  source: SessionState["source"];
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  segmentCount: number;
  transcriptUpdatedAt: number | null;
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
  exportMetadata?: SessionHistoryExportMetadata;
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

function cloneStoredValue<T>(value: T): T {
  const globalScope = globalThis as typeof globalThis & {
    structuredClone?: <U>(input: U) => U;
  };

  if (typeof globalScope.structuredClone === "function") {
    return globalScope.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
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
  const exportMetadata = getSessionHistoryExportMetadata(record);
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
    exportMetadata,
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
        const value = memory.get(key);
        return value === undefined ? null : cloneStoredValue(value as T);
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
          resolve(value === undefined ? null : cloneStoredValue(value as T));
        });
      });
    },
    async write<T>(key: string, value: T): Promise<void> {
      if (!area) {
        memory.set(key, cloneStoredValue(value));
        return;
      }

      return new Promise((resolve, reject) => {
        area.set({ [key]: cloneStoredValue(value) as unknown }, () => {
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

function resolveString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function resolveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function segmentFingerprint(segment: TranscriptSegment): string {
  const timestampBucket = Math.floor(segment.timestamp / 10000);
  return [
    segment.sessionId,
    segment.meetingId,
    segment.chunkIndex ?? "",
    segment.sampleRate ?? "",
    segment.channels ?? "",
    timestampBucket,
    normalizeText(segment.text),
    segment.source,
    segment.speakerLabel ?? "",
  ].join("|");
}

function segmentPriority(status: TranscriptSegment["status"]): number {
  return status === "final" ? 1 : 0;
}

function shouldReplaceSegment(existing: TranscriptSegment, incoming: TranscriptSegment): boolean {
  const existingPriority = segmentPriority(existing.status);
  const incomingPriority = segmentPriority(incoming.status);

  if (incomingPriority !== existingPriority) {
    return incomingPriority > existingPriority;
  }

  return true;
}

function dedupeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const indexById = new Map<string, number>();
  const indexByFingerprint = new Map<string, number>();
  const ordered: TranscriptSegment[] = [];

  for (const segment of segments) {
    const idKey = segment.segmentId.length > 0 ? segment.segmentId : null;
    const fingerprint = segmentFingerprint(segment);
    const existingIndex =
      (idKey ? indexById.get(idKey) : undefined) ?? indexByFingerprint.get(fingerprint);

    if (existingIndex !== undefined) {
      if (shouldReplaceSegment(ordered[existingIndex], segment)) {
        ordered[existingIndex] = cloneTranscriptSegment(segment);
      }
    } else {
      ordered.push(cloneTranscriptSegment(segment));
    }

    const nextIndex = existingIndex ?? ordered.length - 1;
    if (idKey) {
      indexById.set(idKey, nextIndex);
    }
    indexByFingerprint.set(fingerprint, nextIndex);
  }

  return ordered;
}

function resolveSessionTimestamp(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function buildExportMetadata(
  sessionId: string,
  meetingId: string,
  source: SessionState["source"],
  startedAt: number | null,
  endedAt: number | null,
  segmentCount: number,
  transcriptUpdatedAt: number | null,
  generatedAt: number,
): SessionHistoryExportMetadata {
  return {
    generatedAt,
    sessionId,
    meetingId,
    source,
    startedAt,
    endedAt,
    durationMs: startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : null,
    segmentCount,
    transcriptUpdatedAt,
  };
}

function getSessionHistoryExportMetadata(record: SessionHistoryRecord): SessionHistoryExportMetadata {
  if (record.exportMetadata) {
    return {
      generatedAt: record.exportMetadata.generatedAt,
      sessionId: record.exportMetadata.sessionId,
      meetingId: record.exportMetadata.meetingId,
      source: record.exportMetadata.source,
      startedAt: record.exportMetadata.startedAt,
      endedAt: record.exportMetadata.endedAt,
      durationMs: record.exportMetadata.durationMs,
      segmentCount: record.exportMetadata.segmentCount,
      transcriptUpdatedAt: record.exportMetadata.transcriptUpdatedAt,
    };
  }

  const fallbackTimestamp = resolveSessionTimestamp(record.updatedAt, record.endedAt, record.startedAt, now());
  return buildExportMetadata(
    record.sessionId,
    record.meetingId,
    record.source,
    record.startedAt,
    record.endedAt,
    record.segmentCount,
    record.transcriptUpdatedAt,
    fallbackTimestamp ?? now(),
  );
}

function normalizeTranscriptSegment(
  segment: Record<string, unknown>,
  clock: () => number,
): TranscriptSegment {
  return {
    segmentId:
      resolveString(segment.segmentId) ?? `${resolveString(segment.sessionId) ?? `${clock()}`}:${resolveNumber(segment.timestamp) ?? clock()}`,
    sessionId: resolveString(segment.sessionId) ?? `${resolveNumber(segment.timestamp) ?? clock()}`,
    meetingId:
      resolveString(segment.meetingId) ?? resolveString(segment.sessionId) ?? `${resolveNumber(segment.timestamp) ?? clock()}`,
    status: segment.status === "final" ? "final" : "partial",
    text: typeof segment.text === "string" ? segment.text : "",
    timestamp: resolveNumber(segment.timestamp) ?? clock(),
    chunkIndex: resolveNumber(segment.chunkIndex),
    sampleRate: resolveNumber(segment.sampleRate),
    channels: resolveNumber(segment.channels),
    confidence: resolveNumber(segment.confidence),
    source: segment.source === "microphone" ? "microphone" : "tab-audio",
    speakerLabel: typeof segment.speakerLabel === "string" ? segment.speakerLabel : null,
  };
}

function resolveSource(
  value: unknown,
  transcript: TranscriptSegment[],
): SessionState["source"] {
  if (value === "microphone" || value === "tab-audio") {
    return value;
  }

  return transcript.find((segment) => segment.source === "microphone" || segment.source === "tab-audio")?.source ?? null;
}

function sortByRecency(records: SessionHistoryRecord[]): SessionHistoryRecord[] {
  return [...records].sort((a, b) => {
    const left = a.updatedAt ?? a.endedAt ?? a.startedAt ?? 0;
    const right = b.updatedAt ?? b.endedAt ?? b.startedAt ?? 0;
    return right - left;
  });
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

function normalizeHistoryRecord(entry: Record<string, unknown>, clock: () => number): SessionHistoryRecord | null {
  const sessionId = resolveString(entry.sessionId);
  if (!sessionId) {
    return null;
  }

  const rawTranscript = Array.isArray(entry.transcript)
    ? entry.transcript.filter(isRecord).map((segment) => normalizeTranscriptSegment(segment, clock))
    : [];
  const transcript = dedupeSegments(rawTranscript);
  const meetingId = resolveString(entry.meetingId) ?? transcript[0]?.meetingId ?? sessionId;
  const startedAt = resolveSessionTimestamp(resolveNumber(entry.startedAt), transcript[0]?.timestamp);
  const transcriptUpdatedAt = resolveSessionTimestamp(
    resolveNumber(entry.transcriptUpdatedAt),
    resolveNumber(entry.updatedAt),
    transcript.at(-1)?.timestamp,
    startedAt,
  );
  const endedAt = resolveSessionTimestamp(resolveNumber(entry.endedAt), transcript.at(-1)?.timestamp, transcriptUpdatedAt);
  const source = resolveSource(entry.source, transcript);
  const generatedAt =
    isRecord(entry.exportMetadata) && resolveNumber(entry.exportMetadata.generatedAt) !== null
      ? resolveNumber(entry.exportMetadata.generatedAt)!
      : clock();

  return {
    sessionId,
    meetingId,
    startedAt,
    updatedAt: resolveNumber(entry.updatedAt) ?? transcriptUpdatedAt,
    endedAt,
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
    source,
    segmentCount: transcript.length,
    transcriptUpdatedAt,
    currentPartialText: typeof entry.currentPartialText === "string" ? entry.currentPartialText : "",
    lastFinalText: typeof entry.lastFinalText === "string" ? entry.lastFinalText : "",
    preview: typeof entry.preview === "string" ? entry.preview : "",
    transcript,
    exportMetadata: buildExportMetadata(
      sessionId,
      meetingId,
      source,
      startedAt,
      endedAt,
      transcript.length,
      transcriptUpdatedAt,
      generatedAt,
    ),
  };
}

function normalizeState(state: unknown, clock: () => number): SessionHistoryState {
  if (!isRecord(state) || state.version !== 1 || !Array.isArray(state.sessions)) {
    return {
      version: 1,
      updatedAt: clock(),
      sessions: [],
    };
  }

  const sessions = state.sessions
    .filter(isRecord)
    .map((entry) => normalizeHistoryRecord(entry, clock))
    .filter((entry): entry is SessionHistoryRecord => entry !== null);

  return {
    version: 1,
    updatedAt: resolveNumber(state.updatedAt) ?? clock(),
    sessions,
  };
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
    this.maxSessions = options.maxSessions ?? DEFAULT_SESSION_HISTORY_MAX_SESSIONS;
    this.maxAgeDays = options.maxAgeDays ?? DEFAULT_SESSION_HISTORY_MAX_AGE_DAYS;
  }

  private async readState(): Promise<SessionHistoryState> {
    const stored = await this.adapter.read<unknown>(SESSION_HISTORY_KEY);
    return stored ? normalizeState(stored, this.clock) : makeEmptyState(this.clock);
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
      .map((entry) => {
        const transcript = dedupeSegments(entry.transcript);
        const startedAt = resolveSessionTimestamp(entry.startedAt, transcript[0]?.timestamp);
        const updatedAt = resolveSessionTimestamp(
          entry.updatedAt,
          entry.transcriptUpdatedAt,
          transcript.at(-1)?.timestamp,
          startedAt,
        );
        const endedAt = resolveSessionTimestamp(entry.endedAt, transcript.at(-1)?.timestamp, updatedAt);
        const source = resolveSource(entry.source, transcript);
        const exportMetadata = getSessionHistoryExportMetadata(entry);
        return {
          ...cloneHistoryRecord(entry),
          transcript,
          startedAt,
          updatedAt,
          endedAt,
          source,
          segmentCount: transcript.length,
          transcriptUpdatedAt: updatedAt,
          exportMetadata: buildExportMetadata(
            entry.sessionId,
            entry.meetingId,
            source,
            startedAt,
            endedAt,
            transcript.length,
            updatedAt,
            exportMetadata.generatedAt,
          ),
        };
      });

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

    const transcript = dedupeSegments(snapshot.transcript.map(cloneTranscriptSegment));
    const startedAt = resolveSessionTimestamp(session.startedAt, transcript[0]?.timestamp);
    const updatedAt = resolveSessionTimestamp(session.updatedAt, transcript.at(-1)?.timestamp, startedAt);
    const endedAt = resolveSessionTimestamp(session.endedAt, transcript.at(-1)?.timestamp, updatedAt);
    const source = resolveSource(session.source, transcript);
    const record: SessionHistoryRecord = {
      sessionId: session.sessionId,
      meetingId: session.meetingId,
      startedAt,
      updatedAt,
      endedAt,
      phase: session.phase,
      transport: session.transport,
      source,
      segmentCount: transcript.length,
      transcriptUpdatedAt: session.transcriptUpdatedAt ?? updatedAt,
      currentPartialText: session.currentPartialText,
      lastFinalText: session.lastFinalText,
      preview: makePreview({ protocolVersion: snapshot.protocolVersion, session, transcript }),
      transcript,
      exportMetadata: buildExportMetadata(
        session.sessionId,
        session.meetingId,
        source,
        startedAt,
        endedAt,
        transcript.length,
        session.transcriptUpdatedAt ?? updatedAt,
        this.clock(),
      ),
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
