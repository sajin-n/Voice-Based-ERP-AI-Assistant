/**
 * Metrics Tracker – Evaluation & Performance Metrics
 * ====================================================
 * Tracks intent classification accuracy, resolution rates,
 * escalation rates, and session-level summaries.
 */

class MetricsTracker {
  constructor() {
    this._intents = [];
    this._resolutions = [];
    this._escalations = [];
    this._sessions = [];
    this._startTime = Date.now();
  }

  recordIntent(intent, confidence) {
    this._intents.push({ intent, confidence, timestamp: Date.now() });
  }

  recordResolution(success) {
    this._resolutions.push({ success, timestamp: Date.now() });
    console.log(`[Metrics] Resolution ${success ? "SUCCESS" : "FAILED"}`);
  }

  recordEscalation(reason) {
    this._escalations.push({ reason, timestamp: Date.now() });
    console.warn(`[Metrics] Escalation recorded: ${reason}`);
  }

  recordSessionEnd(durationSec, turns) {
    this._sessions.push({ durationSec, turns, timestamp: Date.now() });
    console.log(`[Metrics] Session ended: ${durationSec.toFixed(1)}s, ${turns} turns`);
  }

  getSnapshot() {
    const snap = {
      totalIntents: this._intents.length,
      avgConfidence: 0,
      highConfidencePct: 0,
      lowConfidencePct: 0,
      totalResolutions: this._resolutions.length,
      resolutionSuccessRate: 0,
      totalEscalations: this._escalations.length,
      escalationRate: 0,
      intentDistribution: {},
      escalationReasons: this._escalations.map((e) => e.reason),
      avgSessionDurationSec: 0,
      totalSessions: this._sessions.length,
    };

    if (this._intents.length > 0) {
      const confidences = this._intents.map((i) => i.confidence);
      snap.avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
      snap.highConfidencePct = (confidences.filter((c) => c >= 0.8).length / confidences.length) * 100;
      snap.lowConfidencePct = (confidences.filter((c) => c < 0.6).length / confidences.length) * 100;

      const dist = {};
      for (const i of this._intents) {
        dist[i.intent] = (dist[i.intent] || 0) + 1;
      }
      snap.intentDistribution = dist;
    }

    if (this._resolutions.length > 0) {
      const successes = this._resolutions.filter((r) => r.success).length;
      snap.resolutionSuccessRate = (successes / this._resolutions.length) * 100;
    }

    const totalInteractions = Math.max(snap.totalIntents, 1);
    snap.escalationRate = (snap.totalEscalations / totalInteractions) * 100;

    if (this._sessions.length > 0) {
      snap.avgSessionDurationSec = this._sessions.reduce((a, s) => a + s.durationSec, 0) / this._sessions.length;
    }

    return snap;
  }

  reset() {
    this._intents = [];
    this._resolutions = [];
    this._escalations = [];
    this._sessions = [];
    this._startTime = Date.now();
  }
}

export const metricsTracker = new MetricsTracker();
