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
  isWhisperServerInstalled,
  ensureWhisperServer,
  stopWhisperServer,
  startVadRecording,
  transcribe,
} from "./lib/whisper";
import { unlinkSync } from "fs";

type Phase = "loading" | "recording" | "done" | "error" | "setup-needed";

export default function VoiceInput() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [transcript, setTranscript] = useState("");
  const [rawSegment, setRawSegment] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const recorderRef = useRef<VadRecorder | null>(null);

  useEffect(() => {
    if (!isWhisperInstalled() || !isModelDownloaded()) {
      setPhase("setup-needed");
      return;
    }
    // Start server (loads model into memory) then start recording
    initSession();
    return () => { stopRecordingSession(); };
  }, []);

  async function initSession() {
    try {
      if (isWhisperServerInstalled()) {
        await showToast({ style: Toast.Style.Animated, title: "モデル読み込み中..." });
        await ensureWhisperServer();
      }
      startRecordingSession();
    } catch (err) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function processSpeechSegment(wavPath: string) {
    try {
      const text = await transcribe(wavPath);
      try { unlinkSync(wavPath); } catch { /* ignore */ }
      if (!text) return;
      setRawSegment("");
      setTranscript((prev) => prev + (prev ? "" : "") + text);
    } catch (err) {
      console.error("Processing error:", err);
      try { unlinkSync(wavPath); } catch { /* ignore */ }
    }
  }

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

  async function handleFinishRecording() {
    if (recorderRef.current) {
      const lastWav = await recorderRef.current.flush();
      if (lastWav) await processSpeechSegment(lastWav);
    }
    stopRecordingSession();
    setPhase("done");
  }

  async function handlePaste() {
    const text = transcript.trim();
    if (!text) { await showHUD("テキストがありません"); return; }
    await Clipboard.paste(text);
    await showHUD("ペーストしました");
    popToRoot();
  }

  async function handleCopy() {
    const text = transcript.trim();
    if (!text) { await showToast({ style: Toast.Style.Failure, title: "テキストがありません" }); return; }
    await Clipboard.copy(text);
    await showHUD("コピーしました");
    popToRoot();
  }

  if (phase === "loading") {
    return <Detail markdown="# ⏳ モデル読み込み中...\n\n初回はモデルをメモリに展開するため少し時間がかかります。\n\n次回以降はすぐ使えます。" />;
  }

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

  if (phase === "done") {
    return (
      <Detail
        markdown={`# 録音完了\n\n---\n\n${transcript || "_テキストがありません_"}`}
        actions={
          <ActionPanel>
            <Action title="カーソル位置にペースト" shortcut={{ modifiers: [], key: "return" }} onAction={handlePaste} />
            <Action title="クリップボードにコピー" shortcut={{ modifiers: ["cmd"], key: "c" }} onAction={handleCopy} />
          </ActionPanel>
        }
      />
    );
  }

  return (
    <Detail
      markdown={[
        "# 🎙 録音中... 話してください",
        "_VAD モード | Enter で終了_",
        "---",
        transcript || "_音声を待っています..._",
      ].join("\n\n")}
      actions={
        <ActionPanel>
          <Action title="録音を終了" shortcut={{ modifiers: [], key: "return" }} onAction={handleFinishRecording} />
          <Action title="クリア" shortcut={{ modifiers: ["cmd"], key: "k" }} onAction={() => { setTranscript(""); setRawSegment(""); }} />
        </ActionPanel>
      }
    />
  );
}
