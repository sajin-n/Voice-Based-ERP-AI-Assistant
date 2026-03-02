/**
 * useVoiceChat – React Hook for Voice Chat via WebSocket
 * ========================================================
 * Replaces useWebRTC + useStatusSocket with a single hook.
 * Handles: mic access, browser-side VAD, WebSocket comms,
 * and audio playback queue.
 */

import { useState, useRef, useCallback, useEffect } from "react";

// ── VAD (Voice Activity Detection) constants ─────────────────────────
const VAD_THRESHOLD = 0.025;
const BARGE_IN_THRESHOLD = 0.055;
const SPEECH_START_MS = 400;
const BARGE_IN_START_MS = 800;
const SILENCE_STOP_MS = 1000;

export default function useVoiceChat() {
  // ── State ──────────────────────────────────────────────────────────
  const [state, setState] = useState("idle"); // idle | connecting | connected | error
  const [botPhase, setBotPhase] = useState("idle"); // idle | listening | thinking | speaking
  const [transcript, setTranscript] = useState([]);
  const [streamingText, setStreamingText] = useState("");

  // ── Refs ───────────────────────────────────────────────────────────
  const streamingTextRef = useRef("");
  const botPhaseRef = useRef("idle");
  const wsRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const vadFrameRef = useRef(null);

  // VAD state refs
  const isSpeakingRef = useRef(false);
  const speechStartTimeRef = useRef(0);
  const silenceStartTimeRef = useRef(0);

  // Audio playback
  const playbackCtxRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef(null);
  const botDoneRef = useRef(false); // true once server sends bot_stopped (all audio sent)

  // Keep botPhaseRef in sync
  const updateBotPhase = useCallback((phase) => {
    botPhaseRef.current = phase;
    setBotPhase(phase);
  }, []);

  // ── Audio Playback Queue ───────────────────────────────────────────
  const playNextAudio = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;

    const buffer = audioQueueRef.current.shift();
    try {
      if (!playbackCtxRef.current || playbackCtxRef.current.state === "closed") {
        playbackCtxRef.current = new AudioContext();
      }
      const ctx = playbackCtxRef.current;
      // Resume if suspended (browser autoplay policy)
      if (ctx.state === "suspended") await ctx.resume();

      const audioBuffer = await ctx.decodeAudioData(buffer.slice(0)); // slice to copy
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => {
        currentSourceRef.current = null;
        isPlayingRef.current = false;
        if (audioQueueRef.current.length > 0) {
          playNextAudio(); // play next in queue
        } else if (botDoneRef.current) {
          // Server confirmed all audio sent AND queue is empty
          updateBotPhase("listening");
        }
        // Otherwise: more chunks still coming from server, stay in speaking
      };
      currentSourceRef.current = source;
      source.start();
    } catch (err) {
      console.error("[Playback] Error:", err);
      currentSourceRef.current = null;
      isPlayingRef.current = false;
      if (audioQueueRef.current.length > 0) {
        playNextAudio(); // skip and try next
      }
    }
  }, [updateBotPhase]);

  const enqueueAudio = useCallback(
    (arrayBuffer) => {
      audioQueueRef.current.push(arrayBuffer);
      // Ensure we're in speaking phase while audio is arriving
      if (botPhaseRef.current !== "speaking") {
        updateBotPhase("speaking");
      }
      playNextAudio();
    },
    [playNextAudio, updateBotPhase]
  );

  // ── Clear Audio Queue (barge-in) ──────────────────────────────
  const clearAudioQueue = useCallback(() => {
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* ignore */ }
      currentSourceRef.current = null;
    }
  }, []);

  // ── Start Recording ────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    if (!mediaStreamRef.current) return;

    recordingChunksRef.current = [];
    try {
      const recorder = new MediaRecorder(mediaStreamRef.current, {
        mimeType: "audio/webm;codecs=opus",
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordingChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: "audio/webm;codecs=opus" });
        recordingChunksRef.current = [];

        // Send audio to server
        if (wsRef.current?.readyState === WebSocket.OPEN && blob.size > 0) {
          blob.arrayBuffer().then((ab) => {
            wsRef.current.send(ab);
            console.log(`[VAD] Sent ${ab.byteLength} bytes of audio`);
          });
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start(100); // collect in 100ms chunks
    } catch (err) {
      console.error("[VAD] MediaRecorder error:", err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // ── VAD Loop ───────────────────────────────────────────────────────
  const runVAD = useCallback(() => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = new Float32Array(analyser.fftSize);

    const tick = () => {
      vadFrameRef.current = requestAnimationFrame(tick);

      const phase = botPhaseRef.current;

      analyser.getFloatTimeDomainData(dataArray);

      // Calculate RMS volume
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
      const rms = Math.sqrt(sum / dataArray.length);

      const now = Date.now();

      // Higher threshold during bot speech to reduce echo-triggered false barge-ins
      const activeThreshold = phase === "speaking" ? BARGE_IN_THRESHOLD : VAD_THRESHOLD;

      // Use longer sustained-speech requirement during bot speech to ignore clicks/clanks
      const requiredMs = phase === "speaking" ? BARGE_IN_START_MS : SPEECH_START_MS;

      if (rms > activeThreshold) {
        silenceStartTimeRef.current = 0;

        if (!isSpeakingRef.current) {
          if (speechStartTimeRef.current === 0) {
            speechStartTimeRef.current = now;
          } else if (now - speechStartTimeRef.current > requiredMs) {
            // Speech started!
            isSpeakingRef.current = true;

            // BARGE-IN: if bot was speaking or thinking, interrupt immediately
            if (phase === "speaking" || phase === "thinking") {
              clearAudioQueue();
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: "barge_in" }));
              }
            }

            updateBotPhase("listening");
            startRecording();

            // Notify server
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: "user_speaking" }));
            }
          }
        }
      } else {
        speechStartTimeRef.current = 0;

        if (isSpeakingRef.current) {
          if (silenceStartTimeRef.current === 0) {
            silenceStartTimeRef.current = now;
          } else if (now - silenceStartTimeRef.current > SILENCE_STOP_MS) {
            // Speech ended!
            isSpeakingRef.current = false;
            stopRecording();
            updateBotPhase("thinking");
          }
        }
      }
    };

    vadFrameRef.current = requestAnimationFrame(tick);
  }, [startRecording, stopRecording, updateBotPhase, clearAudioQueue]);

  // ── Handle Server Events ───────────────────────────────────────────
  const handleServerEvent = useCallback(
    (msg) => {
      switch (msg.type) {
        case "user_speaking":
          updateBotPhase("listening");
          break;

        case "user_stopped":
          updateBotPhase("thinking");
          break;

        case "transcription":
          setTranscript((prev) => [
            ...prev,
            { role: "user", content: msg.data },
          ]);
          break;

        case "thinking":
          updateBotPhase("thinking");
          setStreamingText(msg.data || "");
          break;

        case "llm_text":
          streamingTextRef.current = msg.data || "";
          setStreamingText(msg.data || "");
          break;

        case "llm_done": {
          const finalText = streamingTextRef.current || msg.data;
          if (finalText) {
            setTranscript((prev) => [
              ...prev,
              { role: "assistant", content: finalText },
            ]);
          }
          streamingTextRef.current = "";
          setStreamingText("");
          break;
        }

        case "bot_speaking":
          botDoneRef.current = false;
          updateBotPhase("speaking");
          break;

        case "bot_stopped":
          botDoneRef.current = true;
          // Transition to listening only if all audio finished playing
          if (audioQueueRef.current.length === 0 && !isPlayingRef.current) {
            updateBotPhase("listening");
          }
          break;

        case "server_shutdown":
          console.warn("[WS] Server is shutting down:", msg.data);
          break;

        default:
          break;
      }
    },
    [updateBotPhase]
  );

  // ── Cleanup Helper ─────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (vadFrameRef.current) {
      cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = null;
    }

    if (mediaRecorderRef.current?.state === "recording") {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (playbackCtxRef.current) {
      playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
    }

    // Clear audio queue and stop current playback
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* ignore */ }
      currentSourceRef.current = null;
    }

    analyserRef.current = null;
    isSpeakingRef.current = false;
    speechStartTimeRef.current = 0;
    silenceStartTimeRef.current = 0;
    botDoneRef.current = false;
  }, []);

  // ── Connect ────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    setState("connecting");

    try {
      // 1. Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;

      // 2. Set up audio analysis for VAD
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      // 3. Connect WebSocket
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      console.log("[WS] Connecting to:", wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        console.log("[WS] Connected");
        setState("connected");
        updateBotPhase("thinking"); // will switch when greeting arrives
        // Start VAD
        runVAD();
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Discard stale audio during barge-in (user is speaking)
          if (isSpeakingRef.current) return;
          // Binary = audio from TTS
          enqueueAudio(event.data);
          return;
        }

        // Text = JSON event
        try {
          const msg = JSON.parse(event.data);
          handleServerEvent(msg);
        } catch {
          // ignore
        }
      };

      ws.onclose = (event) => {
        console.log("[WS] Disconnected, code:", event.code, event.reason);
        cleanup();
        setState("idle");
        updateBotPhase("idle");
      };

      ws.onerror = (err) => {
        console.error("[WS] Error:", err);
        cleanup();
        setState("error");
      };
    } catch (err) {
      console.error("[Connect] Error:", err);
      setState("error");
    }
  }, [runVAD, enqueueAudio, handleServerEvent, cleanup, updateBotPhase]);

  // ── Disconnect ─────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanup();
    setState("idle");
    updateBotPhase("idle");
  }, [cleanup, updateBotPhase]);

  // ── Cleanup on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    state,
    connect,
    disconnect,
    botPhase,
    transcript,
    streamingText,
    setTranscript,
  };
}
