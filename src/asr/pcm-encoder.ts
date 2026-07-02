export interface PcmChunk {
  chunkIndex: number;
  timestamp: number;
  sampleRate: number;
  channels: number;
  samples: Int16Array;
  pcmBase64: string;
  byteLength: number;
}

export interface PcmEncoderOptions {
  inputSampleRate: number;
  targetSampleRate?: number;
  chunkDurationMs?: number;
  channels?: number;
}

function clampToInt16(sample: number): number {
  if (!Number.isFinite(sample)) {
    return 0;
  }

  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
}

function float32ToInt16(samples: Float32Array): Int16Array {
  const encoded = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    encoded[index] = clampToInt16(samples[index]);
  }
  return encoded;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function int16ToBase64(samples: Int16Array): string {
  return toBase64(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
}

export class PcmEncoder {
  private readonly inputSampleRate: number;

  private readonly targetSampleRate: number;

  private readonly channels: number;

  private readonly chunkSize: number;

  private readonly resampleRatio: number;

  private sourceSamples: Float32Array = new Float32Array(0);

  private sourcePosition = 0;

  private pendingSamples: Float32Array = new Float32Array(0);

  private chunkIndex = 0;

  constructor(options: PcmEncoderOptions) {
    if (!Number.isFinite(options.inputSampleRate) || options.inputSampleRate <= 0) {
      throw new Error("inputSampleRate must be a positive number.");
    }

    if (options.targetSampleRate !== undefined && (!Number.isFinite(options.targetSampleRate) || options.targetSampleRate <= 0)) {
      throw new Error("targetSampleRate must be a positive number.");
    }

    this.inputSampleRate = options.inputSampleRate;
    this.targetSampleRate = options.targetSampleRate ?? 16000;
    this.channels = options.channels ?? 1;
    this.resampleRatio = this.inputSampleRate / this.targetSampleRate;

    const chunkDurationMs = options.chunkDurationMs ?? 100;
    this.chunkSize = Math.max(1, Math.round((this.targetSampleRate * chunkDurationMs) / 1000));
  }

  getSampleRate(): number {
    return this.targetSampleRate;
  }

  getChannels(): number {
    return this.channels;
  }

  reset(): void {
    this.sourceSamples = new Float32Array(0);
    this.sourcePosition = 0;
    this.pendingSamples = new Float32Array(0);
    this.chunkIndex = 0;
  }

  push(samples: Float32Array, timestamp = Date.now()): PcmChunk[] {
    this.sourceSamples = this.appendSamples(this.sourceSamples, samples);
    this.pendingSamples = this.appendSamples(this.pendingSamples, this.resamplePendingSamples(false));

    const chunks: PcmChunk[] = [];
    while (this.pendingSamples.length >= this.chunkSize) {
      const chunkSamples = this.pendingSamples.slice(0, this.chunkSize);
      this.pendingSamples = this.pendingSamples.slice(this.chunkSize);
      chunks.push(this.createChunk(chunkSamples, timestamp));
    }

    return chunks;
  }

  flush(timestamp = Date.now()): PcmChunk[] {
    const chunks: PcmChunk[] = [];
    this.pendingSamples = this.appendSamples(this.pendingSamples, this.resamplePendingSamples(true));

    if (this.pendingSamples.length > 0) {
      const padded = new Float32Array(this.chunkSize);
      padded.set(this.pendingSamples.slice(0, this.chunkSize), 0);
      chunks.push(this.createChunk(padded, timestamp));
    }

    this.reset();
    return chunks;
  }

  private appendSamples(left: Float32Array, right: Float32Array): Float32Array {
    if (left.length === 0) {
      return new Float32Array(right);
    }

    if (right.length === 0) {
      return new Float32Array(left);
    }

    const merged = new Float32Array(left.length + right.length);
    merged.set(left, 0);
    merged.set(right, left.length);
    return merged;
  }

  private resamplePendingSamples(includeTailPadding: boolean): Float32Array {
    if (this.sourceSamples.length === 0) {
      return new Float32Array(0);
    }

    const source = includeTailPadding ? this.appendTailSample(this.sourceSamples) : this.sourceSamples;
    const output: number[] = [];

    while (this.sourcePosition + 1 < source.length) {
      const leftIndex = Math.floor(this.sourcePosition);
      const rightIndex = leftIndex + 1;
      const fraction = this.sourcePosition - leftIndex;
      const left = source[leftIndex] ?? 0;
      const right = source[rightIndex] ?? left;
      output.push(left + (right - left) * fraction);
      this.sourcePosition += this.resampleRatio;
    }

    const consumed = Math.floor(this.sourcePosition);
    if (consumed > 0) {
      this.sourceSamples = source.slice(consumed);
      this.sourcePosition -= consumed;
    } else if (includeTailPadding) {
      this.sourceSamples = new Float32Array(0);
      this.sourcePosition = 0;
    }

    return new Float32Array(output);
  }

  private appendTailSample(samples: Float32Array): Float32Array {
    if (samples.length === 0) {
      return samples;
    }

    const padded = new Float32Array(samples.length + 1);
    padded.set(samples, 0);
    padded[padded.length - 1] = samples[samples.length - 1] ?? 0;
    return padded;
  }

  private createChunk(samples: Float32Array, timestamp: number): PcmChunk {
    const pcm16 = float32ToInt16(samples);
    const chunk: PcmChunk = {
      chunkIndex: this.chunkIndex,
      timestamp,
      sampleRate: this.targetSampleRate,
      channels: this.channels,
      samples: pcm16,
      pcmBase64: int16ToBase64(pcm16),
      byteLength: pcm16.byteLength,
    };

    this.chunkIndex += 1;
    return chunk;
  }
}

export function createPcmEncoder(options: PcmEncoderOptions): PcmEncoder {
  return new PcmEncoder(options);
}
