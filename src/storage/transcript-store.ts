import type { SessionSnapshot, TranscriptSegment, TranscriptSegmentInput } from "../shared/protocol";

export const TRANSCRIPT_STORE_KEY = "ktalk-live-captions.transcripts.v1" as const;

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

interface TranscriptStoreState {
  version: 1;
  updatedAt: number;
  sessions: TranscriptSessionRecord[];
}

export interface TranscriptSessionRecord {
  sessionId: string;
  meetingId: string;
  startedAt: number | null;
  updatedAt: number | null;
  endedAt: number | null;
  segmentCount: number;
  transcript: TranscriptSegment[];
}

export interface TranscriptStoreOptions {
  maxSessions?: number;
  maxSegmentsPerSession?: number;
  maxAgeDays?: number;
  clock?: () => number;
}

export interface TranscriptLookupOptions {
  limit?: number;
}

export interface TranscriptStoreSnapshot {
  version: 1;
  updatedAt: number;
  sessions: TranscriptSessionRecord[];
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

function cloneTranscriptRecord(record: TranscriptSessionRecord): TranscriptSessionRecord {
  return {
    sessionId: record.sessionId,
    meetingId: record.meetingId,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    endedAt: record.endedAt,
    segmentCount: record.segmentCount,
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
        area.set({ [key]: value as unknown as Record<string, unknown> }, () => {
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

function normalizeStoredSegment(
  value: unknown,
  fallbackSessionId: string,
  fallbackMeetingId: string,
  clock: () => number,
): TranscriptSegment {
  if (!isRecord(value)) {
    return normalizeTranscriptSegment(
      {
        status: "partial",
        text: "",
        timestamp: clock(),
        source: "tab-audio",
      },
      fallbackSessionId,
      fallbackMeetingId,
      null,
      clock,
    );
  }

  return normalizeTranscriptSegment(
    {
      segmentId: typeof value.segmentId === "string" ? value.segmentId : undefined,
      sessionId: typeof value.sessionId === "string" ? value.sessionId : fallbackSessionId,
      meetingId: typeof value.meetingId === "string" ? value.meetingId : fallbackMeetingId,
      status: value.status === "final" ? "final" : "partial",
      text: typeof value.text === "string" ? value.text : "",
      timestamp: typeof value.timestamp === "number" ? value.timestamp : clock(),
      chunkIndex: typeof value.chunkIndex === "number" ? value.chunkIndex : null,
      sampleRate: typeof value.sampleRate === "number" ? value.sampleRate : null,
      channels: typeof value.channels === "number" ? value.channels : null,
      confidence: typeof value.confidence === "number" ? value.confidence : null,
      source: value.source === "microphone" ? "microphone" : value.source === "tab-audio" ? "tab-audio" : null,
      speakerLabel: typeof value.speakerLabel === "string" ? value.speakerLabel : null,
    },
    fallbackSessionId,
    fallbackMeetingId,
    null,
    clock,
  );
}

function normalizeTranscriptSegment(
  segment: TranscriptSegmentInput,
  fallbackSessionId: string | null,
  fallbackMeetingId: string | null,
  fallbackSource: TranscriptSegment["source"] | null,
  clock: () => number,
): TranscriptSegment {
  const timestamp = typeof segment.timestamp === "number" ? segment.timestamp : clock();
  const sessionId =
    typeof segment.sessionId === "string" && segment.sessionId.length > 0
      ? segment.sessionId
      : fallbackSessionId ?? `${timestamp}`;
  const meetingId =
    typeof segment.meetingId === "string" && segment.meetingId.length > 0
      ? segment.meetingId
      : fallbackMeetingId ?? sessionId;

  return {
    segmentId:
      typeof segment.segmentId === "string" && segment.segmentId.length > 0
        ? segment.segmentId
        : `${sessionId}:${meetingId}:${segment.status}:${timestamp}:${segment.text}`,
    sessionId,
    meetingId,
    status: segment.status,
    text: segment.text,
    timestamp,
    chunkIndex: typeof segment.chunkIndex === "number" ? segment.chunkIndex : null,
    sampleRate: typeof segment.sampleRate === "number" ? segment.sampleRate : null,
    channels: typeof segment.channels === "number" ? segment.channels : null,
    confidence: typeof segment.confidence === "number" ? segment.confidence : null,
    source:
      typeof segment.source === "string"
        ? segment.source
        : fallbackSource ?? "tab-audio",
    speakerLabel: typeof segment.speakerLabel === "string" ? segment.speakerLabel : null,
  };
}

function segmentFingerprint(segment: TranscriptSegment): string {
  return [
    segment.sessionId,
    segment.meetingId,
    segment.status,
    segment.timestamp,
    segment.chunkIndex ?? "",
    segment.text,
    segment.confidence ?? "",
    segment.source,
    segment.speakerLabel ?? "",
  ].join("|");
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
      ordered[existingIndex] = cloneTranscriptSegment(segment);
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

function sortByRecency(records: TranscriptSessionRecord[]): TranscriptSessionRecord[] {
  return [...records].sort((a, b) => {
    const left = a.updatedAt ?? a.endedAt ?? a.startedAt ?? 0;
    const right = b.updatedAt ?? b.endedAt ?? b.startedAt ?? 0;
    return right - left;
  });
}

function normalizeState(state: unknown): TranscriptStoreState {
  if (!isRecord(state) || state.version !== 1 || !Array.isArray(state.sessions)) {
    return {
      version: 1,
      updatedAt: now(),
      sessions: [],
    };
  }

  const sessions = state.sessions
    .filter(isRecord)
    .map((entry) => ({
      sessionId: typeof entry.sessionId === "string" ? entry.sessionId : "",
      meetingId: typeof entry.meetingId === "string" ? entry.meetingId : "",
      startedAt: typeof entry.startedAt === "number" ? entry.startedAt : null,
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : null,
      endedAt: typeof entry.endedAt === "number" ? entry.endedAt : null,
      segmentCount:
        typeof entry.segmentCount === "number" && Number.isFinite(entry.segmentCount)
          ? entry.segmentCount
          : 0,
      transcript: Array.isArray(entry.transcript)
        ? entry.transcript
            .filter(isRecord)
            .map((candidate) =>
              normalizeStoredSegment(candidate, typeof entry.sessionId === "string" ? entry.sessionId : "", typeof entry.meetingId === "string" ? entry.meetingId : "", now),
            )
        : [],
    }))
    .filter((entry) => entry.sessionId.length > 0);

  return {
    version: 1,
    updatedAt: typeof state.updatedAt === "number" ? state.updatedAt : now(),
    sessions,
  };
}

function makeEmptyState(clock: () => number): TranscriptStoreState {
  return {
    version: 1,
    updatedAt: clock(),
    sessions: [],
  };
}

export class TranscriptStore {
  private readonly adapter: StoreAdapter;

  private readonly clock: () => number;

  private readonly maxSessions: number;

  private readonly maxSegmentsPerSession: number;

  private readonly maxAgeDays: number;

  constructor(options: TranscriptStoreOptions = {}) {
    this.adapter = createStorageAdapter();
    this.clock = options.clock ?? now;
    this.maxSessions = options.maxSessions ?? 50;
    this.maxSegmentsPerSession = options.maxSegmentsPerSession ?? 4000;
    this.maxAgeDays = options.maxAgeDays ?? 30;
  }

  private async readState(): Promise<TranscriptStoreState> {
    const stored = await this.adapter.read<unknown>(TRANSCRIPT_STORE_KEY);
    return stored ? normalizeState(stored) : makeEmptyState(this.clock);
  }

  private async writeState(state: TranscriptStoreState): Promise<void> {
    await this.adapter.write(TRANSCRIPT_STORE_KEY, state);
  }

  private pruneState(state: TranscriptStoreState): TranscriptStoreState {
    const cutoff = this.maxAgeDays > 0 ? this.clock() - this.maxAgeDays * 24 * 60 * 60 * 1000 : null;
    const sessions = sortByRecency(state.sessions)
      .filter((session) => {
        if (cutoff === null) {
          return true;
        }

        const stamp = session.updatedAt ?? session.endedAt ?? session.startedAt ?? 0;
        return stamp >= cutoff;
      })
      .slice(0, this.maxSessions)
      .map((session) => {
        const transcript =
          this.maxSegmentsPerSession > 0
            ? dedupeSegments(session.transcript).slice(-this.maxSegmentsPerSession)
            : [];
        return {
          ...cloneTranscriptRecord(session),
          transcript,
          segmentCount: transcript.length,
          updatedAt: session.updatedAt ?? this.clock(),
        };
      });

    return {
      version: 1,
      updatedAt: this.clock(),
      sessions,
    };
  }

  private upsertRecord(
    state: TranscriptStoreState,
    record: TranscriptSessionRecord,
  ): TranscriptStoreState {
    const nextSessions = state.sessions.filter((entry) => entry.sessionId !== record.sessionId);
    nextSessions.unshift(cloneTranscriptRecord(record));
    return this.pruneState({
      version: 1,
      updatedAt: this.clock(),
      sessions: nextSessions,
    });
  }

  async getSnapshot(): Promise<TranscriptStoreSnapshot> {
    const rawState = await this.readState();
    const state = this.pruneState(rawState);
    if (state.sessions.length !== rawState.sessions.length) {
      await this.writeState(state);
    }

    return {
      version: state.version,
      updatedAt: state.updatedAt,
      sessions: state.sessions.map(cloneTranscriptRecord),
    };
  }

  async upsertSnapshot(snapshot: SessionSnapshot): Promise<TranscriptSessionRecord | null> {
    const session = snapshot.session;
    if (!session.sessionId || !session.meetingId) {
      return null;
    }

    const state = await this.readState();
    const record: TranscriptSessionRecord = {
      sessionId: session.sessionId,
      meetingId: session.meetingId,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      endedAt: session.endedAt,
      segmentCount: session.segmentCount,
      transcript: dedupeSegments([...snapshot.transcript.map(cloneTranscriptSegment)]),
    };

    const nextState = this.upsertRecord(state, record);
    await this.writeState(nextState);
    return cloneTranscriptRecord(record);
  }

  async appendSegment(
    segment: TranscriptSegmentInput,
    context: {
      sessionId?: string | null;
      meetingId?: string | null;
      source?: TranscriptSegment["source"] | null;
    } = {},
  ): Promise<TranscriptSessionRecord> {
    const state = await this.readState();
    const normalized = normalizeTranscriptSegment(
      segment,
      context.sessionId ?? null,
      context.meetingId ?? null,
      context.source ?? null,
      this.clock,
    );

    const existing = state.sessions.find((entry) => entry.sessionId === normalized.sessionId);
    const transcript = existing ? [...existing.transcript] : [];
    const index = transcript.findIndex((entry) => entry.segmentId === normalized.segmentId);
    const semanticIndex = transcript.findIndex((entry) => segmentFingerprint(entry) === segmentFingerprint(normalized));

    if (index >= 0) {
      transcript[index] = normalized;
    } else if (semanticIndex >= 0) {
      transcript[semanticIndex] = normalized;
    } else {
      transcript.push(normalized);
    }

    const record: TranscriptSessionRecord = {
      sessionId: normalized.sessionId,
      meetingId: normalized.meetingId,
      startedAt: existing?.startedAt ?? normalized.timestamp,
      updatedAt: normalized.timestamp,
      endedAt: existing?.endedAt ?? null,
      segmentCount: transcript.length,
      transcript:
        this.maxSegmentsPerSession > 0
          ? dedupeSegments(transcript).slice(-this.maxSegmentsPerSession)
          : [],
    };

    const nextState = this.upsertRecord(state, record);
    await this.writeState(nextState);
    return cloneTranscriptRecord(record);
  }

  async getBySessionId(sessionId: string): Promise<TranscriptSessionRecord | null> {
    const state = this.pruneState(await this.readState());
    const record = state.sessions.find((entry) => entry.sessionId === sessionId);
    return record ? cloneTranscriptRecord(record) : null;
  }

  async getByMeetingId(meetingId: string, options: TranscriptLookupOptions = {}): Promise<TranscriptSessionRecord[]> {
    const state = this.pruneState(await this.readState());
    const matches = state.sessions.filter((entry) => entry.meetingId === meetingId);
    const limit = typeof options.limit === "number" && options.limit > 0 ? options.limit : matches.length;
    return sortByRecency(matches).slice(0, limit).map(cloneTranscriptRecord);
  }

  async listRecent(options: TranscriptLookupOptions = {}): Promise<TranscriptSessionRecord[]> {
    const state = this.pruneState(await this.readState());
    const limit = typeof options.limit === "number" && options.limit > 0 ? options.limit : state.sessions.length;
    return sortByRecency(state.sessions).slice(0, limit).map(cloneTranscriptRecord);
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

export const transcriptStore = new TranscriptStore();

export const getTranscriptSnapshot = (): Promise<TranscriptStoreSnapshot> =>
  transcriptStore.getSnapshot();

export const upsertTranscriptSnapshot = (snapshot: SessionSnapshot): Promise<TranscriptSessionRecord | null> =>
  transcriptStore.upsertSnapshot(snapshot);

export const appendTranscriptSegment = (
  segment: TranscriptSegmentInput,
  context?: {
    sessionId?: string | null;
    meetingId?: string | null;
    source?: TranscriptSegment["source"] | null;
  },
): Promise<TranscriptSessionRecord> => transcriptStore.appendSegment(segment, context);

export const getTranscriptBySessionId = (sessionId: string): Promise<TranscriptSessionRecord | null> =>
  transcriptStore.getBySessionId(sessionId);

export const getTranscriptByMeetingId = (
  meetingId: string,
  options?: TranscriptLookupOptions,
): Promise<TranscriptSessionRecord[]> => transcriptStore.getByMeetingId(meetingId, options);

export const listRecentTranscripts = (
  options?: TranscriptLookupOptions,
): Promise<TranscriptSessionRecord[]> => transcriptStore.listRecent(options);

export const removeTranscriptBySessionId = (sessionId: string): Promise<boolean> =>
  transcriptStore.removeBySessionId(sessionId);

export const clearTranscriptStore = (): Promise<void> => transcriptStore.clear();
