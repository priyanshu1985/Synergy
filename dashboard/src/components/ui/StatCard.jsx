export function StatCard({ title, value, icon, color = 'blue', onClick }) {
  return (
    <div className="stat-card-item" onClick={onClick}>
      <div className={`stat-icon-box ${color}`}>{icon}</div>
      <div className="stat-details">
        <span className="stat-title">{title}</span>
        <span className={`stat-val ${color === 'red' ? 'red' : color === 'purple' ? 'purple' : ''}`}>{value}</span>
      </div>
    </div>
  );
}
