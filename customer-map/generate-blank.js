const { createCanvas } = require('canvas');
const fs = require('fs');

// 3 design options: Dark Premium, Light Clean, Gold Luxury

function drawDesign1(filename) {
  // DESIGN 1: Dark Premium (보라+네온)
  const W = 1200, H = 900;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  
  // BG
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f172a'); bg.addColorStop(0.5, '#1a1a2e'); bg.addColorStop(1, '#16213e');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  
  // Border
  ctx.strokeStyle = 'rgba(139,92,246,0.4)'; ctx.lineWidth = 3;
  ctx.roundRect(8, 8, W-16, H-16, 20); ctx.stroke();
  
  // Grid pattern
  ctx.strokeStyle = 'rgba(100,116,139,0.06)'; ctx.lineWidth = 1;
  for(let x = 40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 80); ctx.lineTo(x, H-80); ctx.stroke(); }
  for(let y = 80; y < H-80; y += 40) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W-40, y); ctx.stroke(); }
  
  // Roads (UB style)
  const roads = [
    [0.1, 0.4, 0.9, 0.4, true],   // Peace Ave
    [0.5, 0.12, 0.5, 0.85, true],  // Main vertical
    [0.1, 0.25, 0.9, 0.25, false],
    [0.1, 0.55, 0.9, 0.55, false],
    [0.1, 0.7, 0.85, 0.7, false],
    [0.3, 0.12, 0.3, 0.82, false],
    [0.7, 0.12, 0.7, 0.82, false],
    [0.15, 0.18, 0.15, 0.78, false],
    [0.85, 0.18, 0.85, 0.78, false],
  ];
  roads.forEach(([x1,y1,x2,y2,main]) => {
    ctx.strokeStyle = main ? 'rgba(139,92,246,0.15)' : 'rgba(100,116,139,0.1)';
    ctx.lineWidth = main ? 3 : 1.5;
    ctx.beginPath(); ctx.moveTo(x1*W, y1*H); ctx.lineTo(x2*W, y2*H); ctx.stroke();
  });
  
  // District labels
  ctx.font = '600 10px Arial'; ctx.fillStyle = 'rgba(148,163,184,0.3)';
  ctx.textAlign = 'center';
  [['СҮХБААТАР', 0.35, 0.16], ['ЧИНГЭЛТЭЙ', 0.65, 0.16],
   ['БАЯНГОЛ', 0.2, 0.48], ['БАЯНЗҮРХ', 0.8, 0.48],
   ['ХАН-УУЛ', 0.5, 0.78]].forEach(([n,x,y]) => ctx.fillText(n, x*W, y*H));
  
  // Center marker (Hawaii Sports)
  const cx = W*0.48, cy = H*0.4;
  // Glow
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
  glow.addColorStop(0, 'rgba(139,92,246,0.3)'); glow.addColorStop(1, 'rgba(139,92,246,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, 60, 0, Math.PI*2); ctx.fill();
  // Star
  ctx.font = '36px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('⭐', cx, cy);
  // Label
  ctx.font = 'bold 14px Arial'; ctx.fillStyle = '#8b5cf6';
  ctx.fillText('Hawaii Sports', cx, cy - 35);
  ctx.font = '10px Arial'; ctx.fillStyle = 'rgba(148,163,184,0.6)';
  ctx.fillText('(여기에 센터 위치)', cx, cy + 30);
  
  // Header
  ctx.fillStyle = 'rgba(15,23,42,0.95)'; ctx.fillRect(0, 0, W, 72);
  const fade = ctx.createLinearGradient(0, 72, 0, 100);
  fade.addColorStop(0, 'rgba(15,23,42,0.5)'); fade.addColorStop(1, 'transparent');
  ctx.fillStyle = fade; ctx.fillRect(0, 72, W, 28);
  
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 26px Arial'; ctx.fillStyle = '#8b5cf6';
  ctx.fillText('🏋️  Hawaii Sports', 40, 38);
  ctx.fillStyle = '#f1f5f9'; ctx.font = 'bold 26px Arial';
  const hw = ctx.measureText('🏋️  Hawaii Sports').width;
  ctx.fillText(' × Our Members', 40 + hw, 38);
  ctx.font = '12px Arial'; ctx.fillStyle = '#64748b';
  ctx.fillText('우리 회원님들의 비즈니스 네트워크 · 울란바토르', 40, 60);
  
  // Legend bar
  ctx.fillStyle = 'rgba(15,23,42,0.95)'; ctx.fillRect(0, H-60, W, 60);
  const fade2 = ctx.createLinearGradient(0, H-85, 0, H-60);
  fade2.addColorStop(0, 'transparent'); fade2.addColorStop(1, 'rgba(15,23,42,0.5)');
  ctx.fillStyle = fade2; ctx.fillRect(0, H-85, W, 25);
  
  const legend = [['#ef4444','🍽️ 식당/카페'],['#3b82f6','🏪 매장'],['#22c55e','✂️ 서비스'],['#f59e0b','🏢 사무실'],['#ec4899','💊 의료'],['#14b8a6','🎓 교육']];
  let lx = 40;
  ctx.font = '11px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  legend.forEach(([color, text]) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(lx+5, H-30, 5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#94a3b8'; ctx.fillText(text, lx+14, H-30);
    lx += ctx.measureText(text).width + 40;
  });
  
  // Instructions
  ctx.textAlign = 'right'; ctx.font = '11px Arial'; ctx.fillStyle = 'rgba(148,163,184,0.5)';
  ctx.fillText('📌 스티커/핀으로 업장 위치를 표시하세요', W-40, H-30);
  
  // Empty pin spots (dotted circles for placing stickers)
  const spots = [[0.2,0.3],[0.35,0.5],[0.6,0.3],[0.75,0.5],[0.3,0.65],[0.65,0.65],[0.15,0.55],[0.85,0.35],[0.4,0.2],[0.7,0.75]];
  spots.forEach(([x,y]) => {
    ctx.strokeStyle = 'rgba(139,92,246,0.12)'; ctx.lineWidth = 1.5;
    ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.arc(x*W, y*H, 16, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(139,92,246,0.04)';
    ctx.beginPath(); ctx.arc(x*W, y*H, 16, 0, Math.PI*2); ctx.fill();
  });
  
  fs.writeFileSync(filename, c.toBuffer('image/png'));
  console.log(`✅ ${filename} (${fs.statSync(filename).size} bytes)`);
}

