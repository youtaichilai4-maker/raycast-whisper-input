import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import {
  ChunkedRecorder,
  isModelDownloaded,
  isWhisperInstalled,
  startChunkedRecording,
  transcribe,
} from "./lib/whisper";
import { unlinkSync } from "fs";

// How often to flush audio buffer and transcribe (ms)
const FLUSH_INTERVAL_MS = 3000;

type State = "checking" | "ready" | "recording" | "error" | "setup-needed";

export default function VoiceInput() {
  const [state, setState] = useState<State>("checking");
  const [transcript, setTranscript] = useState("");
  const [partialText, setPartialText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isTranscribingRef = useRef(false);

  // ------------------------------------------------------------------
  // Check dependencies on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!isWhisperInstalled() || !isModelDownloaded()) {
      setState("setup-needed");
      return;
    }
    setState("ready");
    // Auto-start recording
    startRecordingSession();
  }, []);

  // ------------------------------------------------------------------
  // Cleanup on unmount
  // ------------------------------------------------------------------
  useEffect(() => {
    return () => {
      stopRecordingSession();
    };
  }, []);

  // ------------------------------------------------------------------
  // Recording session management
  // ------------------------------------------------------------------
  async function startRecordingSession() {
    try {
      const recorder = await startChunkedRecording();
      recorderRef.current = recorder;
      setState("recording");

      // Periodically flush and transcribe
      intervalRef.current = setInterval(async () => {
        if (isTranscribingRef.current) return;
        isTranscribingRef.current = true;

        try {
          const wavPath = await recorder.flush();
          if (!wavPath) {
            isTranscribingRef.current = false;
            return;
          }

          const text = await transcribe(wavPath);
          if (text) {
            setTranscript((prev) => prev + (prev ? " " : "") + text);
            setPartialText("");
          }

          // Clean up temp file
          try {
            unlinkSync(wavPath);
          } catch {
            // ignore
          }
        } catch (err) {
          console.error("Transcription error:", err);
        } finally {
          isTranscribingRef.current = false;
        }
      }, FLUSH_INTERVAL_MS);
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function stopRecordingSession() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  async function handlePaste() {
    stopRecordingSession();
    const text = transcript.trim();
    if (!text) {
      await showHUD("No text to paste");
      return;
    }
    await Clipboard.paste(text);
    await showHUD("Pasted!");
  }

  async function handleCopy() {
    const text = transcript.trim();
    if (!text) {
      await showToast({ style: Toast.Style.Failure, title: "No text to copy" });
      return;
    }
    await Clipboard.copy(text);
    await showHUD("Copied!");
  }

  function handleClear() {
    setTranscript("");
    setPartialText("");
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (state === "setup-needed") {
    return (
      <Detail
        markdown={
          "# Setup Required\n\n" +
          "Whisper model or binary not found.\n\n" +
          "Please run the **Setup Whisper** command first."
        }
      />
    );
  }

  if (state === "error") {
    return (
      <Detail
        markdown={`# Error\n\n\`\`\`\n${errorMsg}\n\`\`\``}
      />
    );
  }

  const displayText = transcript + (partialText ? ` _${partialText}_` : "");
  const statusIcon = state === "recording" ? "🎙" : "⏳";
  const statusLabel =
    state === "recording"
      ? "Recording... Speak now."
      : state === "ready"
        ? "Starting..."
        : "Checking...";

  const markdown = `# ${statusIcon} ${statusLabel}\n\n---\n\n${displayText || "_Waiting for speech..._"}`;

  return (
    <Detail
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action
            title="Paste at Cursor"
            shortcut={{ modifiers: [], key: "return" }}
            onAction={handlePaste}
          />
          <Action
            title="Copy to Clipboard"
            shortcut={{ modifiers: ["cmd"], key: "c" }}
            onAction={handleCopy}
          />
          <Action
            title="Clear"
            shortcut={{ modifiers: ["cmd"], key: "k" }}
            onAction={handleClear}
          />
        </ActionPanel>
      }
    />
  );
}
