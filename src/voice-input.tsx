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
  VadRecorder,
  isModelDownloaded,
  isWhisperInstalled,
  startVadRecording,
  transcribe,
} from "./lib/whisper";
import { refineWithOllama, isOllamaAvailable } from "./lib/ollama";
import { unlinkSync } from "fs";

type State = "checking" | "ready" | "recording" | "error" | "setup-needed";

export default function VoiceInput() {
  const [state, setState] = useState<State>("checking");
  const [transcript, setTranscript] = useState("");
  const [rawSegment, setRawSegment] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const recorderRef = useRef<VadRecorder | null>(null);
  const transcriptRef = useRef("");
  const ollamaAvailable = useRef(false);

  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  // ------------------------------------------------------------------
  // Check dependencies on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!isWhisperInstalled() || !isModelDownloaded()) {
      setState("setup-needed");
      return;
    }
    ollamaAvailable.current = isOllamaAvailable();
    setState("ready");
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
  // Process a speech segment (Whisper → Ollama)
  // ------------------------------------------------------------------
  async function processSpeechSegment(wavPath: string) {
    try {
      // Step 1: Whisper transcription
      const rawText = await transcribe(wavPath);

      // Clean up temp file
      try { unlinkSync(wavPath); } catch { /* ignore */ }

      if (!rawText) return;

      // Show raw result immediately
      setRawSegment(rawText);

      // Step 2: Ollama refinement (if available)
      let finalText = rawText;
      if (ollamaAvailable.current) {
        setIsRefining(true);
        finalText = await refineWithOllama(rawText, transcriptRef.current);
        setIsRefining(false);
      }

      // Append to transcript
      setTranscript((prev) => prev + (prev ? "" : "") + finalText);
      setRawSegment("");
    } catch (err) {
      console.error("Processing error:", err);
      // Clean up on error too
      try { unlinkSync(wavPath); } catch { /* ignore */ }
    }
  }

  // ------------------------------------------------------------------
  // Recording session management
  // ------------------------------------------------------------------
  async function startRecordingSession() {
    try {
      const recorder = await startVadRecording((wavPath) => {
        processSpeechSegment(wavPath);
      });
      recorderRef.current = recorder;
      setState("recording");
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function stopRecordingSession() {
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  async function handlePaste() {
    // Flush any remaining audio before pasting
    if (recorderRef.current) {
      const lastWav = await recorderRef.current.flush();
      if (lastWav) {
        await processSpeechSegment(lastWav);
      }
    }
    stopRecordingSession();

    const text = transcript.trim();
    if (!text) {
      await showHUD("テキストがありません");
      return;
    }
    await Clipboard.paste(text);
    await showHUD("ペーストしました");
  }

  async function handleCopy() {
    const text = transcript.trim();
    if (!text) {
      await showToast({ style: Toast.Style.Failure, title: "テキストがありません" });
      return;
    }
    await Clipboard.copy(text);
    await showHUD("コピーしました");
  }

  function handleClear() {
    setTranscript("");
    setRawSegment("");
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (state === "setup-needed") {
    return (
      <Detail
        markdown={
          "# セットアップが必要です\n\n" +
          "Whisper モデルまたはバイナリが見つかりません。\n\n" +
          "**Setup Whisper** コマンドを先に実行してください。"
        }
      />
    );
  }

  if (state === "error") {
    return (
      <Detail markdown={`# エラー\n\n\`\`\`\n${errorMsg}\n\`\`\``} />
    );
  }

  const statusIcon = state === "recording" ? "🎙" : "⏳";
  const statusLabel =
    state === "recording"
      ? "録音中... 話してください"
      : state === "ready"
        ? "起動中..."
        : "確認中...";

  const ollamaStatus = ollamaAvailable.current ? "✅ Ollama" : "⚠️ Ollama なし（生テキスト）";
  const refiningLabel = isRefining ? "\n\n_🔄 テキスト校正中..._" : "";
  const rawLabel = rawSegment && !isRefining ? `\n\n> 📝 ${rawSegment}` : "";

  const markdown = [
    `# ${statusIcon} ${statusLabel}`,
    `_${ollamaStatus} | VAD モード_`,
    "---",
    transcript || "_音声を待っています..._",
    rawLabel,
    refiningLabel,
  ].join("\n\n");

  return (
    <Detail
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action
            title="カーソル位置にペースト"
            shortcut={{ modifiers: [], key: "return" }}
            onAction={handlePaste}
          />
          <Action
            title="クリップボードにコピー"
            shortcut={{ modifiers: ["cmd"], key: "c" }}
            onAction={handleCopy}
          />
          <Action
            title="クリア"
            shortcut={{ modifiers: ["cmd"], key: "k" }}
            onAction={handleClear}
          />
        </ActionPanel>
      }
    />
  );
}
