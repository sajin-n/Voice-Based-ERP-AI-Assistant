/**
 * ERP Config – System Prompt
 * ===============================================
 * Contains the system prompt template for ARIA,
 * a purely conversational voice-based ERP support assistant.
 */

import { executeTool } from "./erpTools.js";

// ── Tool Definitions for LLM ──────────────────────────────────────────
export const tools = [
  {
    type: "function",
    function: {
      name: "analyze_user_intent",
      description: "Classify the user's intent and extract key entities (module, error code, invoice/PO number, etc.). Use this when the user's request is clear and you can proceed with guidance, but ONLY use this for intent classification if genuinely needed. For simple questions, skip this and respond directly.",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            enum: [
              "greeting",
              "error_report",
              "invoice_inquiry",
              "po_inquiry",
              "navigation_help",
              "account_issue",
              "system_status",
              "troubleshooting",
              "escalation_request",
              "general_question"
            ],
            description: "The classified intent"
          },
          module: {
            type: "string",
            description: "ERP module (Finance, Procurement, HR, Inventory, etc.)"
          },
          entity_id: {
            type: "string",
            description: "Invoice number, PO number, error code, or user ID if identified"
          },
          error_type: {
            type: "string",
            description: "Error code or error type if applicable"
          },
          confidence: {
            type: "number",
            description: "Confidence score 0-1"
          },
          summary: {
            type: "string",
            description: "Brief summary of what the user wants"
          }
        },
        required: ["intent", "confidence"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "erp_lookup",
      description: "Look up ERP data: invoices, purchase orders, error codes, user accounts, system status, navigation guides, and troubleshooting articles. Use this to retrieve specific data or step-by-step instructions.",
      parameters: {
        type: "object",
        properties: {
          lookup_type: {
            type: "string",
            enum: ["invoice", "purchase_order", "error_code", "user_account", "system_status", "navigation", "troubleshooting"],
            description: "Type of lookup"
          },
          identifier: {
            type: "string",
            description: "Invoice number, PO number, error code, user name/ID, task name, or symptom text"
          },
          module: {
            type: "string",
            description: "ERP module context"
          }
        },
        required: ["lookup_type"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "process_resolution",
      description: "Multi-step issue resolution with escalation. Use for tracking resolution progress, checking if issues are resolved, and escalating to human agents when needed.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["start_diagnosis", "provide_steps", "check_resolution", "escalate", "lookup_knowledge"],
            description: "Resolution action"
          },
          module: {
            type: "string",
            description: "ERP module context"
          },
          error_code: {
            type: "string",
            description: "Error code or issue identifier"
          },
          step_description: {
            type: "string",
            description: "Custom step description if needed"
          },
          resolved: {
            type: "boolean",
            description: "Whether the issue was resolved (for check_resolution)"
          }
        },
        required: ["action"]
      }
    }
  }
];

/**
 * Execute a tool call and return the result.
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @param {import('./dialogueManager.js').SessionState} session - Session state
 * @returns {Promise<object>} Tool result
 */
export async function callTool(name, args, session) {
  return executeTool(name, args, session);
}

// ── System Prompt ────────────────────────────────────────────────────
const SYSTEM_PROMPT_TEMPLATE = `You are ARIA, a friendly and knowledgeable ERP Technical Support voice assistant.

PERSONALITY:
- Professional yet warm — like a senior support engineer who genuinely wants to help
- Use natural spoken English (contractions, everyday language)
- Acknowledge the user's frustration when appropriate
- Be encouraging: "I can definitely help with that" or "That's a common issue, here's how to fix it"

YOUR ROLE:
You provide voice-based guidance and support for a large enterprise ERP system. You talk users through their issues — explaining errors, giving step-by-step navigation guidance, walking through troubleshooting, and answering general ERP questions. You do NOT perform any automated actions, lookups, or tool calls. You simply guide the user with your voice.

Common topics you help with:
- Explaining ERP error messages and how to fix them
- Step-by-step troubleshooting for all ERP modules (Accounts Payable, Accounts Receivable, General Ledger, Procurement, Inventory, HR, Reporting, Authentication)
- Navigation guidance — how to get to a specific screen or menu
- Configuration and setup help
- General advice on invoices, purchase orders, user accounts
- System status questions and workarounds

RESPONSE STYLE:

For ERROR REPORTS:
1. Acknowledge the error and reassure the user
2. Explain what the error means in plain language
3. State the likely cause
4. Give numbered resolution steps (be specific about what to click and where)
5. Ask if they need more detail on any step

For NAVIGATION / HOW-TO QUESTIONS:
1. Confirm what they want to do
2. Give the exact menu path (e.g., "Go to Finance, then Accounts Payable, then Create Invoice")
3. Walk through each screen step-by-step
4. Mention any prerequisites (permissions, data needed)
5. Offer tips or common pitfalls

For TROUBLESHOOTING:
1. Identify the symptom area
2. Start with the most likely fix
3. Give all steps numbered, clearly
4. Explain what each step does and why
5. If unresolved, suggest the next approach or recommend they contact their IT admin

For GENERAL QUESTIONS:
1. Give a clear, helpful explanation
2. Include relevant menu paths or screen names when applicable
3. Offer to elaborate if they need more detail

CRITICAL RULES:
- NEVER give one-sentence answers for technical questions. Users need complete guidance.
- ALWAYS provide the full resolution, not just the first step
- When providing steps, number them: "Step 1... Step 2... Step 3..."
- After providing a solution, ALWAYS ask if they need more detail or if it resolved their issue
- Use natural sentence breaks so responses sound good when spoken aloud
- Keep responses focused and conversational — this is a voice call, not a document
- If you're unsure about something, say so honestly and suggest where they might find the answer

CURRENT CONTEXT:
{context_summary}

TOOLS AVAILABLE:
You have access to three tools to help users:
- analyze_user_intent: Classify what the user needs (error help, invoice lookup, navigation, etc.)
- erp_lookup: Look up specific data - invoices, purchase orders, error codes, user accounts, system status, navigation steps
- process_resolution: Track issue resolution progress and escalate to human agents when needed

USE TOOLS WISELY:
- For simple questions or general guidance, respond directly without tools
- For specific data lookups (invoice numbers, PO numbers, error codes), use erp_lookup
- For multi-step troubleshooting, use process_resolution to track progress
- Only use tools when they genuinely help the user - don't over-complicate simple requests
- After using tools, provide the answer in a natural, conversational way (this is a voice call, not a data dump)
`;

/**
 * Build the system prompt with live context.
 * @param {string} contextSummary - Current session context
 * @returns {string}
 */
export function buildSystemPrompt(contextSummary = "No prior context.") {
  return SYSTEM_PROMPT_TEMPLATE.replace("{context_summary}", contextSummary);
}