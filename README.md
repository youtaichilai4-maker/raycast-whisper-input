# Whisper Voice Input for Raycast

ローカル Whisper を使ったリアルタイム音声テキスト入力。話すとその場で文字が表示され、どのアプリにもペーストできる。

## 特徴

- **VAD（無音検出）ベース**: 話し終わりを自動検出してチャンク分割。文の途中で切れない
- **Ollama で日本語校正**: 文脈を考慮して誤字脱字を修正、自然な日本語に整形
- **完全ローカル**: 音声データもテキスト処理もすべてローカル。ネットワーク不要
- **リアルタイムプレビュー**: 話しながら文字が表示される
- **どこでも入力**: 任意のアプリのカーソル位置にテキスト挿入

## 必要なもの

- macOS（Apple Silicon 推奨）
- [Raycast](https://raycast.com)
- [ffmpeg](https://ffmpeg.org/) — `brew install ffmpeg`
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — 下記ビルド手順参照
- [Ollama](https://ollama.com/)（任意）— テキスト校正に使用。なくても動作する

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

### 4. Ollama をセットアップ（任意）

```bash
brew install ollama
ollama pull gemma3:4b
ollama serve  # バックグラウンドで起動しておく
```

Ollama がなくても音声入力は動作するが、テキスト校正（誤字修正・句読点補完）が無効になる。

### 5. セットアップコマンドを実行

Raycast を開いて **Setup Whisper** を実行:
- 依存関係の確認（ffmpeg, whisper-cli, Ollama）
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
| Ollama Model | テキスト校正用モデル（空欄で無効） | gemma3:4b |

## アーキテクチャ

```
マイク → ffmpeg (avfoundation, 16kHz mono)
  → PCM バッファ (Node.js)
  → VAD: 無音検出で自動 flush → WAV ファイル
  → whisper-cli → 生テキスト（即座にプレビュー）
  → Ollama → 文脈考慮の校正テキスト
  → React state → ライブプレビュー
  → Enter → Clipboard.paste()
```

## ライセンス

MIT
