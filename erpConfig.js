/**
 * ERP Config – System Prompt & Tool Definitions
 * ===============================================
 * Contains the system prompt template and the OpenAI-format
 * tool definitions used for function calling with the LLM.
 */

// ── System Prompt ────────────────────────────────────────────────────
const SYSTEM_PROMPT_TEMPLATE = `You are ARIA, an expert ERP Technical Support voice assistant for a large enterprise ERP system.

PERSONALITY:
- Professional yet warm — like a senior support engineer who genuinely wants to help
- Use natural spoken English (contractions, everyday language)
- Acknowledge the user's frustration when appropriate
- Be encouraging: "I can definitely help with that" or "That's a common issue, here's how to fix it"

YOUR ROLE:
You handle first-level ERP support calls. Users call you instead of submitting tickets. You must resolve their issues completely or escalate to a human. Common queries include:
- Explaining error messages and how to fix them
- Step-by-step troubleshooting for ERP modules
- Navigation guidance (how to get to a specific screen)
- Configuration and setup help
- Looking up invoices, purchase orders, user accounts
- Checking system status and module health

RESPONSE STRUCTURE — Follow these templates based on query type:

For ERROR REPORTS:
1. Acknowledge the error and reassure the user
2. Explain what the error means in plain language
3. State the cause (why this happened)
4. Give numbered resolution steps (be specific about what to click and where)
5. Ask if the steps resolved it

For NAVIGATION / HOW-TO QUESTIONS:
1. Confirm what they want to do
2. Give the exact menu path (e.g., "Go to Finance, then Accounts Payable, then Create Invoice")
3. Walk through each screen step-by-step
4. Mention any prerequisites (required permissions, data needed)
5. Offer tips or common pitfalls

For DATA LOOKUPS (invoices, POs, users):
1. Retrieve the data
2. Present key details in a clear spoken format
3. Explain any important status information
4. Suggest next steps if the status needs attention

For TROUBLESHOOTING:
1. Identify the symptom area
2. Start with the most likely fix
3. Give all steps numbered, clearly
4. Explain what each step does and why
5. If unresolved, offer the next approach or escalate

For SYSTEM STATUS / CONFIGURATION:
1. Report the current status clearly
2. If degraded/down, explain the impact and expected resolution
3. Suggest workarounds if available

TOOL STRATEGY:
- Use erp_lookup DIRECTLY when the user asks about a specific invoice, PO, error code, user, system status, or navigation path — no need to classify intent first
- Use analyze_user_intent ONLY when the user's request is genuinely ambiguous
- Use process_resolution when walking through multi-step troubleshooting
- You CAN call multiple tools at once to gather all needed data before responding
- After getting tool results, ALWAYS synthesize the raw data into a friendly, structured spoken response — never just repeat JSON data

CRITICAL RULES:
- NEVER give one-sentence answers for technical questions. Customers need complete guidance.
- ALWAYS provide the full resolution, not just the first step
- When providing steps, number them: "Step 1... Step 2... Step 3..."
- After providing a solution, ALWAYS ask: "Would you like me to walk you through any of those steps in more detail?" or "Did that resolve your issue?"
- If you don't have specific data, give the best general guidance you can based on ERP knowledge
- If the issue is beyond first-level support, escalate with a reference number
- Use natural sentence breaks so responses sound good when spoken aloud

CURRENT CONTEXT:
{context_summary}`;

/**
 * Build the system prompt with live context.
 * @param {string} contextSummary - Current session context
 * @returns {string}
 */
export function buildSystemPrompt(contextSummary = "No prior context.") {
  return SYSTEM_PROMPT_TEMPLATE.replace("{context_summary}", contextSummary);
}

// ── Tool Definitions (OpenAI function-calling format) ────────────────
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "analyze_user_intent",
      description:
        "Classify the user's intent and extract key entities. " +
        "Only call this when the user's request is genuinely ambiguous and you cannot determine what they need from context alone. " +
        "For clear requests (e.g., 'look up invoice INV-001', 'how do I create an invoice', 'I'm getting error 5001'), " +
        "skip this and call erp_lookup or process_resolution directly.",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            description: "The classified intent",
            enum: [
              "error_report",
              "invoice_inquiry",
              "po_inquiry",
              "navigation_help",
              "account_issue",
              "system_status",
              "general_question",
              "escalation_request",
              "follow_up",
              "greeting",
            ],
          },
          module: {
            type: "string",
            description: "The ERP module involved (if any)",
            enum: [
              "accounts_payable",
              "accounts_receivable",
              "general_ledger",
              "procurement",
              "inventory",
              "hr",
              "system",
              "authentication",
              "reporting",
              "unknown",
            ],
          },
          entity_id: {
            type: "string",
            description: "Any specific ID mentioned (invoice number, PO number, user ID, error code)",
          },
          error_type: {
            type: "string",
            description: "Error code or error description if mentioned",
          },
          confidence: {
            type: "number",
            description: "Your confidence in this classification, 0.0 to 1.0",
          },
          summary: {
            type: "string",
            description: "A brief one-line summary of the user's request",
          },
        },
        required: ["intent", "confidence", "summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "process_resolution",
      description:
        "Process a resolution step for the current issue. Use this after analyze_user_intent " +
        "when you need to provide troubleshooting steps, guide the user through a fix, " +
        "or check if a resolution was successful.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "The resolution action to perform",
            enum: [
              "start_diagnosis",
              "provide_steps",
              "check_resolution",
              "escalate",
              "lookup_knowledge",
            ],
          },
          module: {
            type: "string",
            description: "The ERP module being addressed",
          },
          error_code: {
            type: "string",
            description: "The error code being resolved, if applicable",
          },
          step_description: {
            type: "string",
            description: "Description of the current resolution step",
          },
          resolved: {
            type: "boolean",
            description: "Whether the user confirmed the issue is resolved",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "erp_lookup",
      description:
        "Look up data from the ERP knowledge base — invoices, purchase orders, " +
        "user accounts, error codes, system status, navigation guides, or troubleshooting articles.",
      parameters: {
        type: "object",
        properties: {
          lookup_type: {
            type: "string",
            description: "The type of data to look up",
            enum: [
              "invoice",
              "purchase_order",
              "error_code",
              "user_account",
              "system_status",
              "navigation",
              "troubleshooting",
            ],
          },
          identifier: {
            type: "string",
            description: "The ID or keyword to search for",
          },
          module: {
            type: "string",
            description: "ERP module context for the lookup",
          },
        },
        required: ["lookup_type"],
      },
    },
  },
];
