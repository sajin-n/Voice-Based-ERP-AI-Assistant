/**
 * Groq Services – STT / LLM / TTS API Wrappers
 * ===============================================
 * Wraps the Groq SDK for the three core voice-AI operations:
 *   1. transcribeAudio  – Whisper STT
 *   2. chat              – LLM conversational completion (with tools)
 *   3. textToSpeech      – Orpheus TTS (200-char chunked)
 */

import "dotenv/config";
import Groq from "groq-sdk";
import { buildSystemPrompt, tools, callTool } from "./erpConfig.js";
import { filterTranscription } from "./transcriptionFilter.js";
import fs from "fs";
import path from "path";
import os from "os";

const groq = new Groq(); // reads GROQ_API_KEY from env

// Tool calling loop limit
const MAX_TOOL_CALLS = 8;

// ── 1. Speech-to-Text ────────────────────────────────────────────────

/**
 * Transcribe an audio buffer using Groq Whisper.
 * @param {Buffer} audioBuffer – raw audio bytes (webm/opus)
 * @returns {Promise<{text: string|null, filtered: boolean, reason: string}>}
 */
export async function transcribeAudio(audioBuffer) {
  // Write buffer to a temp file — Groq SDK needs a file-like object
  const tmpPath = path.join(os.tmpdir(), `aria_stt_${Date.now()}.webm`);
  fs.writeFileSync(tmpPath, audioBuffer);

  try {
    const result = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-large-v3-turbo",
      language: "en",
      response_format: "verbose_json",
    });

    const rawText = result.text || "";
    console.log(`[STT] Raw: "${rawText}"`);

    // Quality filter
    const { accepted, reason, filtered } = filterTranscription(rawText);
    if (!accepted) {
      console.log(`[STT] Filtered out (${reason}): "${filtered}"`);
      return { text: null, filtered: true, reason };
    }

    return { text: filtered, filtered: false, reason: "ok" };
  } catch (err) {
    console.error("[STT] Groq transcription error:", err.message);
    return { text: null, filtered: true, reason: `stt_error: ${err.message}` };
  } finally {
    // Cleanup temp file
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
  }
}

// ── 2. LLM Chat Completion ───────────────────────────────────────────

/**
 * Run a single chat completion — no tool calls, pure conversational guidance.
 *
 * @param {Array} messages – Conversation messages array
 * @param {import('./dialogueManager.js').SessionState} session
 * @param {function} [onEvent] – Optional callback for status events
 * @returns {Promise<{reply: string, messages: Array}>}
 */
/**
 * Clean text for voice output — strips markdown, code blocks, and formatting.
 */
