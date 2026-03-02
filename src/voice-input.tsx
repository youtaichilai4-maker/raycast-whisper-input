import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  popToRoot,
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

type Phase = "checking" | "recording" | "done" | "error" | "setup-needed";

export default function VoiceInput() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [transcript, setTranscript] = useState("");
  const [rawSegment, setRawSegment] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [useOllama, setUseOllama] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const recorderRef = useRef<VadRecorder | null>(null);
  const transcriptRef = useRef("");
  const useOllamaRef = useRef(false);

  // Keep refs in sync with state for use in callbacks
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { useOllamaRef.current = useOllama; }, [useOllama]);

  // ------------------------------------------------------------------
  // Check dependencies on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!isWhisperInstalled() || !isModelDownloaded()) {
      setPhase("setup-needed");
      return;
    }
    const hasOllama = isOllamaAvailable();
    setUseOllama(hasOllama);
    startRecordingSession();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopRecordingSession(); };
  }, []);

  // ------------------------------------------------------------------
  // Process a speech segment (Whisper → optional Ollama)
  // ------------------------------------------------------------------
  async function processSpeechSegment(wavPath: string) {
    try {
      const rawText = await transcribe(wavPath);
      try { unlinkSync(wavPath); } catch { /* ignore */ }
      if (!rawText) return;

      setRawSegment(rawText);

      let finalText = rawText;
      if (useOllamaRef.current) {
        setIsRefining(true);
        finalText = await refineWithOllama(rawText, transcriptRef.current);
        setIsRefining(false);
      }

      setTranscript((prev) => prev + (prev ? "" : "") + finalText);
      setRawSegment("");
    } catch (err) {
      console.error("Processing error:", err);
      try { unlinkSync(wavPath); } catch { /* ignore */ }
    }
  }

  // ------------------------------------------------------------------
  // Recording session
  // ------------------------------------------------------------------
  async function startRecordingSession() {
    try {
      const recorder = await startVadRecording((wavPath) => {
        processSpeechSegment(wavPath);
      });
      recorderRef.current = recorder;
      setPhase("recording");
    } catch (err) {
      setPhase("error");
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
  // Enter → 録音終了して確定画面へ
  // ------------------------------------------------------------------
  async function handleFinishRecording() {
    if (recorderRef.current) {
      const lastWav = await recorderRef.current.flush();
      if (lastWav) {
        await processSpeechSegment(lastWav);
      }
    }
    stopRecordingSession();
    setPhase("done");
  }

  // ------------------------------------------------------------------
  // 確定画面のアクション
  // ------------------------------------------------------------------
  async function handlePaste() {
    const text = transcript.trim();
    if (!text) {
      await showHUD("テキストがありません");
      return;
    }
    await Clipboard.paste(text);
    await showHUD("ペーストしました");
    popToRoot();
  }

  async function handleCopy() {
    const text = transcript.trim();
    if (!text) {
      await showToast({ style: Toast.Style.Failure, title: "テキストがありません" });
      return;
    }
    await Clipboard.copy(text);
    await showHUD("コピーしました");
    popToRoot();
  }

  function handleClear() {
    setTranscript("");
    setRawSegment("");
  }

  function handleToggleOllama() {
    setUseOllama((prev) => !prev);
  }

  // ------------------------------------------------------------------
  // Render: セットアップ / エラー
  // ------------------------------------------------------------------
  if (phase === "setup-needed") {
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

  if (phase === "error") {
    return <Detail markdown={`# エラー\n\n\`\`\`\n${errorMsg}\n\`\`\``} />;
  }

  // ------------------------------------------------------------------
  // Render: 確定画面（録音終了後）
  // ------------------------------------------------------------------
  if (phase === "done") {
    const doneMarkdown = [
      "# 録音完了",
      "---",
      transcript || "_テキストがありません_",
    ].join("\n\n");

    return (
      <Detail
        markdown={doneMarkdown}
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
          </ActionPanel>
        }
      />
    );
  }

  // ------------------------------------------------------------------
  // Render: 録音中
  // ------------------------------------------------------------------
  const ollamaLabel = useOllama ? "✅ Ollama ON" : "⚫ Ollama OFF";
  const refiningLabel = isRefining ? "\n\n_🔄 テキスト校正中..._" : "";
  const rawLabel = rawSegment && !isRefining ? `\n\n> 📝 ${rawSegment}` : "";

  const markdown = [
    "# 🎙 録音中... 話してください",
    `_${ollamaLabel} | VAD モード | Enter で終了_`,
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
            title="録音を終了"
            shortcut={{ modifiers: [], key: "return" }}
            onAction={handleFinishRecording}
          />
          <Action
            title={useOllama ? "Ollama OFF にする" : "Ollama ON にする"}
            shortcut={{ modifiers: ["cmd"], key: "o" }}
            onAction={handleToggleOllama}
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
