import { useState, useRef, useEffect } from 'react';
import useVoiceChat from './hooks/useVoiceChat';
import Orb from './components/Orb';
import './App.css';

export default function App() {
  const { state: rtcState, connect, disconnect, botPhase, transcript, streamingText, sendTextMessage } = useVoiceChat();
  const [textInput, setTextInput] = useState('');
  const messagesEndRef = useRef(null);

  const isConnected = rtcState === 'connected';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [transcript]);

  const handleConnect = () => {
    if (isConnected) {
      disconnect();
    } else {
      connect();
    }
  };

  const handleSendText = () => {
    if (textInput.trim() && isConnected) {
      sendTextMessage(textInput);
      setTextInput('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  const displayMessages = transcript.map((msg, idx) => ({
    ...msg,
    id: idx,
  }));

  return (
    <div className="app">
      <div className="card">
        {/* Header */}
        <div className="header">
          <div className="header-left">
            <h1>ARIA</h1>
            <p>ERP Support Assistant</p>
          </div>
          <div className="header-status">
            <div className="status-dot"></div>
            <span>
              {isConnected ? 'Connected' : rtcState === 'connecting' ? 'Connecting...' : 'Ready'}
            </span>
          </div>
        </div>

        {/* Main Content */}
        <div className="content">
          {/* Left: Visualizer */}
          <div className="visualizer-area">
            <Orb phase={isConnected ? botPhase : 'idle'} />
            <div className="phase-label" style={{ visibility: isConnected && botPhase !== 'idle' ? 'visible' : 'hidden' }}>
              {botPhase === 'listening' && 'Listening'}
              {botPhase === 'thinking' && 'Processing'}
              {botPhase === 'speaking' && 'Speaking'}
            </div>
            {streamingText && (
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                textAlign: 'center',
                maxWidth: '100%',
                padding: '0 12px',
                maxHeight: '60px',
                overflow: 'hidden',
                wordWrap: 'break-word',
              }}>
                {streamingText.slice(0, 100)}{streamingText.length > 100 ? '...' : ''}
              </div>
            )}
          </div>

          {/* Right: Chat */}
          <div className="chat-area">
            <div className="messages-container">
              {displayMessages.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">💬</div>
                  <p>No messages yet. Connect and start chatting!</p>
                </div>
              ) : (
                displayMessages.map((msg) => (
                  <div key={msg.id} className={`message ${msg.role}`}>
                    <div className="message-avatar">
                      {msg.role === 'user' ? '👤' : '🤖'}
                    </div>
                    <div className="message-content">
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Section */}
            <div className="input-section">
              <div className="text-input-wrapper">
                <input
                  type="text"
                  className="text-input"
                  placeholder={isConnected ? "Type a message or use voice..." : "Connect first..."}
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={!isConnected}
                />
              </div>
              <div className="button-group">
                <button
                  className={`btn ${isConnected ? 'btn-disconnect' : 'btn-primary'}`}
                  onClick={handleConnect}
                  disabled={rtcState === 'connecting'}
                >
                  <MicIcon />
                  {rtcState === 'connecting' ? '...' : isConnected ? 'Disc' : 'Mic'}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSendText}
                  disabled={!isConnected || !textInput.trim()}
                >
                  <SendIcon />
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>

        {rtcState === 'error' && (
          <div className="error-msg">⚠️ Connection failed. Check microphone permissions.</div>
        )}
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.6915026,12.4744748 L3.50612381,13.2599618 C3.19218622,13.2599618 3.03521743,13.4170592 3.03521743,13.5741566 L1.15159189,20.0151496 C0.8376543,20.8006365 0.99,21.89 1.77946707,22.52 C2.41,22.99 3.50612381,23.1 4.13399899,22.99 L21.714504,14.0454487 C22.6563168,13.5741566 23.1272231,12.6315722 22.9702544,11.6889879 L4.13399899,1.01234628 C3.34915502,0.9 2.40734225,0.9 1.77946707,1.38571282 C0.994623095,2.03684822 0.837654326,3.13399899 1.15159189,3.9194859 L3.03521743,10.4604789 C3.03521743,10.6175763 3.19218622,10.7746737 3.50612381,10.7746737 L16.6915026,11.5601606 C16.6915026,11.5601606 17.1624089,11.5601606 17.1624089,12.0314527 C17.1624089,12.5027448 16.6915026,12.4744748 16.6915026,12.4744748 Z" />
    </svg>
  );
}