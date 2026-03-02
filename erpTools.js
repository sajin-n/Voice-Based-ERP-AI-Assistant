/**
 * ERP Tools – Function-Call Handlers
 * ====================================
 * Each exported function matches a tool name defined in erpConfig.js
 * and is called when the LLM emits a function_call with that name.
 */

import {
  lookupInvoice,
  lookupPurchaseOrder,
  lookupError,
  lookupUser,
  getSystemStatus,
  getNavigation,
  matchTroubleshooting,
} from "./erpKnowledgeBase.js";
import { metricsTracker } from "./metrics.js";

const CONFIDENCE_THRESHOLD = 0.6;
const ESCALATION_THRESHOLD = 0.4;

// ── Intent → suggested next tool ──────────────────────────────────────
function _suggestTool(intent) {
  const map = {
    error_report: "process_resolution",
    invoice_inquiry: "erp_lookup",
    po_inquiry: "erp_lookup",
    navigation_help: "erp_lookup",
    account_issue: "erp_lookup",
    system_status: "erp_lookup",
    escalation_request: "process_resolution",
  };
  return map[intent] || null;
}

// ── 1. analyze_user_intent ────────────────────────────────────────────
export function analyzeUserIntent(args, session) {
  const intent = args.intent || "general_question";
  const module = args.module || "unknown";
  const entityId = args.entity_id || null;
  const errorType = args.error_type || null;
  const confidence = args.confidence ?? 0.5;
  const summary = args.summary || "";

  // Update session state
  session.touch();
  session.setIntent(intent, module, entityId, errorType, confidence);
  metricsTracker.recordIntent(intent, confidence);

  // Low-confidence tracking
  if (confidence < CONFIDENCE_THRESHOLD) {
    session.lowConfidenceCount++;
  }

  // Build result
  const result = {
    status: "classified",
    intent,
    module,
    entity_id: entityId,
    error_type: errorType,
    confidence,
    summary,
  };

  // Suggest next tool
  const suggestion = _suggestTool(intent);
  if (suggestion) {
    result.suggested_next_tool = suggestion;
  }

  // Escalation check
  if (confidence < ESCALATION_THRESHOLD) {
    result.warning = "Very low confidence – consider asking the user to rephrase.";
  }
  if (session.shouldEscalate()) {
    result.escalation_recommended = true;
    result.escalation_reason =
      session.failedAttempts >= 2
        ? "multiple_failed_attempts"
        : "low_confidence_pattern";
  }

  // Greeting shortcut
  if (intent === "greeting") {
    result.quick_response = "Hello! I'm ARIA, your ERP support assistant. I can help you with error troubleshooting, navigation guidance, invoice and PO lookups, system status, and more. What do you need help with?";
  }

  // For common intents, provide actionable guidance directly
  if (intent === "navigation_help") {
    result.guidance = "Use erp_lookup with lookup_type='navigation' and the task name to get step-by-step navigation instructions.";
  }
  if (intent === "error_report" && errorType) {
    result.guidance = "Use erp_lookup with lookup_type='error_code' and the error code to get the error details and resolution steps.";
  }
  if (intent === "invoice_inquiry" && entityId) {
    result.guidance = "Use erp_lookup with lookup_type='invoice' and the invoice number to get invoice details.";
  }
  if (intent === "po_inquiry" && entityId) {
    result.guidance = "Use erp_lookup with lookup_type='purchase_order' and the PO number to get PO details.";
  }
  if (intent === "system_status") {
    result.guidance = "Use erp_lookup with lookup_type='system_status' to get current system health.";
  }

  console.log(`[Tool:analyzeUserIntent] ${intent} (${confidence.toFixed(2)}) → ${summary}`);
  return result;
}

