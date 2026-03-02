# Whisper Voice Input for Raycast

ローカル Whisper を使ったリアルタイム音声テキスト入力。話すとその場で文字が表示され、どのアプリにもペーストできる。

## 特徴

- 話しながらリアルタイムで文字起こしプレビュー
- 完全ローカル・オフライン動作（音声データは外部送信なし）
- 任意のアプリのカーソル位置にテキスト挿入
- 日本語対応
- Whisper モデルサイズ切り替え（tiny / base / small）

## 必要なもの

- macOS（Apple Silicon 推奨）
- [Raycast](https://raycast.com)
- [ffmpeg](https://ffmpeg.org/) — `brew install ffmpeg`
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — 下記ビルド手順参照

## セットアップ

### 1. ffmpeg をインストール

```bash
brew install ffmpeg
```

### 2. whisper-cli をビルド

```bash
brew install cmake
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build && cmake --build build --config Release
```

ビルド後、`build/bin/whisper-cli` が生成される。

### 3. 拡張機能をインストール

```bash
git clone https://github.com/youtaichilai4-maker/raycast-whisper-input
cd raycast-whisper-input
npm install
npm run dev
```

### 4. セットアップコマンドを実行

Raycast を開いて **Setup Whisper** を実行:
- 依存関係の確認（ffmpeg, whisper-cli）
- whisper-cli バイナリの配置
- Whisper モデルのダウンロード

## 使い方

1. Raycast を開く
2. **Voice Input** を検索して実行
3. 自動的に録音が開始される
4. 話す — リアルタイムでテキストが表示される
5. **Enter** でカーソル位置にペースト、**Esc** でキャンセル

## コマンド一覧

| コマンド | 説明 |
|---|---|
| Voice Input | リアルタイム音声入力を開始 |
| Setup Whisper | モデルダウンロードと依存関係の確認 |

## 設定項目

| 項目 | 説明 | デフォルト |
|---|---|---|
| Whisper Model | モデルサイズ（tiny/base/small） | tiny |
| Language | 認識言語 | Japanese |
| ffmpeg Path | ffmpeg のパス（空欄で自動検出） | 自動検出 |

## アーキテクチャ

```
マイク → ffmpeg (avfoundation, 16kHz mono)
  → PCM バッファ (Node.js)
  → 3秒ごとに flush → WAV ファイル
  → whisper-cli → テキスト
  → React state → ライブプレビュー
  → Enter → Clipboard.paste()
```

## ライセンス

MIT
