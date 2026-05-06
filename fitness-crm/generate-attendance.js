const ExcelJS = require('exceljs');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'fitness.db'), { readonly: true });

async function generate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hawaii Sports';
  
  // Get current month info
  const now = new Date(Date.now() + 8 * 3600000); // UB time
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthName = `${year}년 ${month + 1}월`;
  
  // Get active members with membership info
  const members = db.prepare(`
    SELECT m.id, m.name, m.phone, m.barcode_id,
      ms.start_date, ms.end_date, ms.status as ms_status,
      mt.name as type_name, ms.price_paid,
      CAST(julianday(ms.end_date) - julianday('now') as INTEGER) as days_left
    FROM members m
    LEFT JOIN memberships ms ON m.id = ms.member_id AND ms.status = 'active'
    LEFT JOIN membership_types mt ON ms.type_id = mt.id
    WHERE m.status = 'active'
    ORDER BY ms.end_date ASC NULLS LAST, m.name
  `).all();

  // Get attendance data for current month
  const attendance = db.prepare(`
    SELECT member_id, date(check_in) as date, check_in, check_out
    FROM attendance
    WHERE strftime('%Y-%m', check_in) = ?
    ORDER BY check_in
  `).all(monthStr);

  // Build attendance map: member_id -> { date: true }
  const attMap = {};
  attendance.forEach(a => {
    if (!attMap[a.member_id]) attMap[a.member_id] = {};
    attMap[a.member_id][a.date] = true;
  });

  const ws = wb.addWorksheet(`출석부 ${monthName}`, {
    views: [{ state: 'frozen', xSplit: 6, ySplit: 3 }],
    properties: { defaultRowHeight: 22 }
  });

  // Colors
  const purple = 'FF6366F1';
  const darkBg = 'FF1E293B';
  const cardBg = 'FF334155';
  const green = 'FF22C55E';
  const yellow = 'FFF59E0B';
  const red = 'FFEF4444';
  const white = 'FFFFFFFF';
  const gray = 'FF94A3B8';
  const darkText = 'FF0F172A';

  // Column widths
  ws.getColumn(1).width = 4;   // No
  ws.getColumn(2).width = 14;  // 이름
  ws.getColumn(3).width = 13;  // 전화번호
  ws.getColumn(4).width = 11;  // 시작일
  ws.getColumn(5).width = 11;  // 종료일
  ws.getColumn(6).width = 8;   // 남은일
  for (let d = 1; d <= daysInMonth; d++) {
    ws.getColumn(6 + d).width = 3.5;
  }
  ws.getColumn(6 + daysInMonth + 1).width = 6;  // 출석합계
  ws.getColumn(6 + daysInMonth + 2).width = 8;  // 상태

  // === ROW 1: Title ===
  ws.mergeCells(1, 1, 1, 6 + daysInMonth + 2);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `🏋️ Hawaii Sports 출석부 — ${monthName}`;
  titleCell.font = { bold: true, size: 16, color: { argb: white } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: purple } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 35;

  // === ROW 2: Sub info ===
  ws.mergeCells(2, 1, 2, 6);
  const infoCell = ws.getCell(2, 1);
  infoCell.value = `총 회원: ${members.length}명 | 생성일: ${now.toISOString().split('T')[0]}`;
  infoCell.font = { size: 9, color: { argb: gray } };
  infoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: darkBg } };
  
  // Day of week labels in row 2
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    const cell = ws.getCell(2, 6 + d);
    cell.value = dayNames[dow];
    cell.font = { size: 7, color: { argb: dow === 0 ? red : dow === 6 ? 'FF3B82F6' : gray } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: darkBg } };
    cell.alignment = { horizontal: 'center' };
  }
  ws.getRow(2).height = 16;

  // === ROW 3: Headers ===
  const headers = ['No', '이름', '전화번호', '시작일', '종료일', '남은일'];
  headers.forEach((h, i) => {
    const cell = ws.getCell(3, i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 9, color: { argb: white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cardBg } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: purple } } };
  });
  
  // Date headers
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    const cell = ws.getCell(3, 6 + d);
    cell.value = d;
    cell.font = { bold: true, size: 8, color: { argb: dow === 0 ? red : dow === 6 ? 'FF3B82F6' : white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dow === 0 || dow === 6 ? 'FF1A1A2E' : cardBg } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: purple } } };
  }
  
  // Total & Status headers
  const totalCell = ws.getCell(3, 6 + daysInMonth + 1);
  totalCell.value = '출석';
  totalCell.font = { bold: true, size: 9, color: { argb: white } };
  totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cardBg } };
  totalCell.alignment = { horizontal: 'center' };
  
  const statusCell = ws.getCell(3, 6 + daysInMonth + 2);
  statusCell.value = '결제상태';
  statusCell.font = { bold: true, size: 9, color: { argb: white } };
  statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cardBg } };
  statusCell.alignment = { horizontal: 'center' };
  
  ws.getRow(3).height = 24;

  // === DATA ROWS ===
  members.forEach((m, idx) => {
    const row = idx + 4;
    const isEven = idx % 2 === 0;
    const rowBg = isEven ? 'FF1E293B' : 'FF273548';
    
    // Determine urgency
    let urgencyColor = green;
    let urgencyText = '';
    let statusText = '🟢';
    if (!m.end_date) {
      urgencyColor = gray;
      urgencyText = '-';
      statusText = '⚪ 미등록';
    } else if (m.days_left < 0) {
      urgencyColor = red;
      urgencyText = '만료';
      statusText = '❌ 만료';
    } else if (m.days_left <= 3) {
      urgencyColor = red;
      urgencyText = `${m.days_left}일`;
      statusText = '🔴 긴급';
    } else if (m.days_left <= 7) {
      urgencyColor = yellow;
      urgencyText = `${m.days_left}일`;
      statusText = '🟡 임박';
    } else {
      urgencyText = `${m.days_left}일`;
      statusText = '🟢 정상';
    }

    // No
    const noCell = ws.getCell(row, 1);
    noCell.value = idx + 1;
    noCell.font = { size: 8, color: { argb: gray } };
    noCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    noCell.alignment = { horizontal: 'center' };

    // Name
    const nameCell = ws.getCell(row, 2);
    nameCell.value = m.name;
    nameCell.font = { bold: true, size: 10, color: { argb: white } };
    nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };

    // Phone
    const phoneCell = ws.getCell(row, 3);
    phoneCell.value = m.phone || '';
    phoneCell.font = { size: 8, color: { argb: gray } };
    phoneCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };

    // Start date
    const startCell = ws.getCell(row, 4);
    startCell.value = m.start_date ? m.start_date.slice(5) : '-';
    startCell.font = { size: 8, color: { argb: green } };
    startCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    startCell.alignment = { horizontal: 'center' };

    // End date
    const endCell = ws.getCell(row, 5);
    endCell.value = m.end_date ? m.end_date.slice(5) : '-';
    endCell.font = { size: 8, color: { argb: urgencyColor } };
    endCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    endCell.alignment = { horizontal: 'center' };

    // Days left
    const daysCell = ws.getCell(row, 6);
    daysCell.value = urgencyText;
    daysCell.font = { bold: true, size: 9, color: { argb: urgencyColor } };
    daysCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    daysCell.alignment = { horizontal: 'center' };
    
    // Highlight row if urgent
    if (m.days_left !== null && m.days_left <= 3) {
      for (let c = 1; c <= 6; c++) {
        ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B1515' } };
      }
    } else if (m.days_left !== null && m.days_left <= 7) {
      for (let c = 1; c <= 6; c++) {
        ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B2E15' } };
      }
    }

    // Attendance cells
    let attCount = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = new Date(year, month, d).getDay();
      const cell = ws.getCell(row, 6 + d);
      
      const isAttended = attMap[m.id] && attMap[m.id][dateStr];
      const isFuture = new Date(year, month, d) > now;
      const isToday = d === now.getDate();
      
      if (isAttended) {
        cell.value = '✓';
        cell.font = { bold: true, size: 9, color: { argb: green } };
        attCount++;
      } else if (isToday) {
        cell.value = '·';
        cell.font = { size: 8, color: { argb: yellow } };
      } else if (isFuture) {
        cell.value = '';
      } else {
        cell.value = '';
      }
      
      let cellBg = rowBg;
      if (dow === 0 || dow === 6) cellBg = isEven ? 'FF1A1A2E' : 'FF222240';
      if (isToday) cellBg = 'FF2D2B55';
      
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cellBg } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        left: { style: 'hair', color: { argb: '33FFFFFF' } },
        right: { style: 'hair', color: { argb: '33FFFFFF' } },
      };
    }

    // Total attendance
    const attTotalCell = ws.getCell(row, 6 + daysInMonth + 1);
    attTotalCell.value = attCount;
    attTotalCell.font = { bold: true, size: 10, color: { argb: attCount > 0 ? green : gray } };
    attTotalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    attTotalCell.alignment = { horizontal: 'center' };

    // Status
    const stCell = ws.getCell(row, 6 + daysInMonth + 2);
    stCell.value = statusText;
    stCell.font = { size: 8, color: { argb: urgencyColor } };
    stCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    stCell.alignment = { horizontal: 'center' };
  });

  // === SUMMARY ROW ===
  const sumRow = members.length + 4;
  ws.mergeCells(sumRow, 1, sumRow, 5);
  const sumCell = ws.getCell(sumRow, 1);
  sumCell.value = `총 ${members.length}명`;
  sumCell.font = { bold: true, size: 10, color: { argb: purple } };
  sumCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: darkBg } };
  
  // Daily attendance totals
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let dayTotal = 0;
    Object.values(attMap).forEach(dates => { if (dates[dateStr]) dayTotal++; });
    
    const cell = ws.getCell(sumRow, 6 + d);
    cell.value = dayTotal || '';
    cell.font = { bold: true, size: 8, color: { argb: dayTotal > 0 ? purple : gray } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: darkBg } };
    cell.alignment = { horizontal: 'center' };
  }

  // === LEGEND ROW ===
  const legRow = sumRow + 2;
  ws.mergeCells(legRow, 1, legRow, 8);
  ws.getCell(legRow, 1).value = '범례: 🟢 정상 | 🟡 7일 이내 만료 | 🔴 3일 이내 만료 | ❌ 만료 (재결제 필요) | ✓ 출석';
  ws.getCell(legRow, 1).font = { size: 9, color: { argb: gray } };

  // Print settings
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9, // A4
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4 }
  };

  const filename = `출석부_${monthStr}.xlsx`;
  await wb.xlsx.writeFile(filename);
  console.log(`✅ ${filename} 생성 완료 (${members.length}명)`);
}

generate().catch(e => console.error(e));
