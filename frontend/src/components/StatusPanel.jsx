import './StatusPanel.css';

const LABELS = {
  idle:         null,
  listening:    'Listening',
  transcribing: 'Transcribing',
  thinking:     'Thinking',
  speaking:     'Speaking',
};

export default function StatusPanel({ phase, streamingText }) {
  const label = LABELS[phase];

  return (
    <div className="status-panel">
      {label && (
        <div className={`phase-label ${phase}`} key={phase}>
          <span className="dots">...</span>{label}
        </div>
      )}

      {/* Show streaming LLM output while thinking */}
      {(phase === 'thinking' || phase === 'speaking') && streamingText && (
        <div className="streaming-box">
          <span className="streaming-label">ARIA is saying:</span>
          <p className="streaming-text">{streamingText}</p>
        </div>
      )}
    </div>
  );
}
