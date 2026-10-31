export default function PageHeader({ title, subtitle, action = null }) {
  return <div className="ap-page-heading-row">
    <div className="ap-page-heading"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
    {action && <div>{action}</div>}
  </div>;
}
