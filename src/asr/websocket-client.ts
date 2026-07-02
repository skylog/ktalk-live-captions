import {
  assertLocalAsrWsUrl,
  LOCAL_ASR_WS_URL,
  PROTOCOL_VERSION,
  type AudioChunkTransportMessage,
  type SessionEndTransportMessage,
  type SessionStartTransportMessage,
  type TranscriptFinalTransportMessage,
  type TranscriptPartialTransportMessage,
  type TransportMessage,
} from "../shared/protocol";

export interface RawTranscriptTransportMessage {
  type: "transcript.raw";
  timestamp: number;
  text: string;
  raw: string;
  sessionId: string | null;
  meetingId: string | null;
}

export type IncomingTranscriptMessage =
  | TranscriptPartialTransportMessage
  | TranscriptFinalTransportMessage
  | RawTranscriptTransportMessage;

export interface WebSocketTransportClientOptions {
  url?: string;
  protocols?: string | string[];
  socketFactory?: (url: string, protocols?: string | string[]) => WebSocketLike;
  reconnectMaxAttempts?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (error: Event | Error) => void;
  onMessage?: (message: IncomingTranscriptMessage | unknown) => void;
  onTranscript?: (message: IncomingTranscriptMessage) => void;
}

export interface WebSocketTransportClient {
  readonly readyState: number;
  readonly isConnected: boolean;
  connect(): Promise<void>;
  send(message: TransportMessage): Promise<void>;
  sendSessionStart(message: SessionStartTransportMessage): Promise<void>;
  sendAudioChunk(message: AudioChunkTransportMessage): Promise<void>;
  sendSessionEnd(message: SessionEndTransportMessage): Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
}

interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: Event) => void): void;
  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: Event) => void): void;
}

export const DEFAULT_RECONNECT_MAX_ATTEMPTS = 5;
export const DEFAULT_RECONNECT_BASE_DELAY_MS = 400;
export const DEFAULT_RECONNECT_MAX_DELAY_MS = 4000;

export const LOCAL_ASR_RECONNECT_BUDGET = Object.freeze({
  maxAttempts: DEFAULT_RECONNECT_MAX_ATTEMPTS,
  baseDelayMs: DEFAULT_RECONNECT_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_RECONNECT_MAX_DELAY_MS,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTranscriptMessage(value: unknown): value is TranscriptPartialTransportMessage | TranscriptFinalTransportMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.type === "transcript.partial" || value.type === "transcript.final") &&
    typeof value.protocolVersion === "number" &&
    typeof value.sessionId === "string" &&
    typeof value.meetingId === "string" &&
    typeof value.timestamp === "number" &&
    typeof value.text === "string" &&
    (typeof value.confidence === "number" || value.confidence === null)
  );
}

