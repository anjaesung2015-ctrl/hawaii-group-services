const { createCanvas } = require('canvas');
const fs = require('fs');

const W = 1200, H = 900;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

// Background
const bgGrad = ctx.createLinearGradient(0, 0, W, H);
bgGrad.addColorStop(0, '#0f172a');
bgGrad.addColorStop(0.5, '#1a1a2e');
bgGrad.addColorStop(1, '#16213e');
ctx.fillStyle = bgGrad;
ctx.fillRect(0, 0, W, H);

// Border
ctx.strokeStyle = 'rgba(139,92,246,0.3)';
ctx.lineWidth = 3;
ctx.roundRect(1, 1, W-2, H-2, 20);
ctx.stroke();

// Roads
function drawRoad(x1, y1, x2, y2, main) {
  ctx.strokeStyle = main ? 'rgba(100,116,139,0.25)' : 'rgba(100,116,139,0.12)';
  ctx.lineWidth = main ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// Horizontal roads
drawRoad(0, H*0.42, W, H*0.42, true);    // Peace Ave (main)
drawRoad(W*0.1, H*0.28, W*0.9, H*0.28);
drawRoad(W*0.05, H*0.55, W*0.95, H*0.55);
drawRoad(W*0.15, H*0.68, W*0.85, H*0.68);
drawRoad(W*0.2, H*0.18, W*0.8, H*0.18);

// Vertical roads
drawRoad(W*0.5, H*0.1, W*0.5, H*0.85, true);
drawRoad(W*0.3, H*0.15, W*0.3, H*0.8);
drawRoad(W*0.7, H*0.12, W*0.7, H*0.82);
drawRoad(W*0.15, H*0.22, W*0.15, H*0.75);
drawRoad(W*0.85, H*0.18, W*0.85, H*0.78);

// Diagonal (for visual interest)
ctx.strokeStyle = 'rgba(100,116,139,0.08)';
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(W*0.2, H*0.15);
ctx.lineTo(W*0.45, H*0.45);
ctx.stroke();
ctx.beginPath();
ctx.moveTo(W*0.8, H*0.15);
ctx.lineTo(W*0.55, H*0.45);
ctx.stroke();

// Districts
ctx.font = '600 11px Arial, sans-serif';
ctx.fillStyle = 'rgba(148,163,184,0.4)';
ctx.letterSpacing = '2px';
const districts = [
  ['СҮХБААТАР ДҮҮРЭГ', W*0.22, H*0.14],
  ['ЧИНГЭЛТЭЙ ДҮҮРЭГ', W*0.63, H*0.14],
  ['БАЯНГОЛ ДҮҮРЭГ', W*0.08, H*0.52],
  ['БАЯНЗҮРХ ДҮҮРЭГ', W*0.72, H*0.52],
  ['ХАН-УУЛ ДҮҮРЭГ', W*0.42, H*0.82],
];
districts.forEach(([name, x, y]) => {
  ctx.fillText(name, x, y);
});

// Pin drawing function
function drawPin(x, y, color1, color2, emoji, label, isCenter) {
  const size = isCenter ? 28 : 20;
  
  // Glow
  const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, size * 2.5);
  glowGrad.addColorStop(0, color1 + '40');
  glowGrad.addColorStop(1, color1 + '00');
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
  ctx.fill();
  
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y + size + 4, size * 0.5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Pin body (teardrop)
  const pinGrad = ctx.createLinearGradient(x - size, y - size * 2, x + size, y);
  pinGrad.addColorStop(0, color1);
  pinGrad.addColorStop(1, color2);
  ctx.fillStyle = pinGrad;
  
  ctx.beginPath();
  ctx.arc(x, y - size, size, Math.PI * 0.8, Math.PI * 0.2, true);
  ctx.lineTo(x, y + 4);
  ctx.closePath();
  ctx.fill();
  
  // White circle inside
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.arc(x, y - size, size * 0.65, 0, Math.PI * 2);
  ctx.fill();
  
  // Emoji
  ctx.font = `${isCenter ? 22 : 15}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, x, y - size);
  
  // Label
  if (label) {
    ctx.font = `${isCenter ? 'bold 13' : 'bold 11'}px Arial, sans-serif`;
    const metrics = ctx.measureText(label);
    const lw = metrics.width + (isCenter ? 28 : 20);
    const lh = isCenter ? 28 : 22;
    const ly = y - size * 2 - (isCenter ? 16 : 10);
    
    // Label background
    if (isCenter) {
      const lblGrad = ctx.createLinearGradient(x - lw/2, ly, x + lw/2, ly);
      lblGrad.addColorStop(0, '#8b5cf6');
      lblGrad.addColorStop(1, '#6d28d9');
      ctx.fillStyle = lblGrad;
    } else {
      ctx.fillStyle = 'rgba(15,23,42,0.9)';
    }
    
    ctx.beginPath();
    ctx.roundRect(x - lw/2, ly - lh/2, lw, lh, 8);
    ctx.fill();
    
    if (!isCenter) {
      ctx.strokeStyle = 'rgba(139,92,246,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    
    ctx.fillStyle = '#f1f5f9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, ly);
  }
}

// Connection lines from center to pins
const centerX = W * 0.48, centerY = H * 0.42;
const pins = [
  [W*0.33, H*0.30, '#ef4444', '#dc2626', '🍽️', '예: 식당 A'],
  [W*0.62, H*0.24, '#3b82f6', '#2563eb', '🏪', '예: 매장 B'],
  [W*0.22, H*0.50, '#22c55e', '#16a34a', '✂️', '예: 서비스 C'],
  [W*0.74, H*0.45, '#f59e0b', '#d97706', '🏢', '예: 사무실 D'],
  [W*0.38, H*0.62, '#ec4899', '#db2777', '💊', '예: 병원 E'],
  [W*0.60, H*0.65, '#14b8a6', '#0d9488', '🎓', '예: 학원 F'],
  [W*0.82, H*0.33, '#ef4444', '#dc2626', '☕', '예: 카페 G'],
  [W*0.16, H*0.35, '#3b82f6', '#2563eb', '👗', '예: 의류 H'],
];

// Draw connection lines
pins.forEach(([px, py]) => {
  ctx.strokeStyle = 'rgba(139,92,246,0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(px, py);
  ctx.stroke();
  ctx.setLineDash([]);
});

// Draw pins
pins.forEach(([x, y, c1, c2, emoji, label]) => {
  drawPin(x, y, c1, c2, emoji, label, false);
});

// Draw center pin last (on top)
drawPin(centerX, centerY, '#8b5cf6', '#6d28d9', '🏋️', '⭐ Hawaii Sports', true);

// Header
ctx.fillStyle = 'rgba(15,23,42,0.95)';
ctx.fillRect(0, 0, W, 75);
// Fade
const fadeGrad = ctx.createLinearGradient(0, 75, 0, 110);
fadeGrad.addColorStop(0, 'rgba(15,23,42,0.6)');
fadeGrad.addColorStop(1, 'transparent');
ctx.fillStyle = fadeGrad;
ctx.fillRect(0, 75, W, 35);

ctx.font = 'bold 28px Arial, sans-serif';
ctx.textAlign = 'left';
ctx.textBaseline = 'middle';
ctx.fillStyle = '#f1f5f9';
ctx.fillText('🏋️  ', 40, 42);
ctx.fillStyle = '#8b5cf6';
ctx.fillText('Hawaii Sports', 85, 42);
ctx.fillStyle = '#f1f5f9';
const hsw = ctx.measureText('Hawaii Sports').width;
ctx.fillText(' × Our Members', 85 + hsw, 42);
ctx.font = '13px Arial, sans-serif';
ctx.fillStyle = '#64748b';
ctx.fillText('우리 회원님들의 비즈니스 네트워크 · 울란바토르', 40, 65);

// Legend bar
ctx.fillStyle = 'rgba(15,23,42,0.9)';
ctx.fillRect(0, H - 65, W, 65);
const fadeGrad2 = ctx.createLinearGradient(0, H - 95, 0, H - 65);
fadeGrad2.addColorStop(0, 'transparent');
fadeGrad2.addColorStop(1, 'rgba(15,23,42,0.6)');
ctx.fillStyle = fadeGrad2;
ctx.fillRect(0, H - 95, W, 30);

const legendItems = [
  ['#ef4444', '식당/카페'],
  ['#3b82f6', '매장/소매'],
  ['#22c55e', '서비스'],
  ['#f59e0b', '사무실/기업'],
  ['#ec4899', '의료/건강'],
  ['#14b8a6', '교육'],
  ['#8b5cf6', '⭐ Hawaii Sports'],
];

let lx = 40;
ctx.font = '12px Arial, sans-serif';
legendItems.forEach(([color, text]) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(lx + 5, H - 32, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx + 14, H - 32);
  lx += ctx.measureText(text).width + 35;
});

// Total count
ctx.textAlign = 'right';
ctx.font = 'bold 32px Arial, sans-serif';
ctx.fillStyle = '#8b5cf6';
ctx.fillText('8', W - 45, H - 38);
ctx.font = '12px Arial, sans-serif';
ctx.fillStyle = '#64748b';
ctx.fillText('회원 업장', W - 45, H - 18);

// Save
const buf = canvas.toBuffer('image/png');
fs.writeFileSync('customer-map.png', buf);
console.log('✅ customer-map.png generated (' + buf.length + ' bytes)');
