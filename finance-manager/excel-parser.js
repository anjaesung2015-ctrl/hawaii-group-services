/**
 * excel-parser.js
 * Hawaii Finance Manager - Excel Auto Import
 * 
 * 지원 포맷:
 *   - Hawaii Fitness: "4.숫자" or "4-숫자" 패턴 (Sheet1)
 *     → 회원권 (category_id=36, business_id=2) + 음료/간식 (category_id=82, business_id=2)
 *   - Hawaii Sport Center: "04.숫자" or center 패턴 (Sheet2)
 *     → 코트대여 (category_id=22, business_id=1) + 마트/식당 (category_id=73, business_id=1)
 */

const XLSX = require('xlsx');

/**
 * 날짜가 합리적인지 확인 (2025-01-01 ~ 2027-12-31)
 */
function isReasonableDate(dateStr) {
  if (!dateStr) return false;
  const y = parseInt(dateStr.slice(0, 4));
  return y >= 2025 && y <= 2027;
}

/**
 * 파일명으로 타입 감지
 * @returns 'fitness' | 'center' | 'unknown'
 */
function detectTypeFromHeader(wb) {
  // 월간 일짜/수입/지출 형식 감지 (sheet 어디에든 "일짜" 헤더가 있으면 monthly)
  // 컬럼이 한 칸 밀려있는 경우도 지원 (col 0~3 중 어디든 OK)
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    for (const row of rows.slice(0, 10)) {
      if (!row) continue;
      for (let off = 0; off < 4; off++) {
        const c0 = row[off] != null ? String(row[off]).trim() : '';
        const c1 = row[off+1] != null ? String(row[off+1]).trim() : '';
        const c2 = row[off+2] != null ? String(row[off+2]).trim() : '';
        if (c0.includes('일짜') && (c1.includes('수입') || /orlogo/i.test(c1)) && (c2.includes('지출') || /zarlaga/i.test(c2))) {
          return 'monthly';
        }
      }
    }
  }
  // 첫 시트의 상위 5행 모든 셀에서 타입 키워드 검색 (row 0이 빈 경우 대비)
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  for (const row of rows.slice(0, 5)) {
    if (!row) continue;
    for (const cell of row) {
      if (cell == null) continue;
      const s = String(cell).toLowerCase().trim();
      if (s.includes('shop')) return 'shop';
      if (s.includes('fitness') || s.includes('gym')) return 'fitness';
      if (s.includes('sport center') || s.includes('sport centre')) return 'center';
    }
  }
  return null;
}

function detectFileType(filename) {
  const base = filename.toLowerCase().replace(/---.*$/, '');

  // 월간 종합: "전체매출지출", "sariin-orlogo-zarlaga", "월간", "monthly", "report"
  if (base.includes('전체매출') || base.includes('전체지출') || base.includes('매출지출')
      || base.includes('sariin') || base.includes('orlogo-zarlaga')
      || base.includes('월간') || base.includes('monthly')
      || base.includes('report')) return 'monthly';

  // Center: "04.숫자", "04-숫자", "04.20-1" 등
  if (/^0[1-9]\.\d/.test(base) || /^0[1-9]-\d/.test(base)) return 'center';

  // Fitness: "4.숫자", "4-숫자" (앞에 0 없음)
  if (/^[1-9]\.\d/.test(base) || /^[1-9]-\d/.test(base)) return 'fitness';

  return 'unknown';
}

/**
 * 엑셀에서 날짜 추출 (첫 5행에서 날짜 셀 검색)
 * 피트니스/센터 모두 1행 헤더에 날짜 serial이 있음
 */
function extractDate(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  
  for (const row of rows.slice(0, 5)) {
    if (!row) continue;
    for (const cell of row) {
      if (cell instanceof Date) {
        return cell.toISOString().split('T')[0];
      }
      // Excel serial number (날짜): 2025-01-01=45658, 2027-12-31=47483
      if (typeof cell === 'number' && cell >= 45658 && cell <= 47483) {
        const d = XLSX.SSF.parse_date_code(cell);
        if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
      }
    }
  }
  
  return null;
}

/**
 * 파일명에서 날짜 추출
 * "04.20-1---uuid.xlsx" → "2026-04-20"
 * "4.19---uuid.xlsx" → "2026-04-19"
 */
