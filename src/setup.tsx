import {
  Action,
  ActionPanel,
  Detail,
  showToast,
  Toast,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useState } from "react";
import {
  downloadModel,
  downloadWhisperBin,
  findFfmpeg,
  isModelDownloaded,
  isWhisperInstalled,
  modelPath,
  whisperBinPath,
} from "./lib/whisper";

interface SetupStatus {
  ffmpeg: "checking" | "ok" | "missing";
  ffmpegPath: string;
  whisperBin: "checking" | "ok" | "missing";
  model: "checking" | "ok" | "missing" | "downloading";
  modelProgress: number;
  error: string;
}

export default function Setup() {
  const [status, setStatus] = useState<SetupStatus>({
    ffmpeg: "checking",
    ffmpegPath: "",
    whisperBin: "checking",
    model: "checking",
    modelProgress: 0,
    error: "",
  });

  useEffect(() => {
    checkDependencies();
  }, []);

  async function checkDependencies() {
    // Check ffmpeg
    const ffmpeg = await findFfmpeg();
    setStatus((s) => ({
      ...s,
      ffmpeg: ffmpeg ? "ok" : "missing",
      ffmpegPath: ffmpeg ?? "",
    }));

    // Check whisper binary
    setStatus((s) => ({
      ...s,
      whisperBin: isWhisperInstalled() ? "ok" : "missing",
    }));

    // Check model
    setStatus((s) => ({
      ...s,
      model: isModelDownloaded() ? "ok" : "missing",
    }));
  }

  async function handleDownloadModel() {
    setStatus((s) => ({ ...s, model: "downloading", modelProgress: 0, error: "" }));

    try {
      await showToast({ style: Toast.Style.Animated, title: "Downloading model..." });
      await downloadModel((percent) => {
        setStatus((s) => ({ ...s, modelProgress: percent }));
      });
      setStatus((s) => ({ ...s, model: "ok" }));
      await showToast({ style: Toast.Style.Success, title: "Model downloaded!" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus((s) => ({ ...s, model: "missing", error: msg }));
      await showToast({ style: Toast.Style.Failure, title: "Download failed", message: msg });
    }
  }

  async function handleSetupWhisper() {
    try {
      await downloadWhisperBin();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus((s) => ({ ...s, error: msg }));
      await showToast({ style: Toast.Style.Failure, title: "Setup needed", message: msg });
    }
  }

  // Build status markdown
  const icon = (s: string) => {
    switch (s) {
      case "ok":
        return "✅";
      case "missing":
        return "❌";
      case "downloading":
        return "⏳";
      default:
        return "🔍";
    }
  };

  const md = `# Whisper Voice Input - Setup

## Dependencies

| Component | Status | Details |
|---|---|---|
| ffmpeg | ${icon(status.ffmpeg)} ${status.ffmpeg} | ${status.ffmpeg === "ok" ? status.ffmpegPath : "Install: \`brew install ffmpeg\`"} |
| whisper-cli | ${icon(status.whisperBin)} ${status.whisperBin} | ${status.whisperBin === "ok" ? whisperBinPath() : "See build instructions below"} |
| Whisper Model | ${icon(status.model)} ${status.model === "downloading" ? `downloading (${status.modelProgress}%)` : status.model} | ${status.model === "ok" ? modelPath() : "Click Download Model below"} |

${
  status.whisperBin === "missing"
    ? `## Build whisper-cli

\`\`\`bash
brew install cmake
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build && cmake --build build --config Release
cp build/bin/whisper-cli "${whisperBinPath()}"
\`\`\`
`
    : ""
}

${
  status.ffmpeg === "missing"
    ? `## Install ffmpeg

\`\`\`bash
brew install ffmpeg
\`\`\`
`
    : ""
}

${status.error ? `## Error\n\n\`\`\`\n${status.error}\n\`\`\`` : ""}

${status.ffmpeg === "ok" && status.whisperBin === "ok" && status.model === "ok" ? "## ✅ All Ready!\n\nYou can now use **Voice Input** command." : ""}
`;

  return (
    <Detail
      markdown={md}
      actions={
        <ActionPanel>
          {status.model === "missing" && (
            <Action title="Download Model" onAction={handleDownloadModel} />
          )}
          {status.whisperBin === "missing" && (
            <Action title="Setup Whisper Binary" onAction={handleSetupWhisper} />
          )}
          <Action title="Re-check Dependencies" onAction={checkDependencies} />
          <Action title="Open Preferences" onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    />
  );
}