function cleanForVoice(text) {
  let reply = text || "";
  reply = reply.replace(/<function=\w+>[\s\S]*?<\/function>/g, "").trim();
  reply = reply.replace(/<\|.*?\|>/g, "").trim();
  reply = reply.replace(/\*\*(.*?)\*\*/g, "$1"); // bold
  reply = reply.replace(/\*(.*?)\*/g, "$1"); // italic
  reply = reply.replace(/#{1,6}\s*/g, ""); // headers
  reply = reply.replace(/```[\s\S]*?```/g, "").trim(); // code blocks
  reply = reply.replace(/`([^`]+)`/g, "$1"); // inline code
  reply = reply.replace(/(\d+)\.\s+/g, "Step $1: "); // numbered lists
  return reply.trim();
}

export async function chat(messages, session, onEvent) {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages,
    temperature: 0.6,
    max_completion_tokens: 1024,
  });

  const assistantMsg = response.choices[0].message;
  messages.push(assistantMsg);

  let reply = cleanForVoice(assistantMsg.content || "");

  // Fallback for empty replies
  if (!reply || reply.length < 10) {
    reply = "I'm sorry, I wasn't able to generate a complete response. Could you please repeat your question or describe the issue in a different way?";
  }

  console.log(`[LLM] Reply: "${reply.slice(0, 120)}..."`);
  return { reply, messages };
}

/**
 * Chat with tool calling support.
 * Runs tool calls in a loop until the LLM provides a final response.
 */
export async function chatWithTools(messages, session, onEvent) {
  let toolCallCount = 0;
  let lastReply = null;

  while (toolCallCount < MAX_TOOL_CALLS) {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.6,
      max_completion_tokens: 1024,
      tools: tools,
    });

    const assistantMsg = response.choices[0].message;
    messages.push(assistantMsg);

    // Check if the LLM wants to call a tool
    const toolCalls = assistantMsg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // No more tool calls - this is the final response
      lastReply = cleanForVoice(assistantMsg.content || "");
      break;
    }

    // Execute tool calls
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);
      
      console.log(`[LLM] Tool call: ${toolName}`, toolArgs);
      if (onEvent) onEvent("tool_call", { name: toolName, args: toolArgs });

      try {
        const result = await callTool(toolName, toolArgs, session);
        console.log(`[LLM] Tool result:`, result);

        // Add tool result to messages
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });

        if (onEvent) onEvent("tool_result", { name: toolName, result });
      } catch (err) {
        console.error(`[LLM] Tool error: ${toolName}`, err);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: err.message })
        });
      }
    }

    toolCallCount++;
  }

  // Fallback for empty replies
  if (!lastReply || lastReply.length < 10) {
    lastReply = "I'm sorry, I wasn't able to generate a complete response. Could you please repeat your question or describe the issue in a different way?";
  }

  console.log(`[LLM+Tools] Final reply: "${lastReply.slice(0, 120)}..."`);
  return { reply: lastReply, messages };
}

// ── 3. Text-to-Speech ────────────────────────────────────────────────

/**
 * Split text into chunks of ≤ maxLen characters at sentence boundaries.
 */
function splitTextForTTS(text, maxLen = 190) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Find best split point (sentence boundary)
    let splitIdx = -1;
    const sentenceEnders = [". ", "! ", "? ", ".\n", "!\n", "?\n"];
    for (const ender of sentenceEnders) {
      const idx = remaining.lastIndexOf(ender, maxLen);
      if (idx > 0 && idx > splitIdx) {
        splitIdx = idx + ender.length - 1; // include the punctuation
      }
    }

    // Fallback: split at last space
    if (splitIdx <= 0) {
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    // Last resort: hard cut
    if (splitIdx <= 0) {
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks.filter(Boolean);
}

/**
 * Convert text to speech using Groq Orpheus TTS.
 * Returns an array of WAV buffers (one per chunk).
 *
 * @param {string} text – Text to synthesize
 * @returns {Promise<Buffer[]>} – Array of WAV audio buffers
 */
export async function textToSpeech(text) {
  if (!text || text.trim().length === 0) return [];

  const chunks = splitTextForTTS(text.trim());
  const audioBuffers = [];

  for (const chunk of chunks) {
    try {
      const response = await groq.audio.speech.create({
        model: "canopylabs/orpheus-v1-english",
        input: chunk,
        voice: "autumn",
        response_format: "wav",
      });

      // Response is a Response object; get the arrayBuffer
      const arrayBuffer = await response.arrayBuffer();
      audioBuffers.push(Buffer.from(arrayBuffer));

      console.log(`[TTS] Chunk (${chunk.length} chars) → ${arrayBuffer.byteLength} bytes`);
    } catch (err) {
      console.error(`[TTS] Error for chunk "${chunk.slice(0, 40)}...":`, err.message);
      // Continue with remaining chunks
    }
  }

  return audioBuffers;
}

/**
 * Stream TTS audio chunks one at a time via callback.
 * Each chunk is sent to onChunk immediately after generation,
 * reducing perceived latency compared to batch generation.
 *
 * @param {string} text – Text to synthesize
 * @param {function(Buffer): void} onChunk – Called with each WAV buffer as it's ready
 * @param {AbortSignal} [signal] – Optional abort signal to cancel remaining chunks
 */
export async function streamTextToSpeech(text, onChunk, signal) {
  if (!text || text.trim().length === 0) return;

  const chunks = splitTextForTTS(text.trim());

  for (const chunk of chunks) {
    if (signal?.aborted) {
      console.log("[TTS] Aborted — stopping generation");
      break;
    }

    try {
      const response = await groq.audio.speech.create({
        model: "canopylabs/orpheus-v1-english",
        input: chunk,
        voice: "autumn",
        response_format: "wav",
      });

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      console.log(`[TTS] Streamed chunk (${chunk.length} chars) → ${buffer.byteLength} bytes`);

      if (!signal?.aborted) {
        onChunk(buffer);
      }
    } catch (err) {
      if (signal?.aborted) break;
      console.error(`[TTS] Stream error for chunk "${chunk.slice(0, 40)}...":`, err.message);
    }
  }
}

/**
 * Stream LLM chat completion with tool calling support.
 * Executes tools as needed, then streams final text with TTS.
 */
export async function chatStreamAndSpeak(messages, session, onAudioChunk, onPartialText, signal) {
  // First, check if tools might be needed by doing a non-streaming call
  // This is more reliable for tool calling than streaming
  let finalReply = null;
  let toolCallCount = 0;

  // Tool calling loop
  while (toolCallCount < MAX_TOOL_CALLS) {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.6,
      max_completion_tokens: 1024,
      tools: tools,
    });

    const assistantMsg = response.choices[0].message;
    messages.push(assistantMsg);

    const toolCalls = assistantMsg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      finalReply = cleanForVoice(assistantMsg.content || "");
      break;
    }

    // Execute tool calls
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);
      
      console.log(`[LLM] Tool call: ${toolName}`, toolArgs);
      if (onPartialText) onPartialText(`[Using ${toolName}...]`);

      try {
        const result = await callTool(toolName, toolArgs, session);
        console.log(`[LLM] Tool result:`, result);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      } catch (err) {
        console.error(`[LLM] Tool error: ${toolName}`, err);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: err.message })
        });
      }
    }

    toolCallCount++;
  }

  // Fallback for empty replies
  if (!finalReply || finalReply.length < 10) {
    finalReply = "I'm sorry, I wasn't able to generate a complete response. Could you please repeat your question or describe the issue in a different way?";
  }

  // Stream the final response for TTS
  // Use streaming to enable overlapped TTS
  const stream = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [...messages, { role: "assistant", content: finalReply }],
    temperature: 0.6,
    max_completion_tokens: 1024,
    stream: true,
  });

  let fullReply = "";
  let pendingText = "";

  // ── TTS producer-consumer queue ──
  const ttsQueue = [];
  let ttsStreamDone = false;
  let ttsNotify = null;

  const notifyTTS = () => {
    if (ttsNotify) { ttsNotify(); ttsNotify = null; }
  };

  const abortHandler = () => {
    ttsStreamDone = true;
    notifyTTS();
  };
  if (signal) {
    signal.addEventListener("abort", abortHandler, { once: true });
  }

  const ttsConsumer = (async () => {
    while (true) {
      if (signal?.aborted) break;
      if (ttsQueue.length === 0) {
        if (ttsStreamDone) break;
        await new Promise((resolve) => { ttsNotify = resolve; });
        continue;
      }
      const text = ttsQueue.shift();
      if (signal?.aborted) break;

      const subChunks = splitTextForTTS(text, 190);
      for (const sub of subChunks) {
        if (signal?.aborted) break;
        try {
          const response = await groq.audio.speech.create({
            model: "canopylabs/orpheus-v1-english",
            input: sub,
            voice: "autumn",
            response_format: "wav",
          });
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          console.log(`[TTS+Stream] Chunk (${sub.length} chars) → ${buffer.byteLength} bytes`);
          if (!signal?.aborted) {
            onAudioChunk(buffer);
          }
        } catch (err) {
          if (signal?.aborted) break;
          console.error(`[TTS+Stream] Error for "${sub.slice(0, 40)}...":`, err.message);
        }
      }
    }
  })();

  // Stream the final reply for display and TTS
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const delta = chunk.choices[0]?.delta?.content || "";
    if (!delta) continue;

    fullReply += delta;
    pendingText += delta;

    if (onPartialText) onPartialText(cleanForVoice(fullReply));

    if (pendingText.length >= 80) {
      let lastBoundary = -1;
      const regex = /[.!?]\s+/g;
      let m;
      while ((m = regex.exec(pendingText)) !== null) {
        lastBoundary = m.index + m[0].length;
      }
      if (lastBoundary <= 0 && /[.!?]$/.test(pendingText.trim())) {
        lastBoundary = pendingText.length;
      }
      if (lastBoundary > 0) {
        const toFlush = cleanForVoice(pendingText.slice(0, lastBoundary).trim());
        pendingText = pendingText.slice(lastBoundary);
        if (toFlush && toFlush.length >= 10) {
          ttsQueue.push(toFlush);
          notifyTTS();
        }
      }
    }
  }

  if (pendingText.trim() && !signal?.aborted) {
    const remaining = cleanForVoice(pendingText.trim());
    if (remaining && remaining.length >= 2) {
      ttsQueue.push(remaining);
      notifyTTS();
    }
  }

  ttsStreamDone = true;
  notifyTTS();

  if (!signal?.aborted) {
    await ttsConsumer;
  } else {
    ttsConsumer.catch(() => {});
  }

  if (signal) {
    signal.removeEventListener("abort", abortHandler);
  }

  console.log(`[LLM+Stream] Reply: "${finalReply.slice(0, 120)}..."`);
  return { reply: finalReply, messages };
}
