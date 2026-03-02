/**
 * Dialogue Manager – Conversation State & Session Memory
 * ========================================================
 * Maintains per-session state for intent memory, multi-step
 * resolution tracking, escalation detection, and metrics.
 */

class SessionState {
  constructor() {
    // Intent / entity memory
    this.currentIntent = null;
    this.currentModule = null;
    this.currentEntityId = null;
    this.currentErrorType = null;
    this.confidence = 0.0;

    // Multi-step resolution tracking
    this.resolutionSteps = [];
    this.stepIndex = 0;
    this.resolutionActive = false;

    // Escalation tracking
    this.lowConfidenceCount = 0;
    this.failedAttempts = 0;
    this.escalated = false;

    // History
    this.turnCount = 0;
    this.intentsHistory = [];

    // Timing
    this.sessionStart = Date.now();
    this.lastActivity = Date.now();
  }

  touch() {
    this.lastActivity = Date.now();
    this.turnCount++;
  }

  setIntent(intent, module, entityId, errorType, confidence) {
    this.currentIntent = intent;
    this.currentModule = module;
    this.currentEntityId = entityId;
    this.currentErrorType = errorType;
    this.confidence = confidence;
    this.intentsHistory.push({ intent, module, entityId, confidence, turn: this.turnCount });
    console.log(`[Session] Intent: ${intent} | Module: ${module} | Entity: ${entityId} | Confidence: ${confidence.toFixed(2)}`);
  }

  startResolution(steps) {
    this.resolutionSteps = steps;
    this.stepIndex = 0;
    this.resolutionActive = true;
    console.log(`[Session] Started resolution with ${steps.length} steps`);
  }

  advanceStep() {
    if (!this.resolutionActive) return null;
    if (this.stepIndex < this.resolutionSteps.length) {
      const step = this.resolutionSteps[this.stepIndex];
      this.stepIndex++;
      return step;
    }
    this.resolutionActive = false;
    return null;
  }

  getCurrentStep() {
    if (this.resolutionActive && this.stepIndex < this.resolutionSteps.length) {
      return this.resolutionSteps[this.stepIndex];
    }
    return null;
  }

  remainingSteps() {
    if (!this.resolutionActive) return 0;
    return Math.max(0, this.resolutionSteps.length - this.stepIndex);
  }

  recordFailure() {
    this.failedAttempts++;
    console.warn(`[Session] Failed attempt #${this.failedAttempts}`);
  }

  shouldEscalate() {
    if (this.escalated) return true;
    if (this.lowConfidenceCount >= 3) return true;
    if (this.failedAttempts >= 2) return true;
    return false;
  }

  markEscalated() {
    this.escalated = true;
    console.warn("[Session] ESCALATED to human agent");
  }

  sessionDurationSec() {
    return (Date.now() - this.sessionStart) / 1000;
  }

  toContextSummary() {
    const parts = [];
    if (this.currentIntent) parts.push(`Last intent: ${this.currentIntent}`);
    if (this.currentModule && this.currentModule !== "unknown") parts.push(`Module: ${this.currentModule}`);
    if (this.currentEntityId) parts.push(`Entity: ${this.currentEntityId}`);
    if (this.currentErrorType) parts.push(`Error: ${this.currentErrorType}`);
    if (this.resolutionActive) parts.push(`Active resolution: step ${this.stepIndex}/${this.resolutionSteps.length}`);
    if (this.failedAttempts > 0) parts.push(`Failed attempts: ${this.failedAttempts}`);
    if (this.escalated) parts.push("STATUS: ESCALATED TO HUMAN AGENT");
    if (this.turnCount > 0) parts.push(`Conversation turns: ${this.turnCount}`);
    return parts.length > 0 ? parts.join(" | ") : "New session. No prior context.";
  }
}

class DialogueManager {
  constructor() {
    this._session = null;
  }

  get session() {
    if (!this._session) this._session = new SessionState();
    return this._session;
  }

  newSession() {
    this._session = new SessionState();
    console.log("[DialogueManager] New session created");
    return this._session;
  }

  endSession() {
    if (this._session) {
      console.log(
        `[DialogueManager] Session ended: ${this._session.turnCount} turns, ` +
        `${this._session.sessionDurationSec().toFixed(1)}s, escalated=${this._session.escalated}`
      );
    }
    this._session = null;
  }
}

export const dialogueManager = new DialogueManager();
