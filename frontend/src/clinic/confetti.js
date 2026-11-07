// Pháo hoa giấy (confetti) bằng canvas thuần – không cần thư viện. Gọi fireConfetti() khi hoàn thành một hoạt động.
const COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#8e24aa', '#d81b60', '#26c6da', '#7cb342'];

export function fireConfetti({ count = 180, duration = 3200 } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 3000 });
  const resize = () => { canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr; };
  resize(); document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const W = () => canvas.width / dpr, H = () => canvas.height / dpr;
  const parts = Array.from({ length: count }, () => ({
    x: Math.random() * W(), y: -20 - Math.random() * H() * 0.5,
    vx: (Math.random() - 0.5) * 2.4, vy: 2 + Math.random() * 4.2,
    w: 5 + Math.random() * 8, h: 3 + Math.random() * 5, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
    sway: Math.random() * 6.28, color: COLORS[(Math.random() * COLORS.length) | 0], round: Math.random() < 0.3,
  }));
  const t0 = performance.now(); let raf = 0, stopped = false;
  const stop = () => { if (stopped) return; stopped = true; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); canvas.remove(); };
  window.addEventListener('resize', resize);
  const frame = (now) => {
    const t = now - t0;
    if (t > duration || stopped) { stop(); return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W(), H());
    const fade = t > duration - 700 ? Math.max(0, (duration - t) / 700) : 1;
    for (const p of parts) {
      p.sway += 0.05; p.x += p.vx + Math.sin(p.sway) * 0.8; p.y += p.vy; p.vy += 0.03; p.rot += p.vr;
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
      if (p.round) { ctx.beginPath(); ctx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, 6.28); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return stop;
}
