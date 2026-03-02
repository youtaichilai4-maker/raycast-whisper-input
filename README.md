# Whisper Voice Input for Raycast

Real-time voice-to-text input using local Whisper. Speak and see text appear instantly, then paste it anywhere.

## Features

- Real-time transcription preview as you speak
- Fully local & offline (no data sent to cloud)
- Paste text at cursor position in any app
- Japanese language support
- Configurable Whisper model size (tiny/base/small)

## Prerequisites

- macOS (Apple Silicon recommended)
- [Raycast](https://raycast.com)
- [ffmpeg](https://ffmpeg.org/) — `brew install ffmpeg`
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — see build instructions below

## Setup

### 1. Install ffmpeg

```bash
brew install ffmpeg
```

### 2. Build whisper-cli

```bash
brew install cmake
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build && cmake --build build --config Release
```

### 3. Install the extension

```bash
git clone https://github.com/yutaakase/raycast-whisper-input
cd raycast-whisper-input
npm install
npm run dev
```

### 4. Run Setup command

Open Raycast and run **Setup Whisper** to:
- Verify dependencies (ffmpeg, whisper-cli)
- Download the Whisper model
- Copy the whisper-cli binary to the extension's support directory

## Usage

1. Open Raycast
2. Search for **Voice Input**
3. Recording starts automatically
4. Speak — text appears in real-time
5. Press **Enter** to paste at cursor, or **Esc** to cancel

## Commands

| Command | Description |
|---|---|
| Voice Input | Start real-time voice input |
| Setup Whisper | Download model and verify dependencies |

## Preferences

| Setting | Description | Default |
|---|---|---|
| Whisper Model | Model size (tiny/base/small) | tiny |
| Language | Recognition language | Japanese |
| ffmpeg Path | Custom ffmpeg path | Auto-detect |

## Architecture

```
Microphone → ffmpeg (avfoundation, 16kHz mono)
  → PCM buffer (Node.js)
  → Flush every 3s → WAV file
  → whisper-cli → transcribed text
  → React state → live preview
  → Enter → Clipboard.paste()
```

## License

MIT
