import { useEffect, useRef } from 'react';
import './Transcript.css';

export default function Transcript({ messages }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="transcript-box">
        <p className="transcript-empty">Conversation will appear here...</p>
      </div>
    );
  }

  return (
    <div className="transcript-box">
      {messages.map((msg, i) => (
        <div key={i} className={`msg ${msg.role}`}>
          <span className="msg-role">{msg.role === 'user' ? 'You' : 'ARIA'}</span>
          <p className="msg-text">{msg.content}</p>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
