import { useMemo, useState } from 'react';

// Sơ đồ vùng da. Lưu ý: "trái/phải" tính theo bệnh nhân → nằm phía bên phải/trái của người xem.
const FACE = [
  // [key, mirrorable, path]
  ['forehead', true, 'M150 30 L206 30 L224 104 L150 112 Z'],
  ['temple', true, 'M206 30 Q246 52 252 112 L252 156 L232 156 L224 104 Z'],
  ['cheek', true, 'M166 178 L234 162 Q254 178 247 216 Q232 272 202 292 L182 252 Z'],
  ['chin', false, 'M118 288 Q150 276 182 288 L174 336 Q150 348 126 336 Z'],
];
const FACE_SIDE = { temple: ['left_temple', 'right_temple'], cheek: ['left_cheek', 'right_cheek'] };

const BODY_FRONT = [
  ['neck', 'M92 76 h36 v26 h-36 Z'],
  ['chest', 'M62 104 Q110 96 158 104 L152 190 Q110 198 68 190 Z'],
  ['abdomen', 'M68 192 Q110 200 152 192 L148 262 Q110 270 72 262 Z'],
  ['groin', 'M74 264 Q110 272 146 264 L138 300 Q110 310 82 300 Z'],
  ['right_arm', 'M58 106 L30 112 L14 232 L38 238 L58 170 Z'],
  ['left_arm', 'M162 106 L190 112 L206 232 L182 238 L162 170 Z'],
  ['right_hand', 'M14 236 L38 242 L32 292 Q24 302 12 290 Z'],
  ['left_hand', 'M206 236 L182 242 L188 292 Q196 302 208 290 Z'],
  ['right_leg', 'M80 304 L108 304 L104 430 L78 430 Z'],
  ['left_leg', 'M112 304 L140 304 L142 430 L116 430 Z'],
  ['right_foot', 'M74 432 L104 432 L108 460 L66 460 Z'],
  ['left_foot', 'M116 432 L146 432 L154 460 L112 460 Z'],
];
const BODY_BACK = [
  ['neck', 'M92 76 h36 v26 h-36 Z'],
  ['upper_back', 'M62 104 Q110 96 158 104 L152 196 Q110 204 68 196 Z'],
  ['lower_back', 'M68 198 Q110 206 152 198 L148 270 Q110 278 72 270 Z'],
  ['left_arm', 'M58 106 L30 112 L14 232 L38 238 L58 170 Z'],
  ['right_arm', 'M162 106 L190 112 L206 232 L182 238 L162 170 Z'],
  ['left_hand', 'M14 236 L38 242 L32 292 Q24 302 12 290 Z'],
  ['right_hand', 'M206 236 L182 242 L188 292 Q196 302 208 290 Z'],
  ['left_leg', 'M80 274 L108 274 L104 430 L78 430 Z'],
  ['right_leg', 'M112 274 L140 274 L142 430 L116 430 Z'],
  ['left_foot', 'M74 432 L104 432 L108 460 L66 460 Z'],
  ['right_foot', 'M116 432 L146 432 L154 460 L112 460 Z'],
];

export default function BodyMap({ marks = [], selected, onSelect, regionsMeta = [], readOnly = false }) {
  const [view, setView] = useState('face');
  const sev = useMemo(() => {
    const m = {};
    marks.forEach((x) => { m[x.region] = Math.max(m[x.region] || 0, x.severity || 1); });
    return m;
  }, [marks]);
  const label = (k) => regionsMeta.find((r) => r.key === k)?.label || k;
  const zone = (key, d, extra = {}) => {
    const s = sev[key] || 0;
    const cls = `bm-zone ${s ? 'has' : ''} ${selected === key ? 'sel' : ''}`;
    return <path key={key + (extra.k || '')} d={d} className={cls} data-sev={s} transform={extra.transform}
      onClick={() => !readOnly && onSelect?.(key)} tabIndex={readOnly ? -1 : 0} role="button" aria-label={label(key)}
      onKeyDown={(e) => { if (!readOnly && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect?.(key); } }}>
      <title>{label(key)}{s ? ` · mức ${s}` : ''}</title></path>;
  };
  const faceZones = () => {
    const out = [];
    FACE.forEach(([k, mirror, d]) => {
      if (mirror) {
        const keys = FACE_SIDE[k] || [k, k];
        out.push(zone(keys[0], d, { k: 'R' }));                        // phía phải người xem = trái bệnh nhân
        out.push(zone(keys[1], d, { k: 'L', transform: 'translate(300 0) scale(-1 1)' }));
      } else out.push(zone(k, d));
    });
    out.push(zone('left_eye', 'M160 140 Q196 122 228 142 Q196 168 160 140 Z', { k: 'e' }));
    out.push(zone('right_eye', 'M160 140 Q196 122 228 142 Q196 168 160 140 Z', { k: 'e2', transform: 'translate(300 0) scale(-1 1)' }));
    out.push(zone('nose', 'M150 118 L170 196 Q172 220 150 226 Q128 220 130 196 Z'));
    out.push(zone('perioral', 'M104 246 Q150 228 196 246 Q196 276 150 282 Q104 276 104 246 Z'));
    return out;
  };
  const extraRegions = regionsMeta.filter((r) => ['scalp', 'left_ear', 'right_ear', 'nails'].includes(r.key));
  return <div className="bm">
    <div className="bm-tabs" role="tablist">
      {[['face', 'Mặt'], ['front', 'Thân trước'], ['back', 'Thân sau']].map(([k, t]) =>
        <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{t}</button>)}
    </div>
    <div className="bm-stage">
      {view === 'face' && <svg viewBox="0 0 300 370" className="bm-svg" aria-label="Sơ đồ khuôn mặt">
        <defs><clipPath id="faceClip"><ellipse cx="150" cy="190" rx="104" ry="162" /></clipPath></defs>
        <path d="M112 336 L96 366 L204 366 L188 336 Z" className="bm-base" />
        <ellipse cx="46" cy="196" rx="14" ry="30" className="bm-base" /><ellipse cx="254" cy="196" rx="14" ry="30" className="bm-base" />
        <ellipse cx="150" cy="190" rx="104" ry="162" className="bm-base" />
        <g clipPath="url(#faceClip)">{faceZones()}</g>
        <ellipse cx="150" cy="190" rx="104" ry="162" className="bm-outline" />
        <text x="270" y="30" className="bm-note" textAnchor="end">Bên trái BN</text><text x="30" y="30" className="bm-note">Bên phải BN</text>
      </svg>}
      {(view === 'front' || view === 'back') && <svg viewBox="0 0 220 470" className="bm-svg body" aria-label="Sơ đồ cơ thể">
        <circle cx="110" cy="42" r="32" className="bm-base" />
        {(view === 'front' ? BODY_FRONT : BODY_BACK).map(([k, d]) => zone(k, d))}
        <text x="214" y="18" className="bm-note" textAnchor="end">Bên trái BN</text><text x="6" y="18" className="bm-note">Bên phải BN</text>
      </svg>}
    </div>
    {view === 'face' && !readOnly && <div className="bm-extra">
      <span>Vùng khác:</span>
      {extraRegions.map((r) => <button key={r.key} className={`${selected === r.key ? 'sel' : ''} ${sev[r.key] ? 'has' : ''}`} onClick={() => onSelect?.(r.key)}>{r.label}</button>)}
    </div>}
    <div className="bm-legend"><i className="s1" />Nhẹ <i className="s2" />Vừa <i className="s3" />Nặng <i className="s0" />Chưa ghi nhận</div>
  </div>;
}
