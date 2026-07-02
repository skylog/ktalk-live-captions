export {
  LOCAL_ASR_HTTP_URL,
  LOCAL_ASR_WS_URL,
  PROTOCOL_VERSION,
  type AudioChunkTransportMessage,
  type SessionEndTransportMessage,
  type SessionStartTransportMessage,
  type TranscriptFinalTransportMessage,
  type TranscriptPartialTransportMessage,
  type TransportMessage,
} from "../shared/protocol";

export {
  createAudioCapture,
  BrowserAudioCapture,
  type AudioCapture,
  type AudioCaptureInput,
  type AudioCaptureOptions,
  type AudioCaptureState,
} from "./audio-capture";

export {
  createPcmEncoder,
  PcmEncoder,
  type PcmChunk,
  type PcmEncoderOptions,
} from "./pcm-encoder";

export {
  createWebSocketTransportClient,
  WebSocketTransport,
  type IncomingTranscriptMessage,
  type RawTranscriptTransportMessage,
  type WebSocketTransportClient,
  type WebSocketTransportClientOptions,
} from "./websocket-client";

import type { AudioCapture } from "./audio-capture";
import { createAudioCapture } from "./audio-capture";
import type { AudioChunkTransportMessage, SessionEndTransportMessage, SessionStartTransportMessage, TranscriptPartialTransportMessage, TranscriptFinalTransportMessage } from "../shared/protocol";
import { createWebSocketTransportClient } from "./websocket-client";
import type { IncomingTranscriptMessage, WebSocketTransportClient } from "./websocket-client";
import type { AudioCaptureInput, AudioCaptureOptions } from "./audio-capture";

export interface LocalAsrTransportOptions {
  url?: string;
  targetSampleRate?: number;
  chunkDurationMs?: number;
  stopSourceTracksOnStop?: boolean;
  reconnectMaxAttempts?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  onTranscript?: (message: IncomingTranscriptMessage) => void;
  onError?: (error: Error) => void;
}

export interface LocalAsrTransport {
  readonly isRunning: boolean;
  readonly sessionId: string | null;
  readonly meetingId: string | null;
  start(session: SessionStartTransportMessage, source: AudioCaptureInput): Promise<void>;
  sendAudioChunk(message: AudioChunkTransportMessage): Promise<void>;
  end(reason?: string | null): Promise<void>;
  stop(reason?: string | null): Promise<void>;
  dispose(): Promise<void>;
}

class ComposedLocalAsrTransport implements LocalAsrTransport {
  private readonly options: LocalAsrTransportOptions;

  private websocket: WebSocketTransportClient | null = null;

  private capture: AudioCapture | null = null;

  private session: SessionStartTransportMessage | null = null;

  private running = false;

  constructor(options: LocalAsrTransportOptions = {}) {
    this.options = options;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get sessionId(): string | null {
    return this.session?.sessionId ?? null;
  }

  get meetingId(): string | null {
    return this.session?.meetingId ?? null;
  }

  async start(session: SessionStartTransportMessage, source: AudioCaptureInput): Promise<void> {
    await this.stop("replaced");

    const websocket = createWebSocketTransportClient({
      url: this.options.url,
      reconnectMaxAttempts: this.options.reconnectMaxAttempts,
      reconnectBaseDelayMs: this.options.reconnectBaseDelayMs,
      reconnectMaxDelayMs: this.options.reconnectMaxDelayMs,
      onTranscript: this.options.onTranscript,
      onError: (error) => {
        this.options.onError?.(error instanceof Error ? error : new Error("ASR websocket error."));
      },
    });

    const capture = createAudioCapture({
      input: source,
      targetSampleRate: this.options.targetSampleRate,
      chunkDurationMs: this.options.chunkDurationMs,
      stopSourceTracksOnStop: this.options.stopSourceTracksOnStop,
      onChunk: (chunk) => {
        const audioChunk: AudioChunkTransportMessage = {
          type: "audio.chunk",
          protocolVersion: session.protocolVersion,
          sessionId: session.sessionId,
          meetingId: session.meetingId,
          timestamp: chunk.timestamp,
          chunkIndex: chunk.chunkIndex,
          sampleRate: chunk.sampleRate,
          channels: chunk.channels,
          pcmBase64: chunk.pcmBase64,
        };

        void websocket.sendAudioChunk(audioChunk).catch((error: unknown) => {
          this.options.onError?.(error instanceof Error ? error : new Error("Audio chunk send failed."));
        });
      },
      onError: this.options.onError,
    });

    this.websocket = websocket;
    this.capture = capture;
    this.session = session;

    try {
      await websocket.connect();
      await websocket.sendSessionStart(session);
      await capture.start();
      this.running = true;
    } catch (error) {
      await this.stop("error");
      throw error instanceof Error ? error : new Error("ASR transport start failed.");
    }
  }

  async sendAudioChunk(message: AudioChunkTransportMessage): Promise<void> {
    if (!this.websocket) {
      throw new Error("ASR transport is not connected.");
    }

    await this.websocket.sendAudioChunk(message);
  }

  async end(reason: string | null = null): Promise<void> {
    await this.stop(reason);
  }

  async stop(reason: string | null = null): Promise<void> {
    const capture = this.capture;
    const websocket = this.websocket;
    const session = this.session;

    this.capture = null;
    this.websocket = null;
    this.session = null;
    this.running = false;

    if (capture) {
      await capture.stop(reason ?? "stopped").catch((error: unknown) => {
        this.options.onError?.(error instanceof Error ? error : new Error("Audio capture stop failed."));
      });
    }

    if (websocket && session) {
      const endMessage: SessionEndTransportMessage = {
        type: "session.end",
        protocolVersion: session.protocolVersion,
        sessionId: session.sessionId,
        meetingId: session.meetingId,
        timestamp: Date.now(),
        reason,
      };

      if (websocket.isConnected) {
        await websocket.sendSessionEnd(endMessage).catch((error: unknown) => {
          this.options.onError?.(error instanceof Error ? error : new Error("Session end send failed."));
        });
      }
      await websocket.close().catch((error: unknown) => {
        this.options.onError?.(error instanceof Error ? error : new Error("WebSocket close failed."));
      });
    }
  }

  async dispose(): Promise<void> {
    await this.stop("disposed");
  }
}

export function createLocalAsrTransport(
  options: LocalAsrTransportOptions = {},
): LocalAsrTransport {
  return new ComposedLocalAsrTransport(options);
}