function extractDateFromFilename(filename) {
  const base = filename.replace(/---.*$/, '');
  const m = base.match(/(\d{1,2})[.\-](\d{1,2})/);
  if (m) {
    const month = String(parseInt(m[1])).padStart(2, '0');
    const day   = String(parseInt(m[2])).padStart(2, '0');
    const year  = new Date().getFullYear();
    return `${year}-${month}-${day}`;
  }
  return new Date().toISOString().split('T')[0];
}

/**
 * Fitness 엑셀 파싱 (Sheet1)
 * 구조:
 *   행1: Hawaii Fitness | ... | 날짜(serial)
 *   행2: No. | Name | Card No | Phone No | Period | ... | Sum | | No. | Contents | Price | Qty | Sum
 *   행3~: 회원권 데이터 (col 0~11) + 음료 데이터 (col 13~17)
 *   마지막: Sum 행
 */
function parseFitness(wb, filename) {
  const ws = wb.Sheets['Sheet1'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  
  // 파일명 날짜 우선 (직원이 엑셀 날짜를 자주 안 바꿈)
  const filenameDate = extractDateFromFilename(filename);
  const sheetDate = extractDate(ws);
  const date = filenameDate || (sheetDate && isReasonableDate(sheetDate) ? sheetDate : null) || new Date().toISOString().split('T')[0];
  
  // Sum 행 찾기 - 'Sum' 라벨이 col 0 또는 col 1에 있을 수 있음
  // 음료 섹션 헤더(No./Name/Price)를 만나기 전까지는 회원권, 이후는 음료
  let memberSum = 0;
  let drinkSum = 0;
  let inDrinkSection = false;
  
  for (const row of rows) {
    if (!row) continue;
    
    // 음료 섹션 시작 헤더 감지
    if (row[0] === 'No.' && row[1] === 'Name' && row[2] === 'Price') {
      inDrinkSection = true;
      continue;
    }
    
    const c0 = row[0] ? String(row[0]).trim().toLowerCase() : '';
    const c1 = row[1] ? String(row[1]).trim().toLowerCase() : '';
    const isSum = c0 === 'sum' || c1 === 'sum';
    if (!isSum) continue;
    
    if (!inDrinkSection) {
      // 회원권 Sum (col 11)
      if (typeof row[11] === 'number' && row[11] > 0 && memberSum === 0) {
        memberSum = row[11];
      }
    } else {
      // 음료 Sum (col 10)
      if (typeof row[10] === 'number' && row[10] > 0 && drinkSum === 0) {
        drinkSum = row[10];
      }
    }
  }
  
  // Sum이 0이면 직접 계산
  if (memberSum === 0) {
    for (const row of rows) {
      if (!row || !row[0]) continue;
      const no = row[0];
      if (typeof no === 'number' && no > 0 && no < 100) {
        const sum = row[11];
        if (sum && typeof sum === 'number' && sum > 0) memberSum += sum;
      }
    }
  }
  
  if (drinkSum === 0) {
    // 두 번째 섹션 찾기 (No./Name/Price/Qty 헤더)
    let inDrinkSection = false;
    for (const row of rows) {
      if (!row) continue;
      if (row[0] === 'No.' && row[1] === 'Name' && row[2] === 'Price') {
        inDrinkSection = true;
        continue;
      }
      if (inDrinkSection && (row[0] === 'Sum' || row[1] === 'Sum')) {
        drinkSum = row[10] || 0;
        break;
      }
    }
  }
  
  const result = [];
  
  if (memberSum > 0) {
    result.push({
      business_id: 2,
      category_id: 36,
      type: 'income',
      amount: memberSum,
      description: `${date.slice(5).replace('-','/')} 회원권 매출`,
      payment_method: 'mixed',
      transaction_date: date
    });
  }
  
  if (drinkSum > 0) {
    result.push({
      business_id: 2,
      category_id: 82,
      type: 'income',
      amount: drinkSum,
      description: `${date.slice(5).replace('-','/')} 카페/프로틴 매출`,
      payment_method: 'mixed',
      transaction_date: date
    });
  }
  
  return { type: 'fitness', date, entries: result, memberSum, drinkSum };
}

/**
 * Center 엑셀 파싱 (Sheet2)
 * 구조:
 *   행1: Hawaii Sport Center | ... | 날짜
 *   행2: No. | Type | Time | | name | Prepay | Cash | card/jei es ar | account | Sum
 *   행3~: 코트대여 항목들
 *   Sum 행: | | | | | cash | card | account | Sum
 *   (빈 행)
 *   No. | Name | Price | Qty | Cash | Card | | Account | | Debt | Sum  ← 마트/식당
 *   ...
 *   Sum 행
 */
function parseCenter(wb, filename) {
  const ws = wb.Sheets['Sheet2'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const filenameDate2 = extractDateFromFilename(filename);
  const sheetDate2 = extractDate(ws);
  const date = filenameDate2 || (sheetDate2 && isReasonableDate(sheetDate2) ? sheetDate2 : null) || new Date().toISOString().split('T')[0];

  // HAWAII MART(편의점) 섹션 시작점 찾기 — 한 파일에 대관/음식/마트 3섹션이 있음
  let martStartIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (row.some(c => c != null && /hawaii\s*mart/i.test(String(c)))) {
      martStartIdx = i;
      break;
    }
  }

  const preRows = martStartIdx === -1 ? rows : rows.slice(0, martStartIdx);
  const martRows = martStartIdx === -1 ? [] : rows.slice(martStartIdx);

  let courtSum = 0;
  let foodSum = 0;
  let martSum = 0;

  // 첫 번째 섹션: 코트대여 (Sum 행 col 9)
  // 두 번째 섹션: 식당 (Sum 행 col 10)
  let foundFirstSum = false;

  for (const row of preRows) {
    if (!row) continue;

    const label0 = row[0] !== null ? String(row[0]).trim() : '';

    if (label0.toLowerCase() === 'sum' || label0 === '') {
      // 빈 라벨이 sum row이려면 row[1]도 비어있어야 함
      // (항목 행은 row[1]에 Type/Name이 있음, 04.15처럼 No. 칸만 빈 항목 케이스 방지)
      const r1 = row[1] != null ? String(row[1]).trim() : '';
      const isSum = row.some(v => typeof v === 'number' && v > 0) &&
                    (label0.toLowerCase() === 'sum' || (label0 === '' && r1 === ''));

      if (isSum) {
        if (!foundFirstSum) {
          const s = row[9] || row[8] || 0;
          if (s > 0) {
            courtSum = s;
            foundFirstSum = true;
          }
        } else if (foodSum === 0) {
          const s = row[10] || row[9] || 0;
          if (s > 0 && s !== courtSum) {
            foodSum = s;
          }
        }
      }
    }
  }

  // Fallback: 직접 항목 합산
  if (courtSum === 0) {
    let inCourt = false;
    for (const row of preRows) {
      if (!row) continue;
      if (row[0] === 'No.' && row[1] === 'Type') { inCourt = true; continue; }
      if (!inCourt) continue;
      const lab = String(row[0] != null ? row[0] : '').trim().toLowerCase();
      if (lab === 'sum' || lab === 'cash' || row[0] === 'No.') break;
      if (row[0] === null || row[0] === '') {
        if (row.some(v => typeof v === 'number' && v > 0)) break;
        continue;
      }
      if (typeof row[0] === 'number' && row[0] >= 1 && row[0] < 100) {
        const s = row[9] || row[8];
        if (s && typeof s === 'number' && s > 0) courtSum += s;
      }
    }
  }

  if (foodSum === 0) {
    let inFood = false;
    for (const row of preRows) {
      if (!row) continue;
      if (row[0] === 'No.' && row[1] === 'Name' && row[2] === 'Price') { inFood = true; continue; }
      if (!inFood) continue;
      const lab = String(row[0] != null ? row[0] : '').trim().toLowerCase();
      if (lab === 'sum' || lab === 'cash') break;
      if (typeof row[0] === 'number' && row[0] >= 1 && row[0] < 100) {
        const s = row[10];
        if (s && typeof s === 'number' && s > 0) foodSum += s;
      }
    }
  }

  // HAWAII MART 섹션: 헤더는 col 9가 Sum (식당과 한 칸 차이)
  if (martRows.length > 0) {
    let inMart = false;
    for (const row of martRows) {
      if (!row) continue;
      const label0 = row[0] !== null ? String(row[0]).trim() : '';

      if (row[0] === 'No.' && row[1] === 'Name' && row[2] === 'Price') {
        inMart = true;
        continue;
      }

      if (inMart && label0.toLowerCase() === 'sum') {
        const s = row[9];
        if (typeof s === 'number' && s > 0) {
          martSum = s;
          break;
        }
      }
    }

    // Sum 행 라벨이 비어있는 경우: 항목 직접 합산 (Cash/Sum 만나면 종료)
    if (martSum === 0) {
      let inMartItems = false;
      for (const row of martRows) {
        if (!row) continue;
        if (row[0] === 'No.' && row[1] === 'Name' && row[2] === 'Price') {
          inMartItems = true;
          continue;
        }
        if (!inMartItems) continue;
        const lab = String(row[0] != null ? row[0] : '').trim().toLowerCase();
        if (lab === 'sum' || lab === 'cash') break;
        if (typeof row[0] === 'number' && row[0] >= 1) {
          const s = row[9];
          if (typeof s === 'number' && s > 0) martSum += s;
        }
      }
    }
  }

  const result = [];

  if (courtSum > 0) {
    result.push({
      business_id: 1,
      category_id: 22,
      type: 'income',
      amount: courtSum,
      description: `${date.slice(5).replace('-','/')} 코트대여 매출`,
      payment_method: 'mixed',
      transaction_date: date
    });
  }

  if (foodSum > 0) {
    result.push({
      business_id: 1,
      category_id: 74,
      type: 'income',
      amount: foodSum,
      description: `${date.slice(5).replace('-','/')} 식당/카페 매출`,
      payment_method: 'cash',
      transaction_date: date
    });
  }

  if (martSum > 0) {
    result.push({
      business_id: 1,
      category_id: 73,
      type: 'income',
      amount: martSum,
      description: `${date.slice(5).replace('-','/')} 편의점(마트) 매출`,
      payment_method: 'mixed',
      transaction_date: date
    });
  }

  return { type: 'center', date, entries: result, courtSum, foodSum, martSum };
}

/**
 * 메인 파싱 함수
 * @param {string} filePath - 엑셀 파일 경로
 * @param {string} filename - 원본 파일명 (타입 감지용)
 * @returns {{ type, date, entries, summary }}
 */
function parseExcel(filePath, filename, businessIdHint) {
  const wb = XLSX.readFile(filePath);
  const fileType = detectFileType(filename);
  
  // Sheet 이름으로도 감지
  const sheetNames = wb.SheetNames;
  const hasSheet2 = sheetNames.includes('Sheet2');
  const hasSheet1 = sheetNames.includes('Sheet1');
  
  // 시트 헤더로 먼저 감지 (가장 정확)
  const headerType = detectTypeFromHeader(wb);
  let detected = headerType || fileType;
  if (detected === 'unknown') {
    if (hasSheet2 && !hasSheet1) detected = 'center';
    else if (hasSheet1) detected = 'fitness';
  }
  
  if (detected === 'monthly') return parseMonthly(wb, filename, businessIdHint);
  if (detected === 'shop') return parseShop(wb, filename);
  if (detected === 'fitness') return parseFitness(wb, filename);
  if (detected === 'center') return parseCenter(wb, filename);

  // 둘 다 시도
  if (hasSheet1) return parseFitness(wb, filename);
  if (hasSheet2) return parseCenter(wb, filename);

  return { type: 'unknown', date: null, entries: [], error: '파일 형식을 인식할 수 없습니다.' };
}

/**
 * 월간 매출/지출 엑셀 파싱
 * 구조:
 *   행1: "YYYY-MM월"
 *   행2: 일짜 | 수입 | 지출 | 비고
 *   행3~: "1일" | income | expense | note
 *   합계/총합계 행은 스킵
 *
 * 결과:
 *   - 수입 → 사업장별 기타수입 카테고리, 일별 entry
 *   - 지출 → 사업장별 기타지출 카테고리, 일별 entry
 *   - 사업장: 파일명/시트/헤더 기반 자동 감지 (센터=1, 샵=3, 휘트니스=2 기본)
 */
function parseMonthly(wb, filename, businessIdHint) {
  // 일짜 헤더가 있는 시트 찾기 (어느 컬럼이든)
  let ws = null;
  let sheetUsed = wb.SheetNames[0];
  for (const sn of wb.SheetNames) {
    const w = wb.Sheets[sn];
    const rs = XLSX.utils.sheet_to_json(w, { header: 1, defval: null });
    for (const row of rs.slice(0, 10)) {
      if (!row) continue;
      for (let off = 0; off < 4; off++) {
        if (row[off] != null && String(row[off]).includes('일짜')) {
          ws = w; sheetUsed = sn; break;
        }
      }
      if (ws) break;
    }
    if (ws) break;
  }
  if (!ws) ws = wb.Sheets[wb.SheetNames[0]];

  // 사업장 자동 감지: hint > 파일명/시트/헤더 키워드 > (감지 실패면 호출자가 처리)
  let businessId = 2, expenseCategoryId = 49, incomeCategoryId = 40; // 기본: 휘트니스
  let businessIdSource = 'default';
  if (businessIdHint === 1 || businessIdHint === '1') { businessId = 1; expenseCategoryId = 35; incomeCategoryId = 26; businessIdSource = 'hint'; }
  else if (businessIdHint === 2 || businessIdHint === '2') { businessId = 2; expenseCategoryId = 49; incomeCategoryId = 40; businessIdSource = 'hint'; }
  else if (businessIdHint === 3 || businessIdHint === '3') { businessId = 3; expenseCategoryId = 59; incomeCategoryId = 91; businessIdSource = 'hint'; }
  else {
    const fnameLower = String(filename || '').toLowerCase();
    const sheetLower = String(sheetUsed || '').toLowerCase();
    let headerText = '';
    {
      const headRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }).slice(0, 5);
      for (const r of headRows) {
        if (!r) continue;
        for (const c of r) if (c != null) headerText += ' ' + String(c);
      }
      headerText = headerText.toLowerCase();
    }
    const haystack = fnameLower + ' ' + sheetLower + ' ' + headerText;
    if (/(센터|center|sport)/.test(haystack)) {
      businessId = 1; expenseCategoryId = 35; incomeCategoryId = 26; businessIdSource = 'keyword';
    } else if (/(샵|shop)/.test(haystack)) {
      businessId = 3; expenseCategoryId = 59; incomeCategoryId = 91; businessIdSource = 'keyword';
    } else if (/(휘트니스|피트니스|fitness|gym|체육관)/.test(haystack)) {
      businessId = 2; expenseCategoryId = 49; incomeCategoryId = 40; businessIdSource = 'keyword';
    }
  }

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // 헤더 행 + 컬럼 오프셋 찾기 ("일짜"가 어느 컬럼에 있는지)
  let headerRow = -1;
  let colOffset = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i]) continue;
    for (let off = 0; off < 4; off++) {
      if (rows[i][off] != null && String(rows[i][off]).includes('일짜')) {
        headerRow = i;
        colOffset = off;
        break;
      }
    }
    if (headerRow !== -1) break;
  }
  if (headerRow === -1) {
    return { type: 'unknown', date: null, entries: [], error: '월간 보고서 헤더(일짜/수입/지출)를 찾을 수 없습니다.' };
  }
  const COL_DAY = colOffset;
  const COL_INCOME = colOffset + 1;
  const COL_EXPENSE = colOffset + 2;
  const COL_NOTE = colOffset + 3;

  // 연-월 추출 (헤더 위쪽에서 "YYYY-MM" 패턴)
  let yearMonth = null;
  for (let i = 0; i < headerRow; i++) {
    const r = rows[i];
    if (!r) continue;
    for (const c of r) {
      if (c == null) continue;
      const m = String(c).match(/(20\d{2})[-./년]\s*(\d{1,2})/);
      if (m) { yearMonth = `${m[1]}-${String(parseInt(m[2])).padStart(2,'0')}`; break; }
    }
    if (yearMonth) break;
  }
  // 시트명에서도 시도 ("04sar" → 4월, 연도는 현재)
  if (!yearMonth) {
    const m = sheetUsed.match(/(\d{1,2})\s*sar/i) || sheetUsed.match(/(\d{1,2})\s*월/);
    if (m) {
      const month = String(parseInt(m[1])).padStart(2,'0');
      yearMonth = `${new Date().getFullYear()}-${month}`;
    }
  }
  if (!yearMonth) {
    const now = new Date();
    yearMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }

  const entries = [];
  const dailyIncome = []; // 검증용: 월간 보고서 일별 수입
  let totalIncome = 0;
  let totalExpense = 0;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row[COL_DAY] == null) continue;
    const label = String(row[COL_DAY]).trim();

    // 합계 행 스킵
    if (label === '합계' || label === '총합계' || /^total/i.test(label) || /^нийт/i.test(label)) continue;

    const dayMatch = label.match(/^(\d+)\s*일?$/);
    if (!dayMatch) continue;
    const dayNum = parseInt(dayMatch[1]);
    if (dayNum < 1 || dayNum > 31) continue;
    const day = String(dayNum).padStart(2, '0');
    const txDate = `${yearMonth}-${day}`;

    const income = Number(row[COL_INCOME]) || 0;
    const expense = Number(row[COL_EXPENSE]) || 0;
    const note = row[COL_NOTE] != null ? String(row[COL_NOTE]).trim().slice(0, 80) : '';

    // 월간 보고서의 수입은 일별 매출(cat 36/74/82 등)과 중복되므로 신규 입력 안 함 (검증 전용)
    if (income > 0) {
      dailyIncome.push({ date: txDate, monthly: income });
      totalIncome += income;
    }
    if (expense > 0) {
      entries.push({
        business_id: businessId,
        category_id: expenseCategoryId,
        type: 'expense',
        amount: expense,
        description: `${day}일 지출${note ? ' - ' + note : ''}`,
        payment_method: 'mixed',
        transaction_date: txDate
      });
      totalExpense += expense;
    }
  }

  return {
    type: 'monthly',
    date: `${yearMonth}-01`,
    month: yearMonth,
    businessId,
    businessIdSource,
    entries,
    dailyIncome,
    totalIncome,
    totalExpense,
    totalSum: totalIncome + totalExpense
  };
}

