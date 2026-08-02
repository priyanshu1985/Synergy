import { ThunderboltOutlined } from '@ant-design/icons';

export function RiskPredictionPage({ floodWarnings }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
      <div className="infra-header-bar">
        <div>
          <h1 className="infra-header-title" style={{ color: 'var(--purple)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ThunderboltOutlined /> Predictive Flood Early-Warning Telemetry
          </h1>
          <p className="infra-header-sub">
            Automated 3-hour backend job computing Open-Meteo flood risk thresholds and Gemini AI warnings.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px', width: '100%' }}>
        {floodWarnings.length > 0 ? (
          floodWarnings.map((w, i) => (
            <div key={`fw-page-${i}`} className="facility-card-item" style={{ borderColor: 'var(--purple)' }}>
              <div className="facility-card-head">
                <span className="facility-title">🌊 {w.zone_name}</span>
                <span className={`facility-status-pill ${w.risk_level === 'severe' ? 'amber' : 'green'}`}>
                  {w.risk_level?.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>📍 Coordinates: {w.lat}, {w.lng}</div>
              {w.raw_forecast && (
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', fontSize: '12px', lineHeight: '1.6' }}>
                  🌧️ 48h Peak Precipitation: <b>{w.raw_forecast.precip_max_mm} mm</b><br />
                  🌊 72h River Discharge: <b>{w.raw_forecast.discharge_max_m3s} m³/s</b>
                </div>
              )}
              {w.ai_warning_text && (
                <div className="ai-summary-callout">
                  🤖 AI Warning: {w.ai_warning_text}
                </div>
              )}
            </div>
          ))
        ) : (
          <div style={{ gridColumn: '1 / -1', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
            ⚡ All monitored zones are currently evaluating as NORMAL flood risk levels.
          </div>
        )}
      </div>
    </div>
  );
}
