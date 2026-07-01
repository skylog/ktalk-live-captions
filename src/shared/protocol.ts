export const PROTOCOL_VERSION = 1 as const;

export const LOCAL_ASR_HTTP_URL = "http://localhost:8000/asr" as const;
export const LOCAL_ASR_WS_URL = "ws://localhost:8000/asr" as const;

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isLocalAsrHttpUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return (
    parsed !== null &&
    parsed.protocol === "http:" &&
    parsed.hostname === "localhost" &&
    parsed.port === "8000" &&
    parsed.pathname === "/asr"
  );
}

export function isLocalAsrWsUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return (
    parsed !== null &&
    parsed.protocol === "ws:" &&
    parsed.hostname === "localhost" &&
    parsed.port === "8000" &&
    parsed.pathname === "/asr"
  );
}

export function assertLocalAsrHttpUrl(url: string): string {
  if (!isLocalAsrHttpUrl(url)) {
    throw new Error(`Expected a localhost ASR HTTP endpoint, received ${url}`);
  }

  return url;
}

export function assertLocalAsrWsUrl(url: string): string {
  if (!isLocalAsrWsUrl(url)) {
    throw new Error(`Expected a localhost ASR WebSocket endpoint, received ${url}`);
  }

  return url;
}

export const SESSION_PHASES = [
  "idle",
  "checking-agent",
  "connecting",
  "listening",
  "reconnecting",
  "finished",
] as const;

export type SessionPhase = (typeof SESSION_PHASES)[number];

export const SESSION_TRANSPORT_STATES = [
  "idle",
  "connecting",
  "connected",
  "reconnecting",
  "error",
] as const;

export type SessionTransportState = (typeof SESSION_TRANSPORT_STATES)[number];

export const CAPTURE_SOURCES = ["tab-audio", "microphone"] as const;

export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export const TRANSCRIPT_STATUSES = ["partial", "final"] as const;

export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number];

export const SERVICE_HEALTH_STATUSES = [
  "unknown",
  "checking",
  "ready",
  "degraded",
  "unreachable",
] as const;

export type ServiceHealthStatus = (typeof SERVICE_HEALTH_STATUSES)[number];

export const SESSION_ERROR_CODES = [
  "unknown",
  "protocol-error",
  "service-unreachable",
  "permission-denied",
  "capture-failed",
  "socket-closed",
] as const;

export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number];

export interface ProtocolError {
  code: SessionErrorCode;
  message: string;
  recoverable: boolean;
  timestamp: number;
  details?: string | null;
}

export interface ServiceHealth {
  status: ServiceHealthStatus;
  endpoint: string;
  checkedAt: number | null;
  latencyMs: number | null;
  reason: string | null;
}

export interface SessionSeed {
  sessionId?: string;
  meetingId?: string;
  tabId?: number | null;
  source?: CaptureSource | null;
  startedAt?: number | null;
}

export interface SessionState {
  sessionId: string | null;
  meetingId: string | null;
  tabId: number | null;
  source: CaptureSource | null;
  phase: SessionPhase;
  transport: SessionTransportState;
  startedAt: number | null;
  updatedAt: number | null;
  endedAt: number | null;
  currentPartialText: string;
  lastFinalText: string;
  segmentCount: number;
  transcriptUpdatedAt: number | null;
  lastError: ProtocolError | null;
  health: ServiceHealth;
}

export interface TranscriptSegment {
  segmentId: string;
  sessionId: string;
  meetingId: string;
  status: TranscriptStatus;
  text: string;
  timestamp: number;
  chunkIndex: number | null;
  sampleRate: number | null;
  channels: number | null;
  confidence: number | null;
  source: CaptureSource;
  speakerLabel: string | null;
}

export interface TranscriptSegmentInput {
  segmentId?: string;
  sessionId?: string;
  meetingId?: string;
  status: TranscriptStatus;
  text: string;
  timestamp?: number;
  chunkIndex?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  confidence?: number | null;
  source?: CaptureSource | null;
  speakerLabel?: string | null;
}

export interface SessionPatch {
  meetingId?: string | null;
  tabId?: number | null;
  source?: CaptureSource | null;
  phase?: SessionPhase;
  transport?: SessionTransportState;
  startedAt?: number | null;
  updatedAt?: number | null;
  endedAt?: number | null;
  currentPartialText?: string;
  lastFinalText?: string;
  segmentCount?: number;
  transcriptUpdatedAt?: number | null;
  lastError?: ProtocolError | null;
  health?: ServiceHealth;
}

