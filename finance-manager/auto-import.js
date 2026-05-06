/**
 * auto-import.js
 * 월간 리포트 엑셀 → 재무 관리 DB 자동 입력
 * 사용법: node auto-import.js <엑셀파일경로>
 * 예) node auto-import.js ~/Downloads/monthly-report.xlsx
 */

const path = require('path');
const db = require('./db');

// xlsx 없으면 설치
let XLSX;
try {
  XLSX = require('xlsx');
} catch(e) {
  console.log('xlsx 패키지 없음. 설치 중...');
  require('child_process').execSync('npm install xlsx', { cwd: __dirname, stdio: 'inherit' });
  XLSX = require('xlsx');
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('사용법: node auto-import.js <엑셀파일경로>');
  process.exit(1);
}

const absPath = path.resolve(filePath);
console.log('파일 읽는 중:', absPath);

const wb = XLSX.readFile(absPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

// 헤더 찾기 (일짜, 수입, 지출)
let headerRow = -1;
for (let i = 0; i < rows.length; i++) {
  if (rows[i] && rows[i][0] && String(rows[i][0]).includes('일짜')) {
    headerRow = i;
    break;
  }
}

if (headerRow === -1) {
  console.error('헤더 행 (일짜/수입/지출) 을 찾을 수 없습니다.');
  process.exit(1);
}

// 연월 추출 (첫 행)
let yearMonth = '2026-04';
for (let i = 0; i < rows.length; i++) {
  const cell = rows[i] && rows[i][0];
  if (cell && String(cell).match(/\d{4}-\d{2}월?/)) {
    const m = String(cell).match(/(\d{4})-(\d{2})/);
    if (m) yearMonth = `${m[1]}-${m[2]}`;
    break;
  }
}
console.log('연월:', yearMonth);

const insertTx = db.prepare(`
  INSERT INTO transactions (business_id, category_id, type, amount, description, payment_method, transaction_date, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const importAll = db.transaction((entries) => {
  let count = 0;
  entries.forEach(e => {
    insertTx.run(...e);
    count++;
  });
  return count;
});

const entries = [];
let skipped = 0;

for (let i = headerRow + 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row || !row[0]) continue;

  const label = String(row[0]).trim();
  const income = Number(row[1]) || 0;
  const expense = Number(row[2]) || 0;
  const note = row[3] ? String(row[3]).trim() : '';

  // 숫자 일자 처리 (1일~31일)
  const dayMatch = label.match(/^(\d+)일$/);
  if (dayMatch) {
    const day = String(dayMatch[1]).padStart(2, '0');
    const txDate = `${yearMonth}-${day}`;

    if (income > 0) {
      // 이미 같은 날짜+금액+설명 있으면 스킵
      const exists = db.prepare(
        "SELECT id FROM transactions WHERE transaction_date=? AND type='income' AND amount=? AND description LIKE ?"
      ).get(txDate, income, `%${day}일 매출%`);
      if (!exists) {
        entries.push([2, 36, 'income', income, `${day}일 매출${note ? ' - ' + note : ''}`, 'mixed', txDate, 1]);
      } else {
        skipped++;
      }
    }
    if (expense > 0) {
      const exists = db.prepare(
        "SELECT id FROM transactions WHERE transaction_date=? AND type='expense' AND amount=? AND description LIKE ?"
      ).get(txDate, expense, `%${day}일 지출%`);
      if (!exists) {
        entries.push([2, 49, 'expense', expense, `${day}일 지출${note ? ' - ' + note : ''}`, 'mixed', txDate, 1]);
      } else {
        skipped++;
      }
    }
    continue;
  }

  // 특별 항목 (karate, box, cafe, protein 등)
  if (label.toLowerCase().includes('karate')) {
    if (income > 0) entries.push([2, 80, 'income', income, `가라데 수입 (${label})`, 'mixed', yearMonth + '-01', 1]);
    continue;
  }
  if (label.toLowerCase().includes('box')) {
    const dateMatch = label.match(/(\d{2})\/(\d{2})/);
    const txDate = dateMatch ? `${yearMonth.split('-')[0]}-${dateMatch[1]}-${dateMatch[2]}` : yearMonth + '-01';
    if (income > 0) entries.push([2, 81, 'income', income, `복싱 수입 (${label})`, 'mixed', txDate, 1]);
    continue;
  }
  if (label.toLowerCase().includes('cafe') || label.toLowerCase().includes('protein')) {
    const dateMatch = label.match(/(\d{2})\/(\d{2})/);
    const txDate = dateMatch ? `${yearMonth.split('-')[0]}-${dateMatch[1]}-${dateMatch[2]}` : yearMonth + '-01';
    if (income > 0) entries.push([2, 82, 'income', income, `카페/프로틴 수입 (${label})`, 'mixed', txDate, 1]);
    continue;
  }

  // 합계 행 스킵
  if (label === '합계' || label === '총합계') continue;
}

if (entries.length === 0) {
  console.log('⚠️ 새로 입력할 데이터 없음 (모두 기존 입력됨 또는 빈 항목)');
  console.log(`스킵: ${skipped}건`);
} else {
  const count = importAll(entries);
  console.log(`✅ ${count}건 입력 완료! (중복 스킵: ${skipped}건)`);
}
