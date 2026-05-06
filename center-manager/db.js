const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'center.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
    name TEXT NOT NULL, role TEXT DEFAULT 'staff',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- 시설/코트
  CREATE TABLE IF NOT EXISTS facilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, type TEXT DEFAULT 'court',
    capacity INTEGER DEFAULT 0, hourly_rate REAL DEFAULT 0,
    status TEXT DEFAULT 'available',
    description TEXT, sort_order INTEGER DEFAULT 0
  );

  -- 시설 예약/사용
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_id INTEGER NOT NULL,
    customer_name TEXT, customer_phone TEXT,
    start_time TEXT NOT NULL, end_time TEXT NOT NULL,
    booking_date TEXT DEFAULT (date('now','localtime')),
    amount REAL DEFAULT 0, payment_method TEXT DEFAULT 'cash',
    payment_status TEXT DEFAULT 'paid',
    status TEXT DEFAULT 'confirmed',
    notes TEXT, created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (facility_id) REFERENCES facilities(id)
  );

  -- 수업/프로그램
  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, instructor TEXT,
    facility_id INTEGER,
    day_of_week TEXT, start_time TEXT, end_time TEXT,
    max_students INTEGER DEFAULT 20,
    current_students INTEGER DEFAULT 0,
    monthly_fee REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    description TEXT,
    FOREIGN KEY (facility_id) REFERENCES facilities(id)
  );

  -- 수업 수강생
  CREATE TABLE IF NOT EXISTS class_students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    student_name TEXT NOT NULL, student_phone TEXT,
    start_date TEXT DEFAULT (date('now','localtime')),
    end_date TEXT, status TEXT DEFAULT 'active',
    FOREIGN KEY (class_id) REFERENCES classes(id)
  );

  -- 장비
  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, category TEXT,
    qty INTEGER DEFAULT 1, location TEXT,
    purchase_date TEXT, purchase_price REAL DEFAULT 0,
    condition TEXT DEFAULT 'good',
    last_maintenance TEXT, next_maintenance TEXT,
    notes TEXT
  );

  -- 장비 유지보수 기록
  CREATE TABLE IF NOT EXISTS maintenance_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL,
    type TEXT DEFAULT 'repair',
    description TEXT, cost REAL DEFAULT 0,
    done_date TEXT DEFAULT (date('now','localtime')),
    done_by TEXT,
    FOREIGN KEY (equipment_id) REFERENCES equipment(id)
  );

  -- 공지사항/메모
  CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, content TEXT,
    priority TEXT DEFAULT 'normal',
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- 일일 체크리스트
  CREATE TABLE IF NOT EXISTS daily_checklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task TEXT NOT NULL, category TEXT DEFAULT 'open',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS checklist_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_id INTEGER NOT NULL,
    check_date TEXT DEFAULT (date('now','localtime')),
    checked_by INTEGER, checked_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(checklist_id, check_date)
  );
`);

// SEED
const uc = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (uc === 0) {
  db.prepare("INSERT INTO users (username,password,name,role) VALUES (?,?,?,?)").run('admin','admin123','관리자','admin');
  db.prepare("INSERT INTO users (username,password,name,role) VALUES (?,?,?,?)").run('staff1','staff123','직원1','staff');

  // 시설
  const facs = [
    ['A코트','court',4,30000,'available','테니스 코트 A',1],
    ['B코트','court',4,30000,'available','테니스 코트 B',2],
    ['C코트','court',4,25000,'available','테니스 코트 C',3],
    ['다목적실','room',20,50000,'available','다목적 체육실',4],
    ['탈의실/샤워','facility',0,0,'available','남녀 탈의실',5],
  ];
  facs.forEach(f => db.prepare("INSERT INTO facilities (name,type,capacity,hourly_rate,status,description,sort_order) VALUES (?,?,?,?,?,?,?)").run(...f));

  // 수업
  const cls = [
    ['주니어 테니스','김코치',1,'월,수,금','16:00','17:30',15,8,80000,'active','초등학생 테니스'],
    ['성인 테니스 초급','이코치',2,'화,목','19:00','20:30',12,6,100000,'active','성인 초급반'],
    ['성인 테니스 중급','박코치',3,'월,수,금','19:00','20:30',10,7,120000,'active','성인 중급반'],
    ['새벽 테니스','김코치',1,'월,수,금','06:00','07:30',8,5,100000,'active','새벽반'],
    ['주말 테니스','이코치',2,'토','10:00','12:00',12,10,80000,'active','주말반'],
  ];
  cls.forEach(c => db.prepare("INSERT INTO classes (name,instructor,facility_id,day_of_week,start_time,end_time,max_students,current_students,monthly_fee,status,description) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(...c));

  // 장비
  const equips = [
    ['테니스 네트 A코트','네트',1,'A코트','2024-01-01',500000,'good'],
    ['테니스 네트 B코트','네트',1,'B코트','2024-01-01',500000,'good'],
    ['테니스 네트 C코트','네트',1,'C코트','2024-01-01',500000,'fair'],
    ['볼머신 1','볼머신',1,'창고','2023-06-01',2000000,'good'],
    ['볼머신 2','볼머신',1,'A코트','2024-03-01',2500000,'good'],
    ['조명 시설','시설',1,'전체','2022-01-01',5000000,'good'],
    ['에어컨 1','시설',1,'다목적실','2023-01-01',1500000,'fair'],
    ['에어컨 2','시설',1,'B코트','2024-06-01',2000000,'good'],
    ['음향 장비','시설',1,'다목적실','2023-01-01',800000,'good'],
    ['대여 라켓','라켓',10,'프론트','2024-01-01',50000,'good'],
  ];
  equips.forEach(e => db.prepare("INSERT INTO equipment (name,category,qty,location,purchase_date,purchase_price,condition) VALUES (?,?,?,?,?,?,?)").run(...e));

  // 일일 체크리스트
  const checks = [
    ['조명 점검','open',1],['코트 상태 확인','open',2],['네트 높이 확인','open',3],
    ['탈의실 청소','open',4],['화장실 청소','open',5],['프론트 정리','open',6],
    ['에어컨/난방 가동','open',7],['음향 장비 점검','open',8],
    ['코트 물청소','close',10],['쓰레기 수거','close',11],
    ['조명/에어컨 끄기','close',12],['문 잠금 확인','close',13],
    ['일일 매출 정리','close',14],
  ];
  checks.forEach(c => db.prepare("INSERT INTO daily_checklist (task,category,sort_order) VALUES (?,?,?)").run(...c));
}

module.exports = db;
