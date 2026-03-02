# Voice-Based ERP AI Assistant

**AI-Powered Voice Support System for Enterprise Resource Planning (ERP)**

Voice-based AI support assistant that automates first-level ERP technical support through natural voice conversations. Users can call in, describe their issues, and receive instant troubleshooting guidance, navigation help, and data lookups—all through spoken dialogue.

---

## 🎯 Project Overview

Many ERP users prefer calling support instead of submitting tickets. First-level support calls often involve repetitive tasks like:
- Explaining common error codes
- Providing basic troubleshooting steps
- Guiding users through ERP navigation
- Looking up invoices, purchase orders, and user accounts
- Checking system status

ARIA automates these routine support calls using voice AI, reducing human intervention while maintaining clarity and reliability.

---

## Architecture

### Technology Stack

**Backend:**
- Node.js 22+ with ES Modules
- Express.js for HTTP server
- WebSocket (`ws`) for real-time bidirectional communication
- Groq AI Services:
  - **STT**: Whisper Large V3 Turbo (speech-to-text)
  - **LLM**: Llama 3.3 70B Versatile (conversational AI with function calling)
  - **TTS**: Orpheus V1 English (text-to-speech, voice: "autumn")

**Frontend:**
- React 18 with Vite
- Browser MediaRecorder API for audio capture
- Custom Voice Activity Detection (VAD)
- Web Audio API for audio playback

**Core Components:**
1. **Voice Pipeline**: Browser → WebSocket → STT → LLM with Tool Calling → TTS → Browser
2. **Knowledge Base**: Deterministic ERP data (invoices, POs, users, errors, troubleshooting guides)
3. **Tool System**: Function-calling handlers for intent analysis, data lookup, and resolution workflows
4. **Dialogue Manager**: Session state tracking, multi-step resolution, escalation detection

---

## Features

### Voice Interaction
- **Real-time voice chat** with sub-2-second response latency
- **Streaming TTS audio** — Audio starts playing immediately as it's generated, reducing perceived latency
- **Barge-in interruption** — User can interrupt bot mid-sentence by speaking; audio stops instantly and bot waits for user input
- **Echo-aware VAD** — Voice Activity Detection with higher threshold during bot speech to prevent echo-triggered false interruptions
- **Browser-based VAD** (Voice Activity Detection) for natural turn-taking
- **Audio playback queue** for seamless multi-chunk TTS responses
- **Visual feedback** with animated orb showing listening/thinking/speaking phases

### ERP Support Capabilities
- ✅ **Error Code Resolution** — Explain errors, provide causes, walk through fixes
- ✅ **Navigation Guidance** — Step-by-step screen navigation for ERP tasks
- ✅ **Data Lookups** — Invoices, purchase orders, user accounts, system status
- ✅ **Troubleshooting Workflows** — Multi-step diagnosis with escalation triggers
- ✅ **System Status** — Real-time module health checks
- ✅ **Configuration Help** — Approval workflows, inventory adjustments, expense reports

### Knowledge Base Coverage
- **10 Error Codes** with resolution steps
- **14 Navigation Guides** for common ERP tasks
- **11 Troubleshooting Scenarios** with symptom matching
- **Mock Data** for invoices, POs, users (for demo purposes)

### Quality & Reliability
- **Structured response templates** ensuring consistent, thorough answers
- **Multi-round tool calling** (up to 8 rounds) for complex queries
- **Intelligent escalation** based on confidence, failed attempts, or severity
- **Session context tracking** for conversational continuity
- **Metrics & monitoring** (tracked turns, resolutions, escalations)

---

## 📂 Project Structure

```
voice-based-AIbot/
├── server.js                    # Express + WebSocket server
├── erpConfig.js                 # System prompt & tool definitions
├── erpKnowledgeBase.js          # Mock ERP data & troubleshooting KB
├── erpTools.js                  # Function-call handlers
├── groqServices.js              # STT / LLM / TTS API wrappers
├── dialogueManager.js           # Session state & context tracking
├── metrics.js                   # Metrics tracker
├── transcriptionFilter.js       # STT hallucination filter
├── package.json                 # Backend dependencies
├── .env                         # API keys (not committed)
│
└── frontend/
    ├── src/
    │   ├── App.jsx              # Main application component
    │   ├── hooks/
    │   │   └── useVoiceChat.js  # Voice chat hook (WebSocket + VAD)
    │   ├── components/
    │   │   ├── Orb.jsx          # Animated voice visualizer
    │   │   ├── StatusPanel.jsx  # Pipeline status display
    │   │   └── Transcript.jsx   # Conversation transcript
    │   └── assets/
    ├── dist/                    # Built frontend (served by Express)
    ├── package.json             # Frontend dependencies
    └── vite.config.js           # Vite configuration
```

---

## ⚙️ Setup & Installation

