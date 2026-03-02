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
};

interface Preferences {
  modelSize: "tiny" | "base" | "small";
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

export function modelPath(): string {
  const { modelSize } = getPreferenceValues<Preferences>();
  return join(supportDir(), `ggml-${modelSize}.bin`);
}

export function whisperBinPath(): string {
  return join(supportDir(), "whisper-cli");
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
// Chunked recording for real-time transcription
// ---------------------------------------------------------------------------

export interface ChunkedRecorder {
  process: ChildProcess;
  /** Flush current audio buffer to a WAV file and return its path */
  flush: () => Promise<string>;
  /** Stop recording entirely */
  stop: () => void;
}

/**
 * Start recording in chunks. Every time flush() is called, the current
 * audio segment is saved and a new segment begins.
 *
 * This streams raw PCM from ffmpeg's stdout. When flushed, the accumulated
 * buffer is written to a WAV file for Whisper to consume.
 */
export async function startChunkedRecording(): Promise<ChunkedRecorder> {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg not found. Install via: brew install ffmpeg");

  let buffer = Buffer.alloc(0);
  let chunkIndex = 0;

  // Stream raw PCM to stdout
  const proc = spawn(ffmpeg, [
    "-f",
    "avfoundation",
    "-i",
    ":default",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-f",
    "s16le",
    "-acodec",
    "pcm_s16le",
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

      // Write WAV file with proper header
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
// Transcription
// ---------------------------------------------------------------------------

export async function transcribe(audioPath: string): Promise<string> {
  const { language } = getPreferenceValues<Preferences>();
  const bin = whisperBinPath();
  const model = modelPath();

  if (!existsSync(bin)) throw new Error("whisper-cli not found. Run Setup first.");
  if (!existsSync(model)) throw new Error("Whisper model not found. Run Setup first.");

  return new Promise((resolve, reject) => {
    execFile(
      bin,
      [
        "-m",
        model,
        "-f",
        audioPath,
        "--no-timestamps",
        "-l",
        language === "auto" ? "auto" : language,
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
