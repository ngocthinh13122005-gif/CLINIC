export default function MetricCard({ label, value, meta = null, icon: Icon, tone = '' }) {
  return <div className="ap-card ap-stat">
    <div className="ap-stat-top"><div className="label">{label}</div>{Icon && <span className={`ap-metric-icon ${tone}`}><Icon sx={{fontSize:18}}/></span>}</div>
    <div className="value">{value}</div>{meta && <div className="meta">{meta}</div>}
  </div>;
}
