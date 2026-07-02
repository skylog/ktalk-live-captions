import { createPcmEncoder, type PcmChunk, type PcmEncoder } from "./pcm-encoder";

export type AudioCaptureInput = MediaStream | MediaStreamTrack;

export type AudioCaptureState = "idle" | "starting" | "running" | "stopping" | "stopped" | "error";

export interface AudioCaptureOptions {
  input: AudioCaptureInput;
  targetSampleRate?: number;
  chunkDurationMs?: number;
  stopSourceTracksOnStop?: boolean;
  onChunk: (chunk: PcmChunk) => void;
  onError?: (error: Error) => void;
  onStateChange?: (state: AudioCaptureState) => void;
}

export interface AudioCapture {
  readonly state: AudioCaptureState;
  readonly sampleRate: number | null;
  readonly channels: number;
  start(): Promise<void>;
  stop(reason?: string): Promise<void>;
  dispose(): Promise<void>;
}

function isAudioTrack(track: MediaStreamTrack): boolean {
  return track.kind === "audio";
}

function toMediaStream(input: AudioCaptureInput): MediaStream {
  if (input instanceof MediaStream) {
    return input;
  }

  if (!isAudioTrack(input)) {
    throw new Error("Audio capture requires an audio MediaStreamTrack.");
  }

  return new MediaStream([input]);
}

function mixDownToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return new Float32Array(buffer.getChannelData(0));
  }

  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const channelData = buffer.getChannelData(channel);
    for (let index = 0; index < buffer.length; index += 1) {
      mono[index] += channelData[index] / buffer.numberOfChannels;
    }
  }

  return mono;
}

function reportError(onError: ((error: Error) => void) | undefined, error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Audio capture failed.");
  onError?.(normalized);
}

function createContext(sampleRate?: number): AudioContext {
  try {
    return sampleRate ? new AudioContext({ sampleRate }) : new AudioContext();
  } catch {
    return new AudioContext();
  }
}

export class BrowserAudioCapture implements AudioCapture {
  private readonly input: MediaStream;

  private readonly targetSampleRate: number;

  private readonly chunkDurationMs: number;

  private readonly stopSourceTracksOnStop: boolean;

  private readonly onChunk: (chunk: PcmChunk) => void;

  private readonly onError?: (error: Error) => void;

  private readonly onStateChange?: (state: AudioCaptureState) => void;

  private currentState: AudioCaptureState = "idle";

  private audioContext: AudioContext | null = null;

  private sourceNode: MediaStreamAudioSourceNode | null = null;

  private processorNode: ScriptProcessorNode | null = null;

  private silentGainNode: GainNode | null = null;

  private encoder: PcmEncoder | null = null;

  constructor(options: AudioCaptureOptions) {
    this.input = toMediaStream(options.input);
    this.targetSampleRate = options.targetSampleRate ?? 16000;
    this.chunkDurationMs = options.chunkDurationMs ?? 100;
    this.stopSourceTracksOnStop = options.stopSourceTracksOnStop ?? false;
    this.onChunk = options.onChunk;
    this.onError = options.onError;
    this.onStateChange = options.onStateChange;
  }

  get state(): AudioCaptureState {
    return this.currentState;
  }

  get sampleRate(): number | null {
    return this.audioContext?.sampleRate ?? null;
  }

  get channels(): number {
    return 1;
  }

  private setState(nextState: AudioCaptureState): void {
    this.currentState = nextState;
    this.onStateChange?.(nextState);
  }

  async start(): Promise<void> {
    if (this.currentState === "running" || this.currentState === "starting") {
      return;
    }

    if (this.input.getAudioTracks().length === 0) {
      throw new Error("Audio capture input does not contain an audio track.");
    }

    this.setState("starting");

    try {
      const audioContext = createContext(this.targetSampleRate);
      await audioContext.resume();

      const inputSampleRate = audioContext.sampleRate;
      const encoder = createPcmEncoder({
        inputSampleRate,
        targetSampleRate: this.targetSampleRate,
        chunkDurationMs: this.chunkDurationMs,
        channels: 1,
      });

      const sourceNode = audioContext.createMediaStreamSource(this.input);
      const processorNode = audioContext.createScriptProcessor(1024, Math.max(1, this.input.getAudioTracks().length), 1);
      const silentGainNode = audioContext.createGain();
      silentGainNode.gain.value = 0;

      processorNode.onaudioprocess = (event) => {
        if (this.currentState !== "running") {
          return;
        }

        try {
          const mono = mixDownToMono(event.inputBuffer);
          const chunks = encoder.push(mono, Date.now());
          for (const chunk of chunks) {
            this.onChunk(chunk);
          }
        } catch (error) {
          this.setState("error");
          reportError(this.onError, error);
        }
      };

      sourceNode.connect(processorNode);
      processorNode.connect(silentGainNode);
      silentGainNode.connect(audioContext.destination);

      this.audioContext = audioContext;
      this.sourceNode = sourceNode;
      this.processorNode = processorNode;
      this.silentGainNode = silentGainNode;
      this.encoder = encoder;
      this.setState("running");
    } catch (error) {
      this.setState("error");
      reportError(this.onError, error);
      throw error instanceof Error ? error : new Error("Audio capture failed.");
    }
  }

  async stop(reason = "stopped"): Promise<void> {
    if (this.currentState === "idle" || this.currentState === "stopped") {
      return;
    }

    this.setState("stopping");

    try {
      if (this.encoder) {
        const chunks = this.encoder.flush(Date.now());
        for (const chunk of chunks) {
          this.onChunk(chunk);
        }
      }

      if (this.processorNode) {
        this.processorNode.onaudioprocess = null;
        this.processorNode.disconnect();
      }

      if (this.sourceNode) {
        this.sourceNode.disconnect();
      }

      if (this.silentGainNode) {
        this.silentGainNode.disconnect();
      }

      if (this.audioContext && this.audioContext.state !== "closed") {
        await this.audioContext.close();
      }

      if (this.stopSourceTracksOnStop) {
        for (const track of this.input.getAudioTracks()) {
          track.stop();
        }
      }

      this.audioContext = null;
      this.sourceNode = null;
      this.processorNode = null;
      this.silentGainNode = null;
      this.encoder = null;
      this.setState(reason === "error" ? "error" : "stopped");
    } catch (error) {
      this.setState("error");
      reportError(this.onError, error);
      throw error instanceof Error ? error : new Error("Audio capture stop failed.");
    }
  }

  async dispose(): Promise<void> {
    await this.stop("stopped");
  }
}

export function createAudioCapture(options: AudioCaptureOptions): AudioCapture {
  return new BrowserAudioCapture(options);
}