export interface SessionSnapshot {
  protocolVersion: typeof PROTOCOL_VERSION;
  session: SessionState;
  transcript: ReadonlyArray<TranscriptSegment>;
}

export interface RuntimeErrorResponse {
  ok: false;
  requestId: string | null;
  type: "error";
  error: ProtocolError;
}

export interface RuntimePongResponse {
  ok: true;
  requestId: string | null;
  type: "protocol.pong";
  protocolVersion: typeof PROTOCOL_VERSION;
}

export interface RuntimeSessionSnapshotResponse {
  ok: true;
  requestId: string | null;
  type: "session.snapshot";
  snapshot: SessionSnapshot;
}

export interface RuntimeHealthResponse {
  ok: true;
  requestId: string | null;
  type: "service.health";
  health: ServiceHealth;
}

export type RuntimeResponse =
  | RuntimeErrorResponse
  | RuntimePongResponse
  | RuntimeSessionSnapshotResponse
  | RuntimeHealthResponse;

export interface ProtocolPingRequest {
  type: "protocol.ping";
  requestId?: string | null;
}

export interface SessionGetRequest {
  type: "session.get";
  requestId?: string | null;
}

export interface SessionStartRequest {
  type: "session.start";
  requestId?: string | null;
  session?: SessionSeed;
}

export interface SessionUpdateRequest {
  type: "session.update";
  requestId?: string | null;
  patch: SessionPatch;
}

export interface SessionEndRequest {
  type: "session.end";
  requestId?: string | null;
  reason?: string | null;
}

export interface SessionResetRequest {
  type: "session.reset";
  requestId?: string | null;
}

export interface TranscriptAppendRequest {
  type: "transcript.append";
  requestId?: string | null;
  segment: TranscriptSegmentInput;
}

export interface ServiceHealthRequest {
  type: "service.health.get";
  requestId?: string | null;
}

export type RuntimeRequest =
  | ProtocolPingRequest
  | SessionGetRequest
  | SessionStartRequest
  | SessionUpdateRequest
  | SessionEndRequest
  | SessionResetRequest
  | TranscriptAppendRequest
  | ServiceHealthRequest;

export interface SessionStartTransportMessage {
  type: "session.start";
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  meetingId: string;
  timestamp: number;
  tabId: number | null;
  source: CaptureSource;
}

export interface AudioChunkTransportMessage {
  type: "audio.chunk";
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  meetingId: string;
  timestamp: number;
  chunkIndex: number;
  sampleRate: number;
  channels: number;
  pcmBase64: string;
}

export interface SessionEndTransportMessage {
  type: "session.end";
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  meetingId: string;
  timestamp: number;
  reason: string | null;
}

export interface TranscriptPartialTransportMessage {
  type: "transcript.partial";
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  meetingId: string;
  timestamp: number;
  text: string;
  confidence: number | null;
}

export interface TranscriptFinalTransportMessage {
  type: "transcript.final";
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  meetingId: string;
  timestamp: number;
  text: string;
  confidence: number | null;
}

export type TransportMessage =
  | SessionStartTransportMessage
  | AudioChunkTransportMessage
  | SessionEndTransportMessage
  | TranscriptPartialTransportMessage
  | TranscriptFinalTransportMessage;

export function createIdleServiceHealth(): ServiceHealth {
  return {
    status: "unknown",
    endpoint: LOCAL_ASR_HTTP_URL,
    checkedAt: null,
    latencyMs: null,
    reason: null,
  };
}

export function createIdleSessionState(): SessionState {
  return {
    sessionId: null,
    meetingId: null,
    tabId: null,
    source: null,
    phase: "idle",
    transport: "idle",
    startedAt: null,
    updatedAt: null,
    endedAt: null,
    currentPartialText: "",
    lastFinalText: "",
    segmentCount: 0,
    transcriptUpdatedAt: null,
    lastError: null,
    health: createIdleServiceHealth(),
  };
}

export function createProtocolError(
  code: SessionErrorCode,
  message: string,
  recoverable: boolean,
  details?: string | null,
  timestamp = Date.now(),
): ProtocolError {
  return {
    code,
    message,
    recoverable,
    timestamp,
    details: details ?? null,
  };
}