// ── 2. process_resolution ─────────────────────────────────────────────
export function processResolution(args, session) {
  const action = args.action;
  const module = args.module || session.currentModule || "unknown";
  const errorCode = args.error_code || session.currentErrorType || null;
  const stepDescription = args.step_description || "";
  const resolved = args.resolved ?? null;

  session.touch();

  // ── escalate ──
  if (action === "escalate") {
    session.markEscalated();
    metricsTracker.recordEscalation("user_requested");
    return {
      status: "escalated",
      message:
        "I'm connecting you to a human agent who can help further. " +
        "Your case details have been saved. Reference number: ESC-" +
        String(Date.now()).slice(-6),
    };
  }

  // ── check_resolution ──
  if (action === "check_resolution") {
    if (resolved === true) {
      session.resolutionActive = false;
      metricsTracker.recordResolution(true);
      return {
        status: "resolved",
        message: "Great, glad that fixed it! Is there anything else I can help with?",
      };
    }
    if (resolved === false) {
      session.recordFailure();
      if (session.shouldEscalate()) {
        session.markEscalated();
        metricsTracker.recordEscalation("resolution_failed");
        return {
          status: "escalation_needed",
          message:
            "I'm sorry the steps didn't resolve the issue. Let me connect you to a specialist. " +
            "Reference: ESC-" + String(Date.now()).slice(-6),
        };
      }
      return {
        status: "retry",
        message: "Let me try an alternative approach.",
      };
    }
    return {
      status: "checking",
      message: "Did that step resolve your issue?",
    };
  }

  // ── lookup_knowledge ──
  if (action === "lookup_knowledge") {
    const matches = matchTroubleshooting(errorCode || module);
    if (matches.length > 0) {
      const top = matches[0];
      return {
        status: "knowledge_found",
        article: top.title,
        steps: top.steps,
        module: top.module,
      };
    }
    return { status: "no_knowledge", message: "No matching knowledge base articles found." };
  }

  // ── start_diagnosis / provide_steps ──
  if (action === "start_diagnosis" || action === "provide_steps") {
    let steps = [];
    let title = "";
    let escalationTrigger = "";

    // Try knowledge base first
    const kbMatches = matchTroubleshooting(errorCode || module);
    if (kbMatches.length > 0) {
      steps = kbMatches[0].steps;
      title = kbMatches[0].title;
      escalationTrigger = kbMatches[0].escalation_trigger || "";
    }

    // Try error code lookup for resolution steps
    if (steps.length === 0 && errorCode) {
      const errLookup = lookupError(errorCode);
      if (errLookup?.found && errLookup.data?.resolution) {
        steps = errLookup.data.resolution;
        title = errLookup.data.title || "";
      }
    }

    if (steps.length > 0) {
      session.startResolution(steps);
      return {
        status: "diagnosis_started",
        title,
        total_steps: steps.length,
        all_steps: steps,
        escalation_note: escalationTrigger,
        instruction: "Present ALL steps to the user in a numbered format. Walk them through each one clearly.",
      };
    }

    // Generic fallback
    if (stepDescription) {
      session.startResolution([stepDescription]);
      session.advanceStep();
      return {
        status: "custom_step",
        instruction: stepDescription,
      };
    }

    return {
      status: "no_steps",
      message: `I don't have specific pre-defined steps for ${errorCode || module}.`,
      suggestion: "Try describing the symptoms, or provide the exact error code or message you're seeing. I can also check the system status or look up navigation guides.",
    };
  }

  return { status: "unknown_action", message: `Unknown action: ${action}` };
}

