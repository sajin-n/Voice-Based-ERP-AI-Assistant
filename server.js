/**
 * Server – Express + WebSocket Voice Chat Server
 * =================================================
 * Serves the React frontend and handles real-time voice
 * chat via WebSocket (audio in → STT → LLM → TTS → audio out).
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

import { dialogueManager } from "./dialogueManager.js";
import { metricsTracker } from "./metrics.js";
import { buildSystemPrompt } from "./erpConfig.js";
import { transcribeAudio, chatWithTools, textToSpeech, streamTextToSpeech } from "./groqServices.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 7860;

// ── Express App ──────────────────────────────────────────────────────
const app = express();

// CORS – allow Vite dev server and any local origin
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      `http://localhost:${PORT}`,
    ],
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  })
);
app.use(express.json());

// Serve React frontend (built files)
const distPath = path.join(__dirname, "frontend", "dist");
app.use(express.static(distPath));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Metrics API
app.get("/api/metrics", (_req, res) => {
  res.json(metricsTracker.getSnapshot());
});

// SPA fallback – only serve index.html for non-API, non-WS, non-asset routes
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// ── HTTP Server + WebSocket ──────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// Keep track of active sessions for cleanup
const activeSessions = new Map();

wss.on("connection", (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[WS] New connection from ${clientIp}`);

  // Per-connection state
  const session = dialogueManager.newSession();
  let messages = [
    { role: "system", content: buildSystemPrompt(session.toContextSummary()) },
  ];
  let processing = false;
  let alive = true;
  let ttsAbort = null; // AbortController for barge-in TTS cancellation

  activeSessions.set(ws, session);

  // Send a JSON event to the client
  function sendEvent(type, data) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify({ type, data }));
      } catch (err) {
        console.error("[WS] sendEvent error:", err.message);
      }
    }
  }

  // Send binary audio to the client
  function sendAudio(buffer) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(buffer);
      } catch (err) {
        console.error("[WS] sendAudio error:", err.message);
      }
    }
  }

  // ── Ping/pong keep-alive ──
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  // ── Generate greeting on connect ──
  (async () => {
    try {
      sendEvent("thinking", "Preparing greeting...");

      messages.push({
        role: "user",
        content: "[System: The user just connected to the ERP support line. Greet them warmly, introduce yourself as ARIA their ERP support assistant, and let them know you can help with common errors, troubleshooting steps, navigation guidance, looking up invoices and purchase orders, checking system status, and more. Keep it to 3-4 sentences. Ask how you can help them today.]",
      });

      const { reply, messages: updatedMsgs } = await chatWithTools(messages, session, sendEvent);
      messages = updatedMsgs;

      const greetingText = reply || "Hello! I'm ARIA, your ERP support assistant. How can I help?";
      sendEvent("llm_text", greetingText);
      sendEvent("llm_done", "");

      // Generate TTS (stream chunks — each sent as soon as generated)
      sendEvent("bot_speaking", "");
      ttsAbort = new AbortController();
      const greetingSignal = ttsAbort.signal;
      await streamTextToSpeech(greetingText, (buf) => sendAudio(buf), greetingSignal);
      ttsAbort = null;
      if (!greetingSignal.aborted) {
        sendEvent("bot_stopped", "");
      }
    } catch (err) {
      console.error("[WS] Greeting error:", err.message);
      sendEvent("llm_text", "Hello! I'm ARIA. How can I help you today?");
      sendEvent("llm_done", "");
      sendEvent("bot_stopped", "");
    }
  })();

  // ── Handle incoming messages ──
  ws.on("message", async (data, isBinary) => {
    if (!alive) return;

    // Binary = audio data from the browser
    if (isBinary || Buffer.isBuffer(data)) {
      if (processing) {
        console.log("[WS] Ignoring audio — still processing previous");
        return;
      }
      processing = true;

      try {
        const audioBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        console.log(`[WS] Received audio: ${audioBuffer.length} bytes`);

        // Ignore very small audio clips (noise/accidental)
        if (audioBuffer.length < 4000) {
          console.log("[WS] Audio too short, skipping");
          processing = false;
          return;
        }

        // 1. STT
        sendEvent("user_stopped", "");
        sendEvent("thinking", "Transcribing...");

        const sttResult = await transcribeAudio(audioBuffer);

        if (!sttResult.text) {
          console.log(`[WS] STT filtered: ${sttResult.reason}`);
          sendEvent("bot_stopped", "");
          processing = false;
          return;
        }

        const userText = sttResult.text;
        sendEvent("transcription", userText);
        console.log(`[WS] User said: "${userText}"`);

        // 2. Update system prompt with latest context
        messages[0] = {
          role: "system",
          content: buildSystemPrompt(session.toContextSummary()),
        };

        // 3. Add user message
        messages.push({ role: "user", content: userText });

        // Trim history to prevent token overflow (keep system + last 20 msgs)
        if (messages.length > 22) {
          messages = [messages[0], ...messages.slice(-20)];
        }

        // 4. LLM with tools
        sendEvent("thinking", "Processing...");
        const { reply, messages: updatedMsgs } = await chatWithTools(
          messages,
          session,
          sendEvent
        );
        messages = updatedMsgs;

        if (!reply) {
          sendEvent("bot_stopped", "");
          processing = false;
          return;
        }

        sendEvent("llm_text", reply);
        sendEvent("llm_done", "");

        // 5. TTS (stream chunks — each sent as soon as generated)
        sendEvent("bot_speaking", "");
        ttsAbort = new AbortController();
        const ttsSignal = ttsAbort.signal;
        await streamTextToSpeech(reply, (buf) => sendAudio(buf), ttsSignal);
        ttsAbort = null;
        if (!ttsSignal.aborted) {
          sendEvent("bot_stopped", "");
        }
      } catch (err) {
        console.error("[WS] Processing error:", err);
        sendEvent("llm_text", "Sorry, I encountered an error. Please try again.");
        sendEvent("llm_done", "");
        sendEvent("bot_stopped", "");
      } finally {
        processing = false;
      }
    } else {
      // Text message (JSON command from client)
      try {
        const msg = JSON.parse(data.toString());
        console.log(`[WS] Text message: ${msg.type}`);

        if (msg.type === "user_speaking") {
          sendEvent("user_speaking", "");
        } else if (msg.type === "barge_in") {
          console.log("[WS] Barge-in: user interrupted, aborting TTS");
          if (ttsAbort) {
            ttsAbort.abort();
            ttsAbort = null;
          }
          processing = false;
          sendEvent("bot_stopped", "");
        } else if (msg.type === "ping") {
          sendEvent("pong", Date.now());
        }
      } catch {
        // Ignore malformed text messages
      }
    }
  });

  ws.on("close", () => {
    alive = false;
    activeSessions.delete(ws);
    console.log("[WS] Connection closed");
    if (session) {
      metricsTracker.recordSessionEnd(session.sessionDurationSec(), session.turnCount);
    }
    dialogueManager.endSession();
  });

  ws.on("error", (err) => {
    console.error("[WS] Error:", err.message);
  });
});

// ── WebSocket keep-alive interval ────────────────────────────────────
const HEARTBEAT_INTERVAL = 30_000;
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log("[WS] Terminating dead connection");
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on("close", () => clearInterval(heartbeat));

// ── Graceful Shutdown ────────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n[Server] ${signal} received — shutting down gracefully...`);

  // Close all WebSocket connections
  wss.clients.forEach((ws) => {
    try {
      ws.send(JSON.stringify({ type: "server_shutdown", data: "Server is restarting..." }));
      ws.close(1001, "Server shutting down");
    } catch { /* ignore */ }
  });

  wss.close(() => {
    server.close(() => {
      console.log("[Server] Closed. Goodbye.");
      process.exit(0);
    });
  });

  // Force exit after 5s
  setTimeout(() => {
    console.error("[Server] Forced shutdown after timeout");
    process.exit(1);
  }, 5000);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ── Start Server ─────────────────────────────────────────────────────
// Bind error handler BEFORE listen to catch EADDRINUSE
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  ❌ Port ${PORT} is already in use!`);
    console.error(`     Run: npx kill-port ${PORT}   (then retry)\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`\n   ARIA server running at http://localhost:${PORT}`);
  console.log(`   WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`   Metrics: http://localhost:${PORT}/api/metrics`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});