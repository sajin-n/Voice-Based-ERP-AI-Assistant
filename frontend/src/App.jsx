import useVoiceChat from './hooks/useVoiceChat';
import Orb from './components/Orb';
import StatusPanel from './components/StatusPanel';
import Transcript from './components/Transcript';
import './App.css';

export default function App() {
  const { state: rtcState, connect, disconnect, botPhase, transcript, streamingText } = useVoiceChat();
  const isConnected = rtcState === 'connected';

  const handleClick = () => {
    if (isConnected) disconnect();
    else connect();
  };

  const phase = isConnected ? botPhase : 'idle';

  return (
    <div className="app">
      <div className="card">
        {/* Header */}
        <div className="header">
          <h1>ARIA</h1>
          <p>ERP Technical Support Assistant</p>
        </div>

        {/* Orb visualizer */}
        <Orb phase={phase} />

        {/* Pipeline status */}
        {isConnected && (
          <StatusPanel phase={botPhase} streamingText={streamingText} />
        )}

        {/* Conversation transcript */}
        <Transcript messages={transcript} />

        {/* Connect button */}
        <button
          className={`btn ${isConnected ? 'btn-disconnect' : 'btn-connect'}`}
          onClick={handleClick}
          disabled={rtcState === 'connecting'}
        >
          <MicIcon />
          <span>
            {rtcState === 'connecting'
              ? 'Connecting...'
              : isConnected
              ? 'Disconnect'
              : 'Connect'}
          </span>
        </button>

        {rtcState === 'error' && (
          <p className="error-msg">Connection failed. Check mic permissions.</p>
        )}
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2z" />
    </svg>
  );
}
