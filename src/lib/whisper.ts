import { execFile, spawn, ChildProcess } from "child_process";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { environment, getPreferenceValues } from "@raycast/api";
import { https } from "follow-redirects";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_URLS: Record<string, string> = {
  tiny: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin`,
  base: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`,
  small: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin`,
  medium: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin`,
  large: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin`,
};

interface Preferences {
  modelSize: "tiny" | "base" | "small" | "medium" | "large";
  language: string;
  ffmpegPath: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function supportDir(): string {
  const dir = join(environment.supportPath, "whisper");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const MODEL_FILENAMES: Record<string, string> = {
  large: "ggml-large-v3-turbo.bin",
  medium: "ggml-medium.bin",
  small: "ggml-small.bin",
  base: "ggml-base.bin",
  tiny: "ggml-tiny.bin",
};

/** Returns the best available model: preference first, then largest downloaded. */
export function modelPath(): string {
  const { modelSize } = getPreferenceValues<Preferences>();
  const dir = supportDir();

  // Use preference if that model exists
  const preferredFile = MODEL_FILENAMES[modelSize] ?? `ggml-${modelSize}.bin`;
  const preferredPath = join(dir, preferredFile);
  if (existsSync(preferredPath)) return preferredPath;

  // Fallback: use the best model that's actually downloaded
  for (const file of Object.values(MODEL_FILENAMES)) {
    const p = join(dir, file);
    if (existsSync(p)) return p;
  }

  return preferredPath;
}

export function whisperBinPath(): string {
  return join(supportDir(), "whisper-cli");
}

export function whisperServerBinPath(): string {
  return join(supportDir(), "whisper-server");
}

export function isWhisperServerInstalled(): boolean {
  return existsSync(whisperServerBinPath());
}

export function isModelDownloaded(): boolean {
  return existsSync(modelPath());
}

export function isWhisperInstalled(): boolean {
  return existsSync(whisperBinPath());
}

// ---------------------------------------------------------------------------
// ffmpeg detection
// ---------------------------------------------------------------------------

const FFMPEG_CANDIDATES = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
];

export async function findFfmpeg(): Promise<string | null> {
  const { ffmpegPath } = getPreferenceValues<Preferences>();
  if (ffmpegPath && existsSync(ffmpegPath)) return ffmpegPath;

  for (const candidate of FFMPEG_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

export async function downloadModel(
  onProgress?: (percent: number) => void,
): Promise<void> {
  const { modelSize } = getPreferenceValues<Preferences>();
  const url = MODEL_URLS[modelSize];
  if (!url) throw new Error(`Unknown model size: ${modelSize}`);

  const dest = modelPath();
  await downloadFile(url, dest, onProgress);
}

export async function downloadWhisperBin(
  onProgress?: (percent: number) => void,
): Promise<void> {
  // For now, we expect the user to build whisper-cli manually or we download
  // a prebuilt binary from the whisper.cpp releases.
  // TODO: Determine the correct release URL for macOS arm64 binary.
  const dest = whisperBinPath();
  if (existsSync(dest)) return;

  throw new Error(
    "whisper-cli binary not found. Please build whisper.cpp and place the binary at: " +
      dest +
      "\n\nBuild instructions:\n" +
      "  brew install cmake\n" +
      "  git clone https://github.com/ggml-org/whisper.cpp\n" +
      "  cd whisper.cpp && cmake -B build && cmake --build build --config Release\n" +
      "  cp build/bin/whisper-cli " +
      dest,
  );
}

function downloadFile(
  url: string,
  dest: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);

    https
      .get(url, (res) => {
        const total = parseInt(res.headers["content-length"] ?? "0", 10);
        let downloaded = 0;

        res.on("data", (chunk: Buffer) => {
          downloaded += chunk.length;
          if (total > 0 && onProgress) {
            onProgress(Math.round((downloaded / total) * 100));
          }
        });

        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (err) => {
        file.close();
        reject(err);
      });
  });
}

// ---------------------------------------------------------------------------
// Audio recording (ffmpeg)
// ---------------------------------------------------------------------------

export interface Recorder {
  process: ChildProcess;
  /** Stop recording and return the WAV file path */
  stop: () => Promise<string>;
}

/**
 * Start recording from the default macOS microphone using ffmpeg.
 * Outputs a WAV file (16kHz, mono, s16le) suitable for Whisper.
 */
export async function startRecording(): Promise<Recorder> {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg not found. Install via: brew install ffmpeg");

  const outPath = join(supportDir(), `recording-${Date.now()}.wav`);

  const proc = spawn(ffmpeg, [
    "-f",
    "avfoundation",
    "-i",
    ":default",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-sample_fmt",
    "s16",
    "-y",
    outPath,
  ]);

  return {
    process: proc,
    stop: () =>
      new Promise((resolve, reject) => {
        proc.on("close", () => resolve(outPath));
        proc.on("error", reject);
        // Send 'q' to ffmpeg to gracefully stop
        proc.stdin?.write("q");
      }),
  };
}

// ---------------------------------------------------------------------------
// VAD-based recording for real-time transcription
// ---------------------------------------------------------------------------

export interface VadRecorder {
  process: ChildProcess;
  /** Force flush current buffer (e.g. on stop). Returns "" if empty. */
  flush: () => Promise<string>;
  /** Stop recording entirely */
  stop: () => void;
}

// VAD parameters
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // s16le
/** RMS threshold to consider "speech" (0-32768 range). Adjust if needed. */
const SPEECH_THRESHOLD = 500;
/** How many ms of silence before we consider speech ended */
const SILENCE_DURATION_MS = 800;
/** Minimum speech duration to bother transcribing (ms) */
const MIN_SPEECH_MS = 500;
/** Maximum buffer duration before forced flush (ms) — prevents infinite accumulation */
const MAX_BUFFER_MS = 30000;
/** How often to check VAD state (ms) */
const VAD_CHECK_INTERVAL_MS = 100;

/**
 * Start VAD-based recording. Instead of fixed intervals, this monitors
 * audio energy and flushes when a pause in speech is detected.
 *
 * onSpeechEnd is called with the WAV file path whenever a speech segment ends.
 */
export async function startVadRecording(
  onSpeechEnd: (wavPath: string) => void,
): Promise<VadRecorder> {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg not found. Install via: brew install ffmpeg");

  let speechBuffer = Buffer.alloc(0);
  let isSpeaking = false;
  let silenceSince = 0;
  let chunkIndex = 0;
  let lastDataTime = Date.now();

  // Stream raw PCM to stdout
  const proc = spawn(ffmpeg, [
    "-f", "avfoundation",
    "-i", ":default",
    "-ar", String(SAMPLE_RATE),
    "-ac", "1",
    "-f", "s16le",
    "-acodec", "pcm_s16le",
    "pipe:1",
  ], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdout?.on("data", (chunk: Buffer) => {
    speechBuffer = Buffer.concat([speechBuffer, chunk]);
    lastDataTime = Date.now();
  });

  function calculateRms(pcm: Buffer): number {
    if (pcm.length < BYTES_PER_SAMPLE) return 0;
    let sumSq = 0;
    const samples = pcm.length / BYTES_PER_SAMPLE;
    for (let i = 0; i < pcm.length; i += BYTES_PER_SAMPLE) {
      const sample = pcm.readInt16LE(i);
      sumSq += sample * sample;
    }
    return Math.sqrt(sumSq / samples);
  }

  function bufferDurationMs(): number {
    return (speechBuffer.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;
  }

  async function flushBuffer(): Promise<string> {
    const pcmData = speechBuffer;
    speechBuffer = Buffer.alloc(0);
    isSpeaking = false;
    silenceSince = 0;

    if (pcmData.length === 0) return "";
    if (bufferDurationMsFor(pcmData) < MIN_SPEECH_MS) return "";

    chunkIndex++;
    const wavPath = join(supportDir(), `chunk-${chunkIndex}.wav`);
    const wavHeader = createWavHeader(pcmData.length, SAMPLE_RATE, 1, 16);
    const wavBuffer = Buffer.concat([wavHeader, pcmData]);

    const { writeFileSync } = await import("fs");
    writeFileSync(wavPath, wavBuffer);
    return wavPath;
  }

  function bufferDurationMsFor(buf: Buffer): number {
    return (buf.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;
  }

  // VAD check loop
  const vadInterval = setInterval(() => {
    // Analyze the most recent ~100ms of audio for energy
    const recentBytes = SAMPLE_RATE * BYTES_PER_SAMPLE * (VAD_CHECK_INTERVAL_MS / 1000);
    const recentStart = Math.max(0, speechBuffer.length - recentBytes);
    const recentChunk = speechBuffer.subarray(recentStart);
    const rms = calculateRms(recentChunk);

    const now = Date.now();

    if (rms >= SPEECH_THRESHOLD) {
      isSpeaking = true;
      silenceSince = 0;
    } else if (isSpeaking) {
      if (silenceSince === 0) {
        silenceSince = now;
      } else if (now - silenceSince >= SILENCE_DURATION_MS) {
        // Speech ended — flush
        flushBuffer().then((wavPath) => {
          if (wavPath) onSpeechEnd(wavPath);
        });
      }
    }

    // Force flush if buffer is too long
    if (bufferDurationMs() >= MAX_BUFFER_MS && isSpeaking) {
      flushBuffer().then((wavPath) => {
        if (wavPath) onSpeechEnd(wavPath);
      });
    }
  }, VAD_CHECK_INTERVAL_MS);

  return {
    process: proc,
    flush: flushBuffer,
    stop: () => {
      clearInterval(vadInterval);
      proc.stdin?.write("q");
      proc.kill("SIGTERM");
    },
  };
}

// Keep the old chunked recorder for fallback
export interface ChunkedRecorder {
  process: ChildProcess;
  flush: () => Promise<string>;
  stop: () => void;
}

export async function startChunkedRecording(): Promise<ChunkedRecorder> {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg not found. Install via: brew install ffmpeg");

  let buffer = Buffer.alloc(0);
  let chunkIndex = 0;

  const proc = spawn(ffmpeg, [
    "-f", "avfoundation",
    "-i", ":default",
    "-ar", "16000",
    "-ac", "1",
    "-f", "s16le",
    "-acodec", "pcm_s16le",
    "pipe:1",
  ], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdout?.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
  });

  return {
    process: proc,
    flush: async () => {
      const pcmData = buffer;
      buffer = Buffer.alloc(0);
      chunkIndex++;

      if (pcmData.length === 0) return "";

      const wavPath = join(supportDir(), `chunk-${chunkIndex}.wav`);
      const wavHeader = createWavHeader(pcmData.length, 16000, 1, 16);
      const wavBuffer = Buffer.concat([wavHeader, pcmData]);

      const { writeFileSync } = await import("fs");
      writeFileSync(wavPath, wavBuffer);
      return wavPath;
    },
    stop: () => {
      proc.stdin?.write("q");
      proc.kill("SIGTERM");
    },
  };
}

function createWavHeader(
  dataSize: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return header;
}

// ---------------------------------------------------------------------------
// Whisper Server (persistent process — model stays in memory)
// ---------------------------------------------------------------------------

const WHISPER_SERVER_PORT = 18080;
const WHISPER_SERVER_URL = `http://127.0.0.1:${WHISPER_SERVER_PORT}`;

let serverProcess: ChildProcess | null = null;

/** Start whisper-server if not already running. Model is loaded once. */
export async function ensureWhisperServer(): Promise<void> {
  // Already running?
  if (await isServerHealthy()) return;

  const serverBin = whisperServerBinPath();
  const model = modelPath();
  const { language } = getPreferenceValues<Preferences>();

  if (!existsSync(serverBin)) throw new Error("whisper-server not found. Run Setup first.");
  if (!existsSync(model)) throw new Error("Whisper model not found. Run Setup first.");

  // Kill any stale process
  stopWhisperServer();

  serverProcess = spawn(serverBin, [
    "-m", model,
    "-l", language === "auto" ? "auto" : language,
    "--port", String(WHISPER_SERVER_PORT),
    "--no-timestamps",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  serverProcess.unref();

  // Wait for server to be ready (up to 30s for large model load)
  const startTime = Date.now();
  while (Date.now() - startTime < 30000) {
    if (await isServerHealthy()) return;
    await sleep(500);
  }
  throw new Error("Whisper server failed to start within 30s");
}

export function stopWhisperServer(): void {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}

async function isServerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${WHISPER_SERVER_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Transcription (via server HTTP API — fast, model already in memory)
// ---------------------------------------------------------------------------

export async function transcribe(audioPath: string): Promise<string> {
  const { language } = getPreferenceValues<Preferences>();

  // Read WAV file
  const { readFileSync } = await import("fs");
  const wavData = readFileSync(audioPath);

  // Build multipart form data manually (Node.js 18+ fetch)
  const boundary = "----WhisperBoundary" + Date.now();
  const langField = language === "auto" ? "auto" : language;

  const parts: Buffer[] = [];
  // file field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`
  ));
  parts.push(wavData);
  parts.push(Buffer.from("\r\n"));
  // response_format field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`
  ));
  // language field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${langField}\r\n`
  ));
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const res = await fetch(`${WHISPER_SERVER_URL}/inference`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    // Fallback to CLI if server fails
    return transcribeCli(audioPath);
  }

  const text = await res.text();
  return text.trim();
}

/** Fallback: CLI-based transcription (slow but reliable) */
async function transcribeCli(audioPath: string): Promise<string> {
  const { language } = getPreferenceValues<Preferences>();
  const bin = whisperBinPath();
  const model = modelPath();

  return new Promise((resolve, reject) => {
    execFile(
      bin,
      [
        "-m", model,
        "-f", audioPath,
        "--no-timestamps",
        "-l", language === "auto" ? "auto" : language,
        "--output-txt",
        "--no-prints",
      ],
      { timeout: 30000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Whisper error: ${stderr || err.message}`));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}
