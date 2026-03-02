/**
 * Transcription Filter – Quality Gate for STT Output
 * ====================================================
 * Filters out STT hallucinations, artefacts, and noise
 * before the text reaches the LLM pipeline.
 */

// ── Hallucination patterns (common Whisper artefacts) ────────────────
const HALLUCINATION_PATTERNS = [
  /thank you for watching/i,
  /thanks for watching/i,
  /please subscribe/i,
  /like and subscribe/i,
  /see you in the next/i,
  /don't forget to subscribe/i,
  /hit the bell/i,
  /leave a comment/i,
  /check out my/i,
  /follow me on/i,
  /link in the description/i,
  /sponsored by/i,
  /this video is/i,
  /in this video/i,
  /welcome back to/i,
  /hello everyone/i,
  /hey guys/i,
  /what's up guys/i,
  /subtitles by/i,
  /captions by/i,
  /translated by/i,
  /transcribed by/i,
  /copyright/i,
  /all rights reserved/i,
  /music playing/i,
  /\[music\]/i,
  /\[applause\]/i,
  /\[laughter\]/i,
  /\[silence\]/i,
  /\[inaudible\]/i,
  /♪/,
  /🎵/,
  /you$/i,
  /^you$/i,
  /^thank you\.?$/i,
  /^thanks\.?$/i,
  /^bye\.?$/i,
  /^goodbye\.?$/i,
  /^yes\.?$/i,
  /^no\.?$/i,
  /^okay\.?$/i,
  /^ok\.?$/i,
  /^um+\.?$/i,
  /^uh+\.?$/i,
  /^ah+\.?$/i,
  /^oh+\.?$/i,
  /^hm+\.?$/i,
  /^hmm+\.?$/i,
  /^mhm+\.?$/i,
  /^so\.?$/i,
  /^well\.?$/i,
  /^right\.?$/i,
  /^yeah\.?$/i,
];

const VALID_SINGLE_WORDS = new Set([
  "help", "error", "issue", "problem", "fix", "reset",
  "invoice", "payment", "order", "status", "login",
  "logout", "sync", "report", "escalate", "cancel",
  "navigate", "search", "update", "delete", "create",
  "approve", "reject", "submit", "save", "print",
  "export", "import", "refresh", "restart",
]);

const ARTEFACT_RE = /[^\w\s.,!?'"-]/g;
const BRACKET_RE = /\[.*?\]/g;
const MIN_ALPHA_CHARS = 3;
const MIN_WORDS_FOR_QUERY = 2;

// Duplicate debounce
let _lastText = "";
let _lastTextTime = 0;
const DUPLICATE_WINDOW_MS = 1500;

/**
 * Check if text is highly repetitive (e.g. "the the the the")
 */
function isRepetitive(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  const unique = new Set(words);
  return unique.size / words.length < 0.3;
}

/**
 * Filter a transcription for quality.
 * @param {string} text – Raw STT text
 * @returns {{ accepted: boolean, reason: string, filtered: string }}
 */
export function filterTranscription(text) {
  if (!text || typeof text !== "string") {
    return { accepted: false, reason: "empty", filtered: "" };
  }

  let cleaned = text.trim();

  // Remove bracketed annotations
  cleaned = cleaned.replace(BRACKET_RE, "").trim();

  // Remove artefact characters
  cleaned = cleaned.replace(ARTEFACT_RE, "").trim();

  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();

  if (!cleaned) {
    return { accepted: false, reason: "empty_after_clean", filtered: "" };
  }

  // Check minimum alpha characters
  const alphaCount = (cleaned.match(/[a-zA-Z]/g) || []).length;
  if (alphaCount < MIN_ALPHA_CHARS) {
    return { accepted: false, reason: "too_few_alpha", filtered: cleaned };
  }

  // Check hallucination patterns
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(cleaned)) {
      return { accepted: false, reason: "hallucination", filtered: cleaned };
    }
  }

  // Single-word check
  const words = cleaned.split(/\s+/);
  if (words.length === 1) {
    if (!VALID_SINGLE_WORDS.has(words[0].toLowerCase().replace(/[.,!?]/g, ""))) {
      return { accepted: false, reason: "single_word_invalid", filtered: cleaned };
    }
  }

  // Two-word gibberish check — reject very short phrases that aren't meaningful
  if (words.length >= 2 && words.length <= 3) {
    const totalAlpha = (cleaned.match(/[a-zA-Z]/g) || []).length;
    if (totalAlpha < 6) {
      return { accepted: false, reason: "too_short_phrase", filtered: cleaned };
    }
  }

  // Minimum word count for queries (single valid words already pass above)
  if (words.length < MIN_WORDS_FOR_QUERY && !VALID_SINGLE_WORDS.has(words[0]?.toLowerCase().replace(/[.,!?]/g, ""))) {
    return { accepted: false, reason: "below_min_words", filtered: cleaned };
  }

  // Repetitive check
  if (isRepetitive(cleaned)) {
    return { accepted: false, reason: "repetitive", filtered: cleaned };
  }

  // Duplicate debounce
  const now = Date.now();
  if (cleaned.toLowerCase() === _lastText.toLowerCase() && now - _lastTextTime < DUPLICATE_WINDOW_MS) {
    return { accepted: false, reason: "duplicate", filtered: cleaned };
  }
  _lastText = cleaned;
  _lastTextTime = now;

  return { accepted: true, reason: "ok", filtered: cleaned };
}