// ── 3. erp_lookup ─────────────────────────────────────────────────────
export function erpLookup(args, session) {
  const lookupType = args.lookup_type;
  const identifier = args.identifier || "";
  const module = args.module || session?.currentModule || "unknown";

  if (session) session.touch();

  switch (lookupType) {
    case "invoice": {
      const inv = lookupInvoice(identifier);
      if (inv && inv.found) {
        const data = inv.data;
        // Enrich with actionable context
        const enriched = { ...data };
        if (data.status === "Overdue") {
          enriched.action_needed = "This invoice is overdue. The accounts payable team should be notified. You can send a reminder via Finance > Accounts Payable > Overdue Invoices.";
        } else if (data.status === "Pending Approval") {
          enriched.action_needed = "This invoice is waiting for approval. Check the approval queue in Finance > Accounts Payable > Pending Approvals.";
        }
        return { status: "found", type: "invoice", data: enriched };
      }
      return {
        status: "not_found",
        type: "invoice",
        message: `Invoice "${identifier}" not found in the system.`,
        suggestion: "Please double-check the invoice number. Valid formats are like INV-001. You can search for invoices in Finance > Accounts Payable > Invoice Search.",
      };
    }

    case "purchase_order": {
      const po = lookupPurchaseOrder(identifier);
      if (po && po.found) {
        const data = po.data;
        const enriched = { ...data };
        if (data.status === "Processing") {
          enriched.action_needed = "This PO is still being processed. Expected delivery date may change.";
        } else if (data.status === "Shipped") {
          enriched.action_needed = "This PO has been shipped. You can track delivery in Procurement > Purchase Orders > Delivery Tracking.";
        }
        return { status: "found", type: "purchase_order", data: enriched };
      }
      return {
        status: "not_found",
        type: "purchase_order",
        message: `Purchase order "${identifier}" not found.`,
        suggestion: "Check the PO number format (e.g., PO-4501). You can search all POs in Procurement > Purchase Orders.",
      };
    }

    case "error_code": {
      const err = lookupError(identifier);
      if (err && err.found) {
        const data = err.data;
        // Also pull in any related troubleshooting article
        const kbMatches = matchTroubleshooting(identifier);
        const result = { status: "found", type: "error_code", data };
        if (kbMatches.length > 0) {
          result.related_troubleshooting = {
            title: kbMatches[0].title,
            steps: kbMatches[0].steps,
            escalation_trigger: kbMatches[0].escalation_trigger,
          };
        }
        return result;
      }
      // Try troubleshooting KB by keyword
      const matches = matchTroubleshooting(identifier);
      if (matches.length > 0) {
        return {
          status: "found",
          type: "troubleshooting",
          data: {
            title: matches[0].title,
            steps: matches[0].steps,
            module: matches[0].module,
            escalation_trigger: matches[0].escalation_trigger,
          },
        };
      }
      return {
        status: "not_found",
        type: "error_code",
        message: `Error code "${identifier}" not found in our database.`,
        suggestion: "Try describing the error message you see, and I can help troubleshoot based on symptoms. You can also check the full error log in Admin > System Logs.",
      };
    }

    case "user_account": {
      const user = lookupUser(identifier);
      if (user && user.found) {
        const data = user.data;
        const enriched = { ...data };
        if (data.locked) {
          enriched.action_needed = "This account is currently locked. An admin can unlock it via Admin > User Management > Search User > Unlock Account.";
        }
        return { status: "found", type: "user_account", data: enriched };
      }
      return {
        status: "not_found",
        type: "user_account",
        message: `User "${identifier}" not found.`,
        suggestion: "Try searching by full name or user ID (format: USR-101). You can browse all users in Admin > User Management.",
      };
    }

    case "system_status": {
      const result = getSystemStatus(identifier || null);
      const data = result.found ? result.data : result;
      // Add summary of any issues
      const issues = [];
      for (const [mod, info] of Object.entries(data)) {
        if (info.status && info.status !== "Operational") {
          issues.push({ module: mod, status: info.status, note: info.note || "" });
        }
      }
      return {
        status: "found",
        type: "system_status",
        data,
        active_issues: issues,
        summary: issues.length > 0
          ? `${issues.length} module(s) have issues: ${issues.map(i => `${i.module} is ${i.status}`).join(", ")}.`
          : "All systems are operational. No current issues detected.",
      };
    }

    case "navigation": {
      const nav = getNavigation(identifier || module);
      if (nav && nav.found) {
        const data = nav.data;
        return {
          status: "found",
          type: "navigation",
          data,
          instruction: `Follow this path: ${data.path}. I'll walk you through each step.`,
        };
      }
      // Return available navigation topics to help the user
      const navFallback = getNavigation("__list_all__");
      const available_tasks = navFallback?.available_tasks;
      return {
        status: "not_found",
        type: "navigation",
        message: `No specific navigation guide for "${identifier || module}".`,
        available_guides: available_tasks || [
          "create_invoice", "approve_purchase_order", "reset_password",
          "run_report", "manage_inventory", "unlock_account",
          "create_purchase_order", "add_vendor", "view_gl_entries",
          "submit_expense_report", "check_delivery_status",
          "configure_approval_workflow", "inventory_adjustment",
        ],
        suggestion: "I can guide you through any of these tasks. Which one are you looking for?",
      };
    }

    case "troubleshooting": {
      const articles = matchTroubleshooting(identifier || module);
      if (articles.length > 0) {
        return {
          status: "found",
          type: "troubleshooting",
          data: {
            title: articles[0].title,
            steps: articles[0].steps,
            module: articles[0].module,
            severity: articles[0].severity,
            escalation_trigger: articles[0].escalation_trigger,
          },
        };
      }
      return {
        status: "not_found",
        type: "troubleshooting",
        message: `No troubleshooting articles found for "${identifier || module}".`,
        suggestion: "Try describing your issue in more detail — for example, what error message or symptom you're seeing. I can also check error codes if you have one.",
      };
    }

    default:
      return { status: "error", message: `Unknown lookup type: ${lookupType}` };
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────
const TOOL_MAP = {
  analyze_user_intent: analyzeUserIntent,
  process_resolution: processResolution,
  erp_lookup: erpLookup,
};

/**
 * Execute a tool call by name.
 * @param {string} name – Tool function name
 * @param {object} args – Parsed arguments
 * @param {import('./dialogueManager.js').SessionState} session
 * @returns {object}
 */
export function executeTool(name, args, session) {
  const fn = TOOL_MAP[name];
  if (!fn) {
    console.error(`[erpTools] Unknown tool: ${name}`);
    return { status: "error", message: `Unknown tool: ${name}` };
  }
  try {
    return fn(args, session);
  } catch (err) {
    console.error(`[erpTools] Error executing ${name}:`, err);
    return { status: "error", message: `Tool error: ${err.message}` };
  }
}
