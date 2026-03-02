import { getPreferenceValues } from "@raycast/api";
import { execFile } from "child_process";
import { existsSync } from "fs";

interface Preferences {
  ollamaModel: string;
}

const OLLAMA_CANDIDATES = [
  "/opt/homebrew/bin/ollama",
  "/usr/local/bin/ollama",
  "/usr/bin/ollama",
];

function findOllama(): string | null {
  for (const candidate of OLLAMA_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function isOllamaAvailable(): boolean {
  return findOllama() !== null;
}

/**
 * Ollama で音声認識テキストを校正する。
 * これまでの文脈（previousContext）を考慮して、
 * 誤字脱字を修正し自然な日本語に整える。
 */
export async function refineWithOllama(
  rawText: string,
  previousContext: string,
): Promise<string> {
  const ollama = findOllama();
  if (!ollama) return rawText;

  const { ollamaModel } = getPreferenceValues<Preferences>();
  const model = ollamaModel || "gemma3:4b";

  const contextSection = previousContext
    ? `\n\n【これまでの文脈】\n${previousContext}`
    : "";

  const prompt = `あなたは音声認識テキストの校正アシスタントです。
以下のルールに厳密に従ってください：

1. 音声認識による誤字・脱字・誤変換を修正する
2. これまでの文脈を考慮して、文意が通るように修正する
3. 句読点（。、）を適切に補う
4. 元の意味や話者の意図を変えない
5. 不要な言い換えや追加はしない
6. 修正後のテキストのみを出力する（説明や注釈は不要）
${contextSection}

【音声認識テキスト】
${rawText}

【修正後】`;

  return new Promise((resolve) => {
    execFile(
      ollama,
      ["run", model, prompt],
      { timeout: 15000 },
      (err, stdout) => {
        if (err) {
          // Ollama 失敗時は生テキストをそのまま返す
          console.error("Ollama error:", err.message);
          resolve(rawText);
          return;
        }
        const refined = stdout.trim();
        resolve(refined || rawText);
      },
    );
  });
}
