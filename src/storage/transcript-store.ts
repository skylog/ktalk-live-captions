import type { SessionSnapshot, TranscriptSegment, TranscriptSegmentInput } from "../shared/protocol";

export const TRANSCRIPT_STORE_KEY = "ktalk-live-captions.transcripts.v1" as const;
export const DEFAULT_TRANSCRIPT_STORE_MAX_SESSIONS = 50 as const;
export const DEFAULT_TRANSCRIPT_STORE_MAX_SEGMENTS_PER_SESSION = 4000 as const;
export const DEFAULT_TRANSCRIPT_STORE_MAX_AGE_DAYS = 30 as const;

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

export interface TranscriptExportMetadata {
  generatedAt: number;
  sessionId: string;
  meetingId: string;
  source: TranscriptSegment["source"] | null;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  segmentCount: number;
  transcriptUpdatedAt: number | null;
}

export interface TranscriptSessionRecord {
  sessionId: string;
  meetingId: string;
  startedAt: number | null;
  updatedAt: number | null;
  endedAt: number | null;
  source?: TranscriptSegment["source"] | null;
  segmentCount: number;
  transcript: TranscriptSegment[];
  exportMetadata?: TranscriptExportMetadata;
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

function cloneTranscriptRecord(record: TranscriptSessionRecord): TranscriptSessionRecord {
  const exportMetadata = getTranscriptExportMetadata(record);
  return {
    sessionId: record.sessionId,
    meetingId: record.meetingId,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    endedAt: record.endedAt,
    source: record.source ?? null,
    segmentCount: record.segmentCount,
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
      segmentId: resolveString(value.segmentId) ?? undefined,
      sessionId: resolveString(value.sessionId) ?? fallbackSessionId,
      meetingId: resolveString(value.meetingId) ?? fallbackMeetingId,
      status: value.status === "final" ? "final" : "partial",
      text: typeof value.text === "string" ? value.text : "",
      timestamp: resolveNumber(value.timestamp) ?? clock(),
      chunkIndex: resolveNumber(value.chunkIndex),
      sampleRate: resolveNumber(value.sampleRate),
      channels: resolveNumber(value.channels),
      confidence: resolveNumber(value.confidence),
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
    source: typeof segment.source === "string" ? segment.source : fallbackSource ?? "tab-audio",
    speakerLabel: typeof segment.speakerLabel === "string" ? segment.speakerLabel : null,
  };
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

function resolveSegmentSource(segments: TranscriptSegment[]): TranscriptSegment["source"] | null {
  const source = segments.find(
    (segment) => segment.source === "microphone" || segment.source === "tab-audio",
  )?.source;
  return source ?? null;
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
  source: TranscriptSegment["source"] | null | undefined,
  startedAt: number | null,
  endedAt: number | null,
  segmentCount: number,
  transcriptUpdatedAt: number | null,
  generatedAt: number,
): TranscriptExportMetadata {
  return {
    generatedAt,
    sessionId,
    meetingId,
    source: source ?? null,
    startedAt,
    endedAt,
    durationMs: startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : null,
    segmentCount,
    transcriptUpdatedAt,
  };
}

function getTranscriptExportMetadata(record: TranscriptSessionRecord): TranscriptExportMetadata {
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
    record.source ?? null,
    record.startedAt,
    record.endedAt,
    record.segmentCount,
    record.updatedAt,
    fallbackTimestamp ?? now(),
  );
}

function normalizeTranscriptRecord(
  entry: Record<string, unknown>,
  clock: () => number,
): TranscriptSessionRecord | null {
  const sessionId = resolveString(entry.sessionId);
  if (!sessionId) {
    return null;
  }

  const transcript = Array.isArray(entry.transcript)
    ? dedupeSegments(
        entry.transcript
          .filter(isRecord)
          .map((candidate) =>
            normalizeStoredSegment(
              candidate,
              sessionId,
              resolveString(entry.meetingId) ?? sessionId,
              clock,
            ),
          ),
      )
    : [];
  const meetingId = resolveString(entry.meetingId) ?? transcript[0]?.meetingId ?? sessionId;
  const startedAt = resolveSessionTimestamp(resolveNumber(entry.startedAt), transcript[0]?.timestamp);
  const transcriptUpdatedAt = resolveSessionTimestamp(
    resolveNumber(entry.updatedAt),
    transcript.at(-1)?.timestamp,
    startedAt,
  );
  const endedAt = resolveSessionTimestamp(
    resolveNumber(entry.endedAt),
    transcript.at(-1)?.timestamp,
    transcriptUpdatedAt,
  );
  const source =
    entry.source === "microphone" || entry.source === "tab-audio"
      ? entry.source
      : resolveSegmentSource(transcript);
  const generatedAt =
    isRecord(entry.exportMetadata) && resolveNumber(entry.exportMetadata.generatedAt) !== null
      ? resolveNumber(entry.exportMetadata.generatedAt)!
      : clock();

  return {
    sessionId,
    meetingId,
    startedAt,
    updatedAt: transcriptUpdatedAt,
    endedAt,
    source,
    segmentCount: transcript.length,
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

function sortByRecency(records: TranscriptSessionRecord[]): TranscriptSessionRecord[] {
  return [...records].sort((a, b) => {
    const left = a.updatedAt ?? a.endedAt ?? a.startedAt ?? 0;
    const right = b.updatedAt ?? b.endedAt ?? b.startedAt ?? 0;
    return right - left;
  });
}

function normalizeState(state: unknown, clock: () => number): TranscriptStoreState {
  if (!isRecord(state) || state.version !== 1 || !Array.isArray(state.sessions)) {
    return {
      version: 1,
      updatedAt: clock(),
      sessions: [],
    };
  }

  const sessions = state.sessions
    .filter(isRecord)
    .map((entry) => normalizeTranscriptRecord(entry, clock))
    .filter((entry): entry is TranscriptSessionRecord => entry !== null);

  return {
    version: 1,
    updatedAt: resolveNumber(state.updatedAt) ?? clock(),
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
    this.maxSessions = options.maxSessions ?? DEFAULT_TRANSCRIPT_STORE_MAX_SESSIONS;
    this.maxSegmentsPerSession =
      options.maxSegmentsPerSession ?? DEFAULT_TRANSCRIPT_STORE_MAX_SEGMENTS_PER_SESSION;
    this.maxAgeDays = options.maxAgeDays ?? DEFAULT_TRANSCRIPT_STORE_MAX_AGE_DAYS;
  }

  private async readState(): Promise<TranscriptStoreState> {
    const stored = await this.adapter.read<unknown>(TRANSCRIPT_STORE_KEY);
    return stored ? normalizeState(stored, this.clock) : makeEmptyState(this.clock);
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
        const startedAt = resolveSessionTimestamp(session.startedAt, transcript[0]?.timestamp);
        const updatedAt = resolveSessionTimestamp(
          session.updatedAt,
          transcript.at(-1)?.timestamp,
          startedAt,
        );
        const endedAt = resolveSessionTimestamp(session.endedAt, transcript.at(-1)?.timestamp, updatedAt);
        const source = session.source ?? resolveSegmentSource(transcript);

        return {
          ...cloneTranscriptRecord(session),
          transcript,
          startedAt,
          updatedAt,
          endedAt,
          source,
          segmentCount: transcript.length,
          exportMetadata: buildExportMetadata(
            session.sessionId,
            session.meetingId,
            source,
            startedAt,
            endedAt,
            transcript.length,
            updatedAt,
            getTranscriptExportMetadata(session).generatedAt,
          ),
        };
      });

    return {
      version: 1,
      updatedAt: this.clock(),
      sessions,
    };
  }

  private upsertRecord(state: TranscriptStoreState, record: TranscriptSessionRecord): TranscriptStoreState {
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
    const transcript = dedupeSegments(snapshot.transcript.map(cloneTranscriptSegment));
    const source = session.source ?? resolveSegmentSource(transcript);
    const startedAt = resolveSessionTimestamp(session.startedAt, transcript[0]?.timestamp);
    const updatedAt = resolveSessionTimestamp(session.updatedAt, transcript.at(-1)?.timestamp, startedAt);
    const endedAt = resolveSessionTimestamp(session.endedAt, transcript.at(-1)?.timestamp, updatedAt);
    const record: TranscriptSessionRecord = {
      sessionId: session.sessionId,
      meetingId: session.meetingId,
      startedAt,
      updatedAt,
      endedAt,
      source,
      segmentCount: transcript.length,
      transcript,
      exportMetadata: buildExportMetadata(
        session.sessionId,
        session.meetingId,
        source,
        startedAt,
        endedAt,
        transcript.length,
        updatedAt,
        this.clock(),
      ),
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
    const semanticIndex = transcript.findIndex(
      (entry) => segmentFingerprint(entry) === segmentFingerprint(normalized),
    );

    if (index >= 0) {
      if (shouldReplaceSegment(transcript[index], normalized)) {
        transcript[index] = normalized;
      }
    } else if (semanticIndex >= 0) {
      if (shouldReplaceSegment(transcript[semanticIndex], normalized)) {
        transcript[semanticIndex] = normalized;
      }
    } else {
      transcript.push(normalized);
    }

    const dedupedTranscript =
      this.maxSegmentsPerSession > 0
        ? dedupeSegments(transcript).slice(-this.maxSegmentsPerSession)
        : [];
    const startedAt = resolveSessionTimestamp(existing?.startedAt, dedupedTranscript[0]?.timestamp, normalized.timestamp);
    const updatedAt = resolveSessionTimestamp(normalized.timestamp, dedupedTranscript.at(-1)?.timestamp, startedAt);
    const endedAt = resolveSessionTimestamp(existing?.endedAt, dedupedTranscript.at(-1)?.timestamp, updatedAt);
    const source = existing?.source ?? normalized.source;
    const record: TranscriptSessionRecord = {
      sessionId: normalized.sessionId,
      meetingId: normalized.meetingId,
      startedAt,
      updatedAt,
      endedAt,
      source,
      segmentCount: dedupedTranscript.length,
      transcript: dedupedTranscript,
      exportMetadata: buildExportMetadata(
        normalized.sessionId,
        normalized.meetingId,
        source,
        startedAt,
        endedAt,
        dedupedTranscript.length,
        updatedAt,
        this.clock(),
      ),
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