function drawDesign2(filename) {
  // DESIGN 2: Light Clean (화이트 + 민트)
  const W = 1200, H = 900;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  
  // White BG
  ctx.fillStyle = '#fafbfc'; ctx.fillRect(0, 0, W, H);
  
  // Subtle pattern
  ctx.strokeStyle = 'rgba(0,0,0,0.04)'; ctx.lineWidth = 1;
  for(let x = 40; x < W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 90); ctx.lineTo(x, H-70); ctx.stroke(); }
  for(let y = 90; y < H-70; y += 50) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W-40, y); ctx.stroke(); }
  
  // Roads
  const roads = [
    [0.08, 0.4, 0.92, 0.4, true],
    [0.5, 0.12, 0.5, 0.85, true],
    [0.1, 0.25, 0.9, 0.25, false],
    [0.1, 0.55, 0.9, 0.55, false],
    [0.3, 0.12, 0.3, 0.82, false],
    [0.7, 0.12, 0.7, 0.82, false],
  ];
  roads.forEach(([x1,y1,x2,y2,main]) => {
    ctx.strokeStyle = main ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.06)';
    ctx.lineWidth = main ? 3 : 1.5;
    ctx.beginPath(); ctx.moveTo(x1*W, y1*H); ctx.lineTo(x2*W, y2*H); ctx.stroke();
  });
  
  // Districts
  ctx.font = '600 10px Arial'; ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.textAlign = 'center';
  [['СҮХБААТАР', 0.35, 0.16], ['ЧИНГЭЛТЭЙ', 0.65, 0.16],
   ['БАЯНГОЛ', 0.2, 0.48], ['БАЯНЗҮРХ', 0.8, 0.48],
   ['ХАН-УУЛ', 0.5, 0.78]].forEach(([n,x,y]) => ctx.fillText(n, x*W, y*H));
  
  // Center
  const cx = W*0.48, cy = H*0.4;
  ctx.fillStyle = 'rgba(16,185,129,0.1)'; ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI*2); ctx.fill();
  ctx.font = '32px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🏋️', cx, cy);
  ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#059669';
  ctx.fillText('Hawaii Sports', cx, cy - 32);
  
  // Header
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, 80);
  ctx.fillStyle = '#059669'; ctx.fillRect(0, 80, W, 3);
  
  ctx.textAlign = 'left'; ctx.font = 'bold 28px Arial'; ctx.fillStyle = '#1f2937';
  ctx.fillText('🏋️ Hawaii Sports', 40, 45);
  ctx.fillStyle = '#059669';
  const hw = ctx.measureText('🏋️ Hawaii Sports').width;
  ctx.fillText(' Members Map', 40+hw, 45);
  ctx.font = '12px Arial'; ctx.fillStyle = '#6b7280';
  ctx.fillText('우리 회원님들의 비즈니스 네트워크 · 울란바토르', 40, 65);
  
  // Legend
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, H-55, W, 55);
  ctx.fillStyle = '#059669'; ctx.fillRect(0, H-55, W, 2);
  
  const legend = [['#dc2626','🍽️ 식당'],['#2563eb','🏪 매장'],['#16a34a','✂️ 서비스'],['#d97706','🏢 사무실'],['#db2777','💊 의료'],['#0d9488','🎓 교육']];
  let lx = 40;
  ctx.font = '11px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  legend.forEach(([color, text]) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(lx+5, H-27, 5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#4b5563'; ctx.fillText(text, lx+14, H-27);
    lx += ctx.measureText(text).width + 35;
  });
  ctx.textAlign = 'right'; ctx.fillStyle = '#9ca3af'; ctx.font = '10px Arial';
  ctx.fillText('📌 핀/스티커로 업장을 표시하세요', W-40, H-27);
  
  // Dot spots
  const spots = [[0.2,0.3],[0.35,0.5],[0.6,0.3],[0.75,0.5],[0.3,0.65],[0.65,0.65],[0.15,0.55],[0.85,0.35],[0.4,0.2],[0.7,0.75]];
  spots.forEach(([x,y]) => {
    ctx.strokeStyle = 'rgba(5,150,105,0.15)'; ctx.lineWidth = 1.5;
    ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.arc(x*W, y*H, 14, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
  });
  
  fs.writeFileSync(filename, c.toBuffer('image/png'));
  console.log(`✅ ${filename} (${fs.statSync(filename).size} bytes)`);
}