function normalizeTranscriptMessage(data: unknown): IncomingTranscriptMessage | null {
  if (isTranscriptMessage(data)) {
    return data;
  }

  if (typeof data === "string") {
    const parsed = tryParseJson(data);
    if (isTranscriptMessage(parsed)) {
      return parsed;
    }

    return {
      type: "transcript.raw",
      timestamp: Date.now(),
      text: data,
      raw: data,
      sessionId: null,
      meetingId: null,
    };
  }

  if (isRecord(data) && typeof data.text === "string") {
    const raw = safeStringify(data);
    return {
      type: "transcript.raw",
      timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
      text: data.text,
      raw,
      sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
      meetingId: typeof data.meetingId === "string" ? data.meetingId : null,
    };
  }

  return null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createSocket(
  url: string,
  protocols?: string | string[],
  factory?: (url: string, protocols?: string | string[]) => WebSocketLike,
): WebSocketLike {
  return factory ? factory(url, protocols) : protocols ? new WebSocket(url, protocols) : new WebSocket(url);
}

function cloneSessionStart(message: SessionStartTransportMessage): SessionStartTransportMessage {
  return { ...message };
}

export class WebSocketTransport implements WebSocketTransportClient {
  private readonly url: string;

  private readonly protocols?: string | string[];

  private readonly socketFactory?: (url: string, protocols?: string | string[]) => WebSocketLike;

  private readonly reconnectMaxAttempts: number;

  private readonly reconnectBaseDelayMs: number;

  private readonly reconnectMaxDelayMs: number;

  private readonly onOpen?: () => void;

  private readonly onClose?: (event: CloseEvent) => void;

  private readonly onError?: (error: Event | Error) => void;

  private readonly onMessage?: (message: IncomingTranscriptMessage | unknown) => void;

  private readonly onTranscript?: (message: IncomingTranscriptMessage) => void;

  private socket: WebSocketLike | null = null;

  private connectPromise: Promise<void> | null = null;

  private connectResolve: (() => void) | null = null;

  private connectReject: ((error: Error) => void) | null = null;

  private closeRequested = false;

  private open = false;

  private queue: string[] = [];

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private reconnectAttempts = 0;

  private sessionStartMessage: SessionStartTransportMessage | null = null;

  private sessionStartSentForSocket = false;

  constructor(options: WebSocketTransportClientOptions = {}) {
    this.url = assertLocalAsrWsUrl(options.url ?? LOCAL_ASR_WS_URL);
    this.protocols = options.protocols;
    this.socketFactory = options.socketFactory;
    this.reconnectMaxAttempts = options.reconnectMaxAttempts ?? DEFAULT_RECONNECT_MAX_ATTEMPTS;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    this.onOpen = options.onOpen;
    this.onClose = options.onClose;
    this.onError = options.onError;
    this.onMessage = options.onMessage;
    this.onTranscript = options.onTranscript;
  }

  get readyState(): number {
    return this.socket?.readyState ?? WebSocket.CLOSED;
  }

  get isConnected(): boolean {
    return this.open && this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.closeRequested = false;
    this.clearReconnectTimer();

    const pendingPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });
    this.connectPromise = pendingPromise;

    try {
      const socket = createSocket(this.url, this.protocols, this.socketFactory);
      this.socket = socket;

      const handleOpen = () => {
        this.open = true;
        this.sessionStartSentForSocket = false;
        this.reconnectAttempts = 0;
        this.clearReconnectTimer();
        this.onOpen?.();
        this.resolveConnect();
        void this.restoreSessionAndFlush();
      };

      const handleMessage = (event: Event) => {
        if (!("data" in event)) {
          return;
        }

        const messageEvent = event as MessageEvent<string>;
        const transcript = normalizeTranscriptMessage(messageEvent.data);
        if (transcript) {
          this.onTranscript?.(transcript);
          this.onMessage?.(transcript);
          return;
        }

        this.onMessage?.(messageEvent.data);
      };

      const handleError = (event: Event) => {
        this.onError?.(event);
        if (!this.open) {
          this.rejectConnect(new Error("WebSocket connection failed before opening."));
        }
      };

      const handleClose = (event: Event) => {
        const closeEvent = event as CloseEvent;
        const hadOpened = this.open;

        this.open = false;
        this.socket = null;
        this.sessionStartSentForSocket = false;
        this.onClose?.(closeEvent);

        if (!hadOpened) {
          this.rejectConnect(new Error(`WebSocket closed before opening (${closeEvent.code}).`));
          return;
        }

        if (!this.closeRequested) {
          this.onError?.(new Error(`WebSocket closed unexpectedly (${closeEvent.code}).`));
          this.scheduleReconnect();
        }
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);

      if (socket.readyState === WebSocket.OPEN) {
        handleOpen();
      }
    } catch (error) {
      this.rejectConnect(error instanceof Error ? error : new Error("WebSocket initialization failed."));
      throw error instanceof Error ? error : new Error("WebSocket initialization failed.");
    }

    return pendingPromise;
  }

  async send(message: TransportMessage): Promise<void> {
    if (message.type === "session.start") {
      await this.sendSessionStart(message);
      return;
    }

    if (this.closeRequested) {
      throw new Error("WebSocket transport is closing.");
    }

    const payload = JSON.stringify(message);
    this.queue.push(payload);
    await this.connect();
    this.flushQueue();
  }

  async sendSessionStart(message: SessionStartTransportMessage): Promise<void> {
    if (this.closeRequested) {
      throw new Error("WebSocket transport is closing.");
    }

    this.sessionStartMessage = cloneSessionStart(message);
    this.sessionStartSentForSocket = false;

    await this.connect();
    if (this.isConnected && !this.sessionStartSentForSocket) {
      await this.sendFrame(message);
      this.sessionStartSentForSocket = true;
    }

    this.flushQueue();
  }

  sendAudioChunk(message: AudioChunkTransportMessage): Promise<void> {
    return this.send(message);
  }

  sendSessionEnd(message: SessionEndTransportMessage): Promise<void> {
    return this.send(message);
  }

  async close(code = 1000, reason = "session-end"): Promise<void> {
    this.closeRequested = true;
    this.clearReconnectTimer();

    if (!this.socket) {
      this.resolveConnect();
      this.sessionStartMessage = null;
      this.queue = [];
      return;
    }

    const socket = this.socket;
    try {
      socket.close(code, reason);
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error("WebSocket close failed."));
      throw error instanceof Error ? error : new Error("WebSocket close failed.");
    }

    await this.connectPromise?.catch(() => undefined);
    this.sessionStartMessage = null;
    this.sessionStartSentForSocket = false;
    this.queue = [];
  }

  private async restoreSessionAndFlush(): Promise<void> {
    if (!this.socket || !this.open) {
      return;
    }

    if (this.sessionStartMessage && !this.sessionStartSentForSocket) {
      try {
        await this.sendFrame(this.sessionStartMessage);
        this.sessionStartSentForSocket = true;
      } catch (error) {
        this.onError?.(error instanceof Error ? error : new Error("Session start send failed."));
        this.scheduleReconnect();
        return;
      }
    }

    this.flushQueue();
  }

  private async sendFrame(message: TransportMessage): Promise<void> {
    if (!this.socket || !this.open) {
      throw new Error("WebSocket transport is not connected.");
    }

    const payload = JSON.stringify(message);
    try {
      this.socket.send(payload);
    } catch (error) {
      throw error instanceof Error ? error : new Error("WebSocket send failed.");
    }
  }

  private flushQueue(): void {
    if (!this.socket || !this.open) {
      return;
    }

    while (this.queue.length > 0) {
      const payload = this.queue[0];
      try {
        this.socket.send(payload);
        this.queue.shift();
      } catch (error) {
        this.onError?.(error instanceof Error ? error : new Error("WebSocket send failed."));
        this.scheduleReconnect();
        return;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.closeRequested || this.reconnectTimer || !this.sessionStartMessage) {
      return;
    }

    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > this.reconnectMaxAttempts) {
      this.onError?.(new Error("WebSocket reconnect budget exhausted."));
      return;
    }

    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** Math.max(0, this.reconnectAttempts - 1),
      this.reconnectMaxDelayMs,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closeRequested || !this.sessionStartMessage) {
        return;
      }

      void this.connect().catch((error: unknown) => {
        this.onError?.(error instanceof Error ? error : new Error("WebSocket reconnect failed."));
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private resolveConnect(): void {
    if (this.connectResolve) {
      this.connectResolve();
    }

    this.connectResolve = null;
    this.connectReject = null;
    this.connectPromise = null;
  }

  private rejectConnect(error: Error): void {
    if (this.connectReject) {
      this.connectReject(error);
    }

    this.connectResolve = null;
    this.connectReject = null;
    this.connectPromise = null;
  }
}

export function createWebSocketTransportClient(
  options: WebSocketTransportClientOptions = {},
): WebSocketTransportClient {
  return new WebSocketTransport(options);
}

export { LOCAL_ASR_WS_URL, PROTOCOL_VERSION };
