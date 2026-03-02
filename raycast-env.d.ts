/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Whisper Model - Choose the Whisper model size. Smaller = faster, larger = more accurate. */
  "modelSize": "tiny" | "base" | "small",
  /** Language - Recognition language */
  "language": "ja" | "en" | "auto",
  /** ffmpeg Path - Path to ffmpeg binary. Leave empty to auto-detect. */
  "ffmpegPath": string,
  /** Ollama Model - Ollama model for text refinement. Leave empty to disable. */
  "ollamaModel": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `voice-input` command */
  export type VoiceInput = ExtensionPreferences & {}
  /** Preferences accessible in the `setup` command */
  export type Setup = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `voice-input` command */
  export type VoiceInput = {}
  /** Arguments passed to the `setup` command */
  export type Setup = {}
}