function drawDesign3(filename) {
  // DESIGN 3: Gold Luxury (블랙 + 골드)
  const W = 1200, H = 900;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  
  // Deep black BG
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H);
  
  // Subtle texture
  ctx.strokeStyle = 'rgba(212,175,55,0.03)'; ctx.lineWidth = 1;
  for(let x = 30; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 80); ctx.lineTo(x, H-80); ctx.stroke(); }
  for(let y = 80; y < H-80; y += 30) { ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W-30, y); ctx.stroke(); }
  
  // Gold border
  ctx.strokeStyle = 'rgba(212,175,55,0.5)'; ctx.lineWidth = 2;
  ctx.roundRect(12, 12, W-24, H-24, 16); ctx.stroke();
  ctx.strokeStyle = 'rgba(212,175,55,0.15)'; ctx.lineWidth = 1;
  ctx.roundRect(20, 20, W-40, H-40, 12); ctx.stroke();
  
  // Roads
  const roads = [
    [0.08, 0.4, 0.92, 0.4, true],
    [0.5, 0.12, 0.5, 0.85, true],
    [0.1, 0.25, 0.9, 0.25, false],
    [0.1, 0.55, 0.9, 0.55, false],
    [0.15, 0.7, 0.85, 0.7, false],
    [0.3, 0.12, 0.3, 0.82, false],
    [0.7, 0.12, 0.7, 0.82, false],
    [0.15, 0.18, 0.15, 0.78, false],
    [0.85, 0.18, 0.85, 0.78, false],
  ];
  roads.forEach(([x1,y1,x2,y2,main]) => {
    ctx.strokeStyle = main ? 'rgba(212,175,55,0.12)' : 'rgba(212,175,55,0.05)';
    ctx.lineWidth = main ? 2.5 : 1;
    ctx.beginPath(); ctx.moveTo(x1*W, y1*H); ctx.lineTo(x2*W, y2*H); ctx.stroke();
  });
  
  // Districts
  ctx.font = '600 10px Arial'; ctx.fillStyle = 'rgba(212,175,55,0.2)'; ctx.textAlign = 'center';
  [['СҮХБААТАР', 0.35, 0.16], ['ЧИНГЭЛТЭЙ', 0.65, 0.16],
   ['БАЯНГОЛ', 0.2, 0.48], ['БАЯНЗҮРХ', 0.8, 0.48],
   ['ХАН-УУЛ', 0.5, 0.78]].forEach(([n,x,y]) => ctx.fillText(n, x*W, y*H));
  
  // Center
  const cx = W*0.48, cy = H*0.4;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 55);
  glow.addColorStop(0, 'rgba(212,175,55,0.2)'); glow.addColorStop(1, 'rgba(212,175,55,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, 55, 0, Math.PI*2); ctx.fill();
  ctx.font = '34px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('👑', cx, cy);
  ctx.font = 'bold 14px Arial'; ctx.fillStyle = '#d4af37';
  ctx.fillText('HAWAII SPORTS', cx, cy - 33);
  ctx.font = '10px Arial'; ctx.fillStyle = 'rgba(212,175,55,0.4)';
  ctx.fillText('CENTER', cx, cy + 30);
  
  // Header
  ctx.fillStyle = 'rgba(10,10,10,0.95)'; ctx.fillRect(0, 0, W, 75);
  
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 24px Arial'; ctx.fillStyle = '#d4af37';
  ctx.fillText('👑  HAWAII SPORTS', 40, 35);
  ctx.fillStyle = '#e5e5e5'; ctx.font = '24px Arial';
  const hw = ctx.measureText('👑  HAWAII SPORTS').width;
  ctx.fillText('  ×  Our Members', 40+hw, 35);
  ctx.font = '12px Arial'; ctx.fillStyle = '#555';
  ctx.fillText('비즈니스 네트워크 맵  ·  울란바토르', 40, 58);
  
  // Gold line under header
  const goldLine = ctx.createLinearGradient(40, 73, W-40, 73);
  goldLine.addColorStop(0, 'transparent'); goldLine.addColorStop(0.2, '#d4af37');
  goldLine.addColorStop(0.8, '#d4af37'); goldLine.addColorStop(1, 'transparent');
  ctx.strokeStyle = goldLine; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, 73); ctx.lineTo(W-40, 73); ctx.stroke();
  
  // Legend
  ctx.fillStyle = 'rgba(10,10,10,0.95)'; ctx.fillRect(0, H-58, W, 58);
  const goldLine2 = ctx.createLinearGradient(40, H-58, W-40, H-58);
  goldLine2.addColorStop(0, 'transparent'); goldLine2.addColorStop(0.2, 'rgba(212,175,55,0.5)');
  goldLine2.addColorStop(0.8, 'rgba(212,175,55,0.5)'); goldLine2.addColorStop(1, 'transparent');
  ctx.strokeStyle = goldLine2; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, H-58); ctx.lineTo(W-40, H-58); ctx.stroke();
  
  const legend = [['#dc2626','🍽️ 식당/카페'],['#3b82f6','🏪 매장'],['#22c55e','✂️ 서비스'],['#f59e0b','🏢 사무실'],['#ec4899','💊 의료'],['#14b8a6','🎓 교육']];
  let lx = 40;
  ctx.font = '11px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  legend.forEach(([color, text]) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(lx+5, H-30, 5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#888'; ctx.fillText(text, lx+14, H-30);
    lx += ctx.measureText(text).width + 35;
  });
  ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(212,175,55,0.3)'; ctx.font = '10px Arial';
  ctx.fillText('📌 핀/스티커로 업장을 표시하세요', W-40, H-30);
  
  // Dot spots with gold
  const spots = [[0.2,0.3],[0.35,0.5],[0.6,0.3],[0.75,0.5],[0.3,0.65],[0.65,0.65],[0.15,0.55],[0.85,0.35],[0.4,0.2],[0.7,0.75]];
  spots.forEach(([x,y]) => {
    ctx.strokeStyle = 'rgba(212,175,55,0.1)'; ctx.lineWidth = 1.5;
    ctx.setLineDash([3,4]);
    ctx.beginPath(); ctx.arc(x*W, y*H, 15, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
  });
  
  fs.writeFileSync(filename, c.toBuffer('image/png'));
  console.log(`✅ ${filename} (${fs.statSync(filename).size} bytes)`);
}

drawDesign1('design1-dark-purple.png');
drawDesign2('design2-light-clean.png');
drawDesign3('design3-gold-luxury.png');
console.log('\n🎨 3가지 디자인 생성 완료!');
