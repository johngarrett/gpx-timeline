import type { TrackPoint } from './types.js';

export function drawTrack(canvas: HTMLCanvasElement, points: TrackPoint[]): void {
  if (points.length < 2) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const pad = 3;

  let minLat = points[0].lat, maxLat = points[0].lat;
  let minLon = points[0].lon, maxLon = points[0].lon;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  const latSpan = maxLat - minLat || 0.0001;
  const lonSpan = maxLon - minLon || 0.0001;

  // Correct longitude span for latitude so the shape isn't stretched
  const cosLat = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const adjLonSpan = lonSpan * cosLat;

  // Scale to fit canvas while preserving physical aspect ratio
  const drawW = W - 2 * pad;
  const drawH = H - 2 * pad;
  const scale = Math.min(drawW / adjLonSpan, drawH / latSpan);
  const physW = adjLonSpan * scale;
  const physH = latSpan * scale;
  const offX = pad + (drawW - physW) / 2;
  const offY = pad + (drawH - physH) / 2;

  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = dark ? '#60a5fa' : '#2563eb';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();

  for (let i = 0; i < points.length; i++) {
    const x = offX + (points[i].lon - minLon) * cosLat * scale;
    const y = offY + physH - (points[i].lat - minLat) * scale;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Green dot at start
  const x0 = offX + (points[0].lon - minLon) * cosLat * scale;
  const y0 = offY + physH - (points[0].lat - minLat) * scale;
  ctx.fillStyle = dark ? '#4ade80' : '#16a34a';
  ctx.beginPath();
  ctx.arc(x0, y0, 2.5, 0, Math.PI * 2);
  ctx.fill();
}