### Prerequisites
- **Node.js** 22.14.0 or higher
- **npm** 10+
- **Groq API Key** ([Get one here](https://console.groq.com))

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/sajin-n/Voice-Based-ERP-AI-Assistant.git
   cd Voice-Based-ERP-AI-Assistant
   ```

2. **Install backend dependencies:**
   ```bash
   npm install
   ```

3. **Install frontend dependencies:**
   ```bash
   cd frontend
   npm install
   cd ..
   ```

4. **Create `.env` file:**
   ```bash
   echo "GROQ_API_KEY=your_groq_api_key_here" > .env
   ```

5. **Build the frontend:**
   ```bash
   cd frontend
   npm run build
   cd ..
   ```

6. **Start the server:**
   ```bash
   node server.js
   ```

7. **Open in browser:**
   ```
   http://localhost:7860
   ```

---

## Usage

1. **Click "Connect"** — The browser will request microphone access
2. **Wait for greeting** — ARIA will introduce herself and offer help
3. **Speak your question** — The orb pulses while listening
4. **Receive guidance** — ARIA provides structured, step-by-step answers
5. **Follow up** — Continue the conversation naturally

### Example Queries

**Error Troubleshooting:**
- "I'm getting error 5001"
- "My invoice posting failed with error 5004"

**Navigation Help:**
- "How do I create a purchase order?"
- "Where do I find the approval queue?"

**Data Lookups:**
- "Look up invoice INV-001"
- "What's the status of PO-4520?"
- "Is user Bob Johnson's account locked?"

**General Support:**
- "The system is running slow"
- "I can't log in"
- "How do I reset my password?"

---

## Key Components

### System Prompt ([erpConfig.js](erpConfig.js))
Defines ARIA's personality, capabilities, and **response structure templates** for each query type:
- Error reports: acknowledge → explain → cause → numbered steps → verify resolution
- Navigation: confirm task → menu path → step-by-step walkthrough → prerequisites
- Data lookups: retrieve → present clearly → explain status → suggest next steps

### Knowledge Base ([erpKnowledgeBase.js](erpKnowledgeBase.js))
- Mock ERP data for demos (invoices, POs, users, errors)
- Troubleshooting KB with symptom matching
- Step engine with normalization and fuzzy search

### Tool Handlers ([erpTools.js](erpTools.js))
- `analyzeUserIntent` — Classify intent only when genuinely ambiguous
- `erp_lookup` — Direct data lookups (invoice, PO, error, user, status, navigation, troubleshooting)
- `process_resolution` — Multi-step workflows with escalation triggers

### LLM Integration ([groqServices.js](groqServices.js))
- **Tool-calling loop** (up to 8 rounds) with automatic tool execution
- **Response sanitization** (strips markdown, formats numbered lists for voice)
- **TTS chunking** (splits long text at sentence boundaries)

---

## 🔧 Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GROQ_API_KEY` | Groq API key for AI services | `gsk_...` |
| `PORT` | Server port (optional) | `7860` |

### System Prompt Tuning

Edit [erpConfig.js](erpConfig.js) to customize:
- Response structure templates
- Tool usage strategy
- Escalation policies
- Personality traits

### Knowledge Base Extension

Add more content to [erpKnowledgeBase.js](erpKnowledgeBase.js):
- Error codes in `COMMON_ERRORS`
- Navigation guides in `NAVIGATION_GUIDE`
- Troubleshooting scenarios in `TROUBLESHOOTING_KB`

---

## 📊 Metrics & Monitoring

Access metrics at: **`http://localhost:7860/api/metrics`**

Tracked metrics:
- Total sessions and turns
- Intent distribution
- Resolution success rate
- Escalation rate and reasons
- Average confidence scores

---

## 🛠️ Development

### Frontend Development Server

```bash
cd frontend
npm run dev
```

Frontend will run on `http://localhost:5173` with hot reload. The Vite proxy forwards `/api` and `/ws` to the backend on port 7860.

### Building for Production

```bash
cd frontend
npm run build
cd ..
node server.js
```

The Express server serves the built frontend from `frontend/dist`.

---

## Testing Example Scenarios

1. **Error Resolution:**
   - "I can't post an invoice, getting error 5004"
   - Expected: Explanation of missing cost center, step-by-step fix

2. **Navigation:**
   - "How do I approve a purchase order?"
   - Expected: Full menu path + step-by-step walkthrough

3. **Data Lookup:**
   - "What's the status of invoice INV-003?"
   - Expected: Status (Overdue), amount, due date, action needed

4. **Troubleshooting:**
   - "The system is really slow"
   - Expected: Check system status, close tabs, clear cache, check for maintenance

5. **Escalation:**
   - "I tried those steps but it's still not working"
   - Expected: Offer escalation to human agent with reference number

---

## Security Notes

- **API keys** are stored in `.env` (never commit this file)
- **Frontend** is served from the same origin (no CORS issues in production)
- **WebSocket** uses the same port as HTTP (no additional firewall rules needed)
- **Session isolation** — each WebSocket connection has its own session state

---

## Performance

- **STT latency**: ~500-800ms (Whisper Large V3 Turbo)
- **LLM latency**: ~1-2s (Llama 3.3 70B, depends on response length & tool calls)
- **TTS latency**: ~300-500ms per chunk (Orpheus V1)
- **Total response time**: 2-4 seconds for typical queries

Optimizations:
- Browser-side VAD reduces false triggers
- Audio playback queue prevents gaps between TTS chunks
- Tool result caching in session state
- Message history trimming (keeps last 20 messages)

---

## Contributing

Contributions are welcome! Areas for improvement:
- Additional ERP modules (HR, Inventory, Reporting)
- Real ERP data integration (replace mock data with actual ERP APIs)
- Multi-language support
- Authentication & user management
- Advanced analytics dashboard

---

## Acknowledgments

- **Groq** for fast AI inference infrastructure
- **Meta AI** for Llama 3.3 model
- **OpenAI** for Whisper STT model
- **Canopy Labs** for Orpheus TTS model

---

**Built for ERP Technical Support Assessment**  
*Demonstrating AI-powered voice interaction for first-level ERP support automation*
