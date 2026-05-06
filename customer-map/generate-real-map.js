const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');

async function generateMap() {
  const W = 1200, H = 900;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');

  // Stitch OSM tiles (4 columns x 3 rows, each 256x256)
  const tileW = 256, tileH = 256;
  const gridW = 4, gridH = 3;
  const mapW = gridW * tileW; // 1024
  const mapH = gridH * tileH; // 768

  // Load and draw tiles onto a temp canvas
  const mapCanvas = createCanvas(mapW, mapH);
  const mapCtx = mapCanvas.getContext('2d');
  
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -2; dx <= 1; dx++) {
      const fname = `tile_${dx}_${dy}.png`;
      if (fs.existsSync(fname)) {
        try {
          const img = await loadImage(fname);
          const px = (dx + 2) * tileW;
          const py = (dy + 1) * tileH;
          mapCtx.drawImage(img, px, py, tileW, tileH);
        } catch(e) { console.log('skip', fname); }
      }
    }
  }
  
  // Apply dark tint to the map
  mapCtx.fillStyle = 'rgba(15, 23, 42, 0.65)';
  mapCtx.fillRect(0, 0, mapW, mapH);
  
  // Draw the darkened map onto main canvas, scaled to fit
  const mapY = 75, mapBottom = H - 60;
  const drawH = mapBottom - mapY;
  const scale = Math.max(W / mapW, drawH / mapH);
  const drawW2 = mapW * scale;
  const drawH2 = mapH * scale;
  const offsetX = (W - drawW2) / 2;
  const offsetY = mapY + (drawH - drawH2) / 2;
  
  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);
  
  // Draw map
  ctx.drawImage(mapCanvas, offsetX, offsetY, drawW2, drawH2);
  
  // Vignette effect
  const vignette = ctx.createRadialGradient(W/2, H/2, W*0.25, W/2, H/2, W*0.7);
  vignette.addColorStop(0, 'transparent');
  vignette.addColorStop(1, 'rgba(15,23,42,0.6)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
  
  // Center marker (Hawaii Sports) - UB center area
  const cx = W * 0.48, cy = H * 0.44;
  
  // Glow
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 55);
  glow.addColorStop(0, 'rgba(139,92,246,0.35)');
  glow.addColorStop(1, 'rgba(139,92,246,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(cx, cy, 55, 0, Math.PI * 2); ctx.fill();
  
  // Pin
  ctx.font = '32px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⭐', cx, cy);
  
  // Label
  const lblW = 180, lblH = 30;
  const lblGrad = ctx.createLinearGradient(cx-lblW/2, 0, cx+lblW/2, 0);
  lblGrad.addColorStop(0, '#8b5cf6');
  lblGrad.addColorStop(1, '#6d28d9');
  ctx.fillStyle = lblGrad;
  ctx.beginPath();
  ctx.roundRect(cx - lblW/2, cy - 50, lblW, lblH, 8);
  ctx.fill();
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('🏋️ Hawaii Sports', cx, cy - 35);
  
  // Dotted circles for pin spots
  const spots = [
    [0.22, 0.28], [0.35, 0.52], [0.62, 0.28], [0.76, 0.48],
    [0.30, 0.68], [0.65, 0.68], [0.14, 0.50], [0.86, 0.32],
    [0.42, 0.22], [0.72, 0.72], [0.55, 0.60], [0.20, 0.40],
  ];
  spots.forEach(([x, y]) => {
    ctx.strokeStyle = 'rgba(139,92,246,0.25)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(x * W, y * H, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    
    ctx.fillStyle = 'rgba(139,92,246,0.08)';
    ctx.beginPath();
    ctx.arc(x * W, y * H, 14, 0, Math.PI * 2);
    ctx.fill();
    
    // Small + sign
    ctx.fillStyle = 'rgba(139,92,246,0.3)';
    ctx.font = '10px Arial';
    ctx.fillText('+', x * W, y * H);
  });
  
  // District labels on map
  ctx.font = '600 11px Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.textAlign = 'center';
  const districts = [
    ['수흐바타르', 0.38, 0.18],
    ['칭겔테이', 0.62, 0.18],
    ['바양골', 0.18, 0.55],
    ['바양주르흐', 0.82, 0.55],
    ['한울', 0.50, 0.80],
  ];
  districts.forEach(([name, x, y]) => {
    ctx.fillText(name, x * W, y * H);
  });
  
  // ===== Header =====
  ctx.fillStyle = 'rgba(15,23,42,0.92)';
  ctx.fillRect(0, 0, W, 75);
  const fade = ctx.createLinearGradient(0, 75, 0, 105);
  fade.addColorStop(0, 'rgba(15,23,42,0.5)');
  fade.addColorStop(1, 'transparent');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 75, W, 30);
  
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 26px Arial';
  ctx.fillStyle = '#8b5cf6';
  ctx.fillText('🏋️  Hawaii Sports', 40, 35);
  const hw = ctx.measureText('🏋️  Hawaii Sports').width;
  ctx.fillStyle = '#f1f5f9';
  ctx.fillText(' × Our Members', 40 + hw, 35);
  ctx.font = '12px Arial';
  ctx.fillStyle = '#64748b';
  ctx.fillText('우리 회원님들의 비즈니스 네트워크  ·  Улаанбаатар', 40, 58);
  
  // ===== Legend =====
  ctx.fillStyle = 'rgba(15,23,42,0.92)';
  ctx.fillRect(0, H - 58, W, 58);
  const fade2 = ctx.createLinearGradient(0, H - 80, 0, H - 58);
  fade2.addColorStop(0, 'transparent');
  fade2.addColorStop(1, 'rgba(15,23,42,0.5)');
  ctx.fillStyle = fade2;
  ctx.fillRect(0, H - 80, W, 22);
  
  const legend = [
    ['#ef4444', '🍽️ 식당/카페'],
    ['#3b82f6', '🏪 매장/소매'],
    ['#22c55e', '✂️ 서비스'],
    ['#f59e0b', '🏢 사무실'],
    ['#ec4899', '💊 의료'],
    ['#14b8a6', '🎓 교육'],
    ['#8b5cf6', '⭐ Hawaii'],
  ];
  let lx = 40;
  ctx.font = '11px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  legend.forEach(([color, text]) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lx + 5, H - 30, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(text, lx + 14, H - 30);
    lx += ctx.measureText(text).width + 32;
  });
  
  ctx.textAlign = 'right';
  ctx.font = '10px Arial';
  ctx.fillStyle = 'rgba(148,163,184,0.5)';
  ctx.fillText('📌 핀/스티커로 업장을 표시하세요', W - 40, H - 30);
  
  // Border
  ctx.strokeStyle = 'rgba(139,92,246,0.3)';
  ctx.lineWidth = 2;
  ctx.roundRect(4, 4, W - 8, H - 8, 16);
  ctx.stroke();
  
  // Save
  const buf = c.toBuffer('image/png');
  fs.writeFileSync('ub-real-map.png', buf);
  console.log(`✅ ub-real-map.png (${buf.length} bytes)`);
}

generateMap().catch(e => console.error(e));