/**
 * Shop 엑셀 파싱
 * 구조: Hawaii Shop | ... | 날짜
 *       No. | 품목 | ... | 합계
 */
function parseShop(wb, filename) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  
  const filenameDate = extractDateFromFilename(filename);
  const sheetDate = extractDate(ws);
  const date = filenameDate || (sheetDate && isReasonableDate(sheetDate) ? sheetDate : null) || new Date().toISOString().split("T")[0];
  
  // Sum 행 또는 마지막 합계 찾기
  let totalSum = 0;
  for (const row of rows) {
    if (!row) continue;
    // 각 항목의 합계 컬럼 (col 11)
    const no = row[0];
    const itemName = row[1] != null ? String(row[1]).trim() : '';
    // 항목 행 조건: 번호 + 품목명 모두 있어야 (sum row나 빈 항목 제외)
    if (typeof no === "number" && no > 0 && no < 100 && itemName) {
      const sum = row[11];
      if (sum && typeof sum === "number" && sum > 0) totalSum += sum;
    }
    // Sum 행
    const label = row[0] !== null ? String(row[0]).trim().toLowerCase() : "";
    if (label === "sum" && row[11] && typeof row[11] === "number") {
      totalSum = row[11];
    }
    // 마지막 행 합계 (빈 첫셀 + 합계)
    if (label === "" && row[11] && typeof row[11] === "number" && row[11] > 0) {
      totalSum = row[11];
    }
  }
  
  const result = [];
  if (totalSum > 0) {
    // 품목명으로 DeWalt vs 테니스용품 분류
    let hasDeWalt = false;
    let hasTennis = false;
    for (const row of rows) {
      if (!row || !row[1]) continue;
      const item = String(row[1]).toLowerCase();
      if (item.includes("dc") || item.includes("dw") || item.includes("dewalt")) hasDeWalt = true;
      if (item.includes("racket") || item.includes("grip") || item.includes("string") || item.includes("yonex") || item.includes("wilson") || item.includes("head") || item.includes("babolat")) hasTennis = true;
    }
    
    result.push({
      business_id: 3,
      category_id: hasDeWalt ? 51 : (hasTennis ? 50 : 91),
      type: "income",
      amount: totalSum,
      description: date.slice(5).replace("-","/") + " 샵 매출",
      payment_method: "mixed",
      transaction_date: date
    });
  }
  
  return { type: "shop", date, entries: result, totalSum };
}

module.exports = { parseExcel, detectFileType };
