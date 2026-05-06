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
  const today = now.toISOString().split('T')[0];

  const members = db.prepare(`
    SELECT m.id, m.name, m.phone,
      ms.start_date, ms.end_date,
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

  const ws = wb.addWorksheet('출석관리', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }]
  });

  // Simple columns - no emoji
  const cols = [
    { key: 'no', header: 'No', width: 5 },
    { key: 'name', header: '이름', width: 14 },
    { key: 'phone', header: '전화번호', width: 13 },
    { key: 'type', header: '회원권', width: 10 },
    { key: 'start', header: '시작일', width: 11 },
    { key: 'end', header: '종료일', width: 11 },
    { key: 'total', header: '등록일수', width: 8 },
    { key: 'used', header: '경과일수', width: 8 },
    { key: 'left', header: '남은일수', width: 8 },
    { key: 'visits', header: '출석횟수', width: 8 },
    { key: 'pct', header: '진행률%', width: 8 },
    { key: 'status', header: '상태', width: 10 },
    { key: 'renew', header: '재결제일', width: 11 },
  ];

  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  // Title row
  ws.mergeCells(1, 1, 1, cols.length);
  const title = ws.getCell(1, 1);
  title.value = `Hawaii Sports 출석관리 - ${year}년 ${month+1}월 (${today} 기준)`;
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  title.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).height = 30;

  // Header row
  cols.forEach((c, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { 
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'hair', color: { argb: 'FF808080' } }
    };
  });
  ws.getRow(2).height = 24;

  // Data rows
  members.forEach((m, idx) => {
    const row = idx + 3;
    const pct = m.total_days > 0 ? Math.round((m.days_used / m.total_days) * 100) : 0;
    
    let status, statusColor;
    if (!m.end_date) { status = '미등록'; statusColor = 'FF808080'; }
    else if (m.days_left < 0) { status = '*** 만료 ***'; statusColor = 'FFFF0000'; }
    else if (m.days_left <= 3) { status = '!! 긴급 !!'; statusColor = 'FFFF0000'; }
    else if (m.days_left <= 7) { status = '! 임박 !'; statusColor = 'FFFF8C00'; }
    else if (m.days_left <= 14) { status = '주의'; statusColor = 'FFFFC000'; }
    else { status = '정상'; statusColor = 'FF00B050'; }

    // Row background for urgent
    let rowBg = idx % 2 === 0 ? 'FFF2F2F2' : 'FFFFFFFF';
    if (m.days_left != null && m.days_left < 0) rowBg = 'FFFFF0F0';
    else if (m.days_left != null && m.days_left <= 3) rowBg = 'FFFFF0F0';
    else if (m.days_left != null && m.days_left <= 7) rowBg = 'FFFFFBE6';

    const fillStyle = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    const border = { 
      bottom: { style: 'hair', color: { argb: 'FFD0D0D0' } },
      right: { style: 'hair', color: { argb: 'FFE0E0E0' } }
    };

    function setCell(col, val, opts = {}) {
      const cell = ws.getCell(row, col);
      cell.value = val;
      cell.font = { size: opts.size || 9, color: { argb: opts.color || 'FF333333' }, bold: opts.bold || false };
      cell.fill = fillStyle;
      cell.alignment = { horizontal: opts.align || 'center', vertical: 'middle' };
      cell.border = border;
    }

    setCell(1, idx + 1, { color: 'FF999999' });
    setCell(2, m.name, { bold: true, size: 10, align: 'left' });
    setCell(3, m.phone || '-', { color: 'FF666666' });
    setCell(4, m.type_name || '-', { color: 'FF4472C4' });
    setCell(5, m.start_date || '-');
    setCell(6, m.end_date || '-', { color: statusColor, bold: m.days_left != null && m.days_left <= 7 });
    setCell(7, m.total_days || '-');
    setCell(8, m.days_used >= 0 ? m.days_used : '-');
    setCell(9, m.days_left != null ? m.days_left : '-', { bold: true, size: 11, color: statusColor });
    setCell(10, m.visits || 0, { bold: true, color: m.visits > 0 ? 'FF00B050' : 'FF999999' });
    setCell(11, m.total_days > 0 ? pct + '%' : '-', { color: pct >= 90 ? 'FFFF0000' : pct >= 70 ? 'FFFF8C00' : 'FF00B050' });
    setCell(12, status, { bold: true, color: statusColor });
    setCell(13, m.end_date || '-', { bold: m.days_left != null && m.days_left <= 7, color: statusColor });

    ws.getRow(row).height = 20;
  });

  // Summary
  const sr = members.length + 4;
  const expired = members.filter(m => m.days_left != null && m.days_left < 0).length;
  const urgent = members.filter(m => m.days_left != null && m.days_left >= 0 && m.days_left <= 3).length;
  const soon = members.filter(m => m.days_left != null && m.days_left > 3 && m.days_left <= 7).length;
  const ok = members.filter(m => m.days_left != null && m.days_left > 7).length;

  ws.mergeCells(sr, 1, sr, 4);
  ws.getCell(sr, 1).value = `총 ${members.length}명`;
  ws.getCell(sr, 1).font = { bold: true, size: 11 };

  const stats = [
    [sr+1, '만료 (재결제!)', expired, 'FFFF0000'],
    [sr+2, '3일내 만료', urgent, 'FFFF0000'],
    [sr+3, '7일내 만료', soon, 'FFFF8C00'],
    [sr+4, '정상', ok, 'FF00B050'],
  ];
  stats.forEach(([r, label, cnt, color]) => {
    ws.mergeCells(r, 1, r, 3);
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { size: 10 };
    ws.getCell(r, 4).value = cnt + '명';
    ws.getCell(r, 4).font = { bold: true, size: 11, color: { argb: color } };
  });

  // Auto-filter
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: members.length + 2, column: cols.length } };

  // Print
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const filename = `출석관리_${monthStr}.xlsx`;
  await wb.xlsx.writeFile(filename);
  console.log(`Done: ${filename}`);
}

generate().catch(console.error);
