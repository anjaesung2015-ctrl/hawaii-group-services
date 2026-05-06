const ExcelJS = require('exceljs');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'fitness.db'), { readonly: true });

async function generate() {
  const wb = new ExcelJS.Workbook();
  const now = new Date(Date.now() + 8 * 3600000);
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthName = `${year}년 ${month + 1}월`;
  const today = now.toISOString().split('T')[0];

  // Members with membership + attendance count
  const members = db.prepare(`
    SELECT m.id, m.name, m.phone, m.barcode_id,
      ms.start_date, ms.end_date, ms.status as ms_status,
      mt.name as type_name, mt.duration_days,
      CAST(julianday(ms.end_date) - julianday('now') as INTEGER) as days_left,
      CAST(julianday('now') - julianday(ms.start_date) as INTEGER) as days_used,
      CAST(julianday(ms.end_date) - julianday(ms.start_date) as INTEGER) as total_days,
      (SELECT COUNT(*) FROM attendance a WHERE a.member_id=m.id 
        AND a.check_in >= ms.start_date AND a.check_in <= ms.end_date||' 23:59:59') as visits
    FROM members m
    LEFT JOIN memberships ms ON m.id = ms.member_id AND ms.status = 'active'
    LEFT JOIN membership_types mt ON ms.type_id = mt.id
    WHERE m.status = 'active'
    ORDER BY ms.end_date ASC NULLS LAST, m.name
  `).all();

  const ws = wb.addWorksheet(`출석관리 ${monthName}`, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }]
  });

  // Colors
  const C = {
    purple: 'FF6366F1', dark: 'FF0F172A', card: 'FF1E293B', card2: 'FF334155',
    green: 'FF22C55E', yellow: 'FFF59E0B', red: 'FFEF4444', white: 'FFFFFFFF',
    gray: 'FF94A3B8', blue: 'FF3B82F6', orange: 'FFF97316',
    greenBg: 'FF0D331A', yellowBg: 'FF332B0D', redBg: 'FF330D0D',
  };

  // Columns: No | 이름 | 전화 | 회원권 | 시작 | 종료 | 등록일수 | 사용일수 | 남은일수 | 출석횟수 | 진행률 | 상태 | 비고
  const cols = [
    { header: 'No', width: 4 },
    { header: '이름', width: 13 },
    { header: '전화번호', width: 12 },
    { header: '회원권', width: 9 },
    { header: '시작일', width: 10 },
    { header: '종료일', width: 10 },
    { header: '등록\n일수', width: 6 },
    { header: '경과\n일수', width: 6 },
    { header: '남은\n일수', width: 6 },
    { header: '출석\n횟수', width: 6 },
    { header: '진행률', width: 12 },
    { header: '상태', width: 10 },
    { header: '재결제일', width: 10 },
  ];

  // === Title Row ===
  ws.mergeCells(1, 1, 1, cols.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `🏋️ Hawaii Sports 출석관리 — ${monthName} (${today} 기준)`;
  titleCell.font = { bold: true, size: 14, color: { argb: C.white } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.purple } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 32;

  // === Header Row ===
  cols.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width;
    const cell = ws.getCell(2, i + 1);
    cell.value = col.header;
    cell.font = { bold: true, size: 9, color: { argb: C.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.card2 } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: C.purple } } };
  });
  ws.getRow(2).height = 28;

  // === Data Rows ===
  members.forEach((m, idx) => {
    const row = idx + 3;
    const isEven = idx % 2 === 0;
    
    // Calculate status
    let status, statusColor, rowBg;
    const pct = m.total_days > 0 ? Math.round((m.days_used / m.total_days) * 100) : 0;
    
    if (!m.end_date) {
      status = '⚪ 미등록'; statusColor = C.gray; rowBg = isEven ? C.card : 'FF273548';
    } else if (m.days_left < 0) {
      status = '❌ 만료'; statusColor = C.red; rowBg = C.redBg;
    } else if (m.days_left <= 3) {
      status = '🔴 긴급결제'; statusColor = C.red; rowBg = C.redBg;
    } else if (m.days_left <= 7) {
      status = '🟡 곧만료'; statusColor = C.yellow; rowBg = C.yellowBg;
    } else if (m.days_left <= 14) {
      status = '🟠 2주내'; statusColor = C.orange; rowBg = isEven ? C.card : 'FF273548';
    } else {
      status = '🟢 정상'; statusColor = C.green; rowBg = isEven ? C.card : 'FF273548';
    }

    const fillStyle = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    const defBorder = {
      bottom: { style: 'hair', color: { argb: '22FFFFFF' } },
    };

    function setCell(col, value, opts = {}) {
      const cell = ws.getCell(row, col);
      cell.value = value;
      cell.font = { size: opts.size || 9, color: { argb: opts.color || C.white }, bold: opts.bold || false };
      cell.fill = fillStyle;
      cell.alignment = { horizontal: opts.align || 'center', vertical: 'middle' };
      cell.border = defBorder;
      return cell;
    }

    setCell(1, idx + 1, { size: 8, color: C.gray });
    setCell(2, m.name, { bold: true, size: 10, align: 'left' });
    setCell(3, m.phone || '-', { size: 8, color: C.gray });
    setCell(4, m.type_name || '-', { size: 8, color: C.blue });
    setCell(5, m.start_date ? m.start_date.slice(5) : '-', { size: 8, color: C.green });
    setCell(6, m.end_date ? m.end_date.slice(5) : '-', { size: 8, color: statusColor });
    setCell(7, m.total_days || '-', { size: 9, color: C.gray });
    setCell(8, m.days_used >= 0 ? m.days_used : '-', { size: 9, color: C.white });
    setCell(9, m.days_left != null ? m.days_left : '-', { size: 10, bold: true, color: statusColor });
    setCell(10, m.visits || 0, { size: 10, bold: true, color: m.visits > 0 ? C.green : C.gray });
    
    // Progress bar as text
    if (m.total_days > 0) {
      const filled = Math.round(pct / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
      setCell(11, `${bar} ${pct}%`, { size: 8, color: pct >= 90 ? C.red : pct >= 70 ? C.yellow : C.green });
    } else {
      setCell(11, '-', { color: C.gray });
    }
    
    setCell(12, status, { size: 8, bold: true, color: statusColor });
    
    // 재결제일 = 종료일
    if (m.end_date) {
      const renewDate = m.end_date.slice(5);
      const cell = setCell(13, renewDate, { size: 9, bold: true, color: m.days_left <= 7 ? C.red : C.yellow });
    } else {
      setCell(13, '-', { color: C.gray });
    }

    ws.getRow(row).height = 22;
  });

  // === Summary Section ===
  const sumStart = members.length + 4;
  
  // Count by status
  const expired = members.filter(m => m.days_left != null && m.days_left < 0).length;
  const urgent = members.filter(m => m.days_left != null && m.days_left >= 0 && m.days_left <= 3).length;
  const soon = members.filter(m => m.days_left != null && m.days_left > 3 && m.days_left <= 7).length;
  const twoWeek = members.filter(m => m.days_left != null && m.days_left > 7 && m.days_left <= 14).length;
  const ok = members.filter(m => m.days_left != null && m.days_left > 14).length;
  const noMs = members.filter(m => m.days_left == null).length;
  const totalVisits = members.reduce((s, m) => s + (m.visits || 0), 0);

  ws.mergeCells(sumStart, 1, sumStart, cols.length);
  const sumTitle = ws.getCell(sumStart, 1);
  sumTitle.value = `📊 요약 — 총 ${members.length}명 | 총 출석 ${totalVisits}회`;
  sumTitle.font = { bold: true, size: 11, color: { argb: C.purple } };
  sumTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.dark } };

  const stats = [
    [`❌ 만료 (재결제 필요)`, expired, C.red],
    [`🔴 3일 내 만료`, urgent, C.red],
    [`🟡 7일 내 만료`, soon, C.yellow],
    [`🟠 2주 내 만료`, twoWeek, C.orange],
    [`🟢 정상`, ok, C.green],
    [`⚪ 미등록`, noMs, C.gray],
  ];

  stats.forEach(([label, count, color], i) => {
    const r = sumStart + 1 + i;
    ws.mergeCells(r, 1, r, 3);
    const lCell = ws.getCell(r, 1);
    lCell.value = label;
    lCell.font = { size: 10, color: { argb: color } };
    lCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.dark } };
    
    const cCell = ws.getCell(r, 4);
    cCell.value = `${count}명`;
    cCell.font = { bold: true, size: 12, color: { argb: color } };
    cCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.dark } };
    cCell.alignment = { horizontal: 'center' };
  });

  // Print settings
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4 }
  };

  // Conditional formatting note
  const noteRow = sumStart + stats.length + 2;
  ws.mergeCells(noteRow, 1, noteRow, cols.length);
  ws.getCell(noteRow, 1).value = '💡 종료일 기준 정렬 — 맨 위부터 확인하면 재결제 대상 바로 파악! | 진행률 바로 회원권 소진율 확인';
  ws.getCell(noteRow, 1).font = { size: 9, color: { argb: C.gray } };

  const filename = `출석관리_${monthStr}.xlsx`;
  await wb.xlsx.writeFile(filename);
  console.log(`✅ ${filename} 생성 (${members.length}명)`);
}

generate().catch(console.error);
