import './Orb.css';

export default function Orb({ phase }) {
  return (
    <div className="orb-container">
      <div className={`orb ${phase}`}>
        <div className="orb-ring" />
      </div>
    </div>
  );
}
