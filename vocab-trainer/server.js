const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = 6008;
const SECRET = 'vocab-trainer-2026';
const db = new Database(path.join(__dirname, 'vocab.db'));

db.pragma('journal_mode = WAL');
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    language TEXT NOT NULL DEFAULT 'en',
    word TEXT NOT NULL,
    meaning_ko TEXT NOT NULL,
    meaning_mn TEXT,
    pronunciation TEXT,
    example_sentence TEXT,
    example_meaning TEXT,
    category TEXT DEFAULT 'general',
    difficulty INTEGER DEFAULT 1,
    review_count INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    last_reviewed TEXT,
    next_review TEXT,
    mastery_level INTEGER DEFAULT 0,
    day_number INTEGER DEFAULT 1,
    added_date TEXT DEFAULT (date('now')),
    notes TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS daily_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    study_date TEXT NOT NULL,
    words_studied INTEGER DEFAULT 0,
    words_correct INTEGER DEFAULT 0,
    words_wrong INTEGER DEFAULT 0,
    study_time_min INTEGER DEFAULT 0,
    streak_days INTEGER DEFAULT 0,
    UNIQUE(user_id, study_date),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS word_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    language TEXT DEFAULT 'en',
    category TEXT DEFAULT 'general',
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Default user
if (!db.prepare("SELECT id FROM users WHERE username='admin'").get()) {
  db.prepare("INSERT INTO users (username,password,name) VALUES (?,?,?)").run('admin','admin123','재성');
}

// Pre-populate starter words if empty
if (db.prepare("SELECT COUNT(*) as c FROM words").get().c === 0) {
  const ins = db.prepare("INSERT INTO words (user_id,language,word,meaning_ko,meaning_mn,pronunciation,example_sentence,example_meaning,category,difficulty,day_number) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const batch = db.transaction(() => {
    // Day 1 - English
    ins.run(1,'en','resilience','회복력, 탄력성','Тэсвэр тэвчээр','[rɪˈzɪliəns]','Tennis requires mental resilience.','테니스는 정신적 회복력이 필요하다.','tennis',2,1);
    ins.run(1,'en','footwork','풋워크, 발놀림','Хөлийн ажил','[ˈfʊtwɜːrk]','Good footwork is essential for tennis.','좋은 풋워크는 테니스에 필수적이다.','tennis',1,1);
    ins.run(1,'en','opponent','상대, 적수','Өрсөлдөгч','[əˈpoʊnənt]','Study your opponent before the match.','경기 전에 상대를 분석해라.','tennis',1,1);
    ins.run(1,'en','tournament','토너먼트, 대회','Тэмцээн','[ˈtʊrnəmənt]','She entered the ITF tournament.','그녀는 ITF 대회에 참가했다.','tennis',1,1);
    ins.run(1,'en','strategy','전략','Стратеги','[ˈstrætədʒi]','We need a new business strategy.','새로운 사업 전략이 필요하다.','business',2,1);
    ins.run(1,'en','revenue','매출, 수익','Орлого','[ˈrevənuː]','Monthly revenue exceeded expectations.','월 매출이 기대를 초과했다.','business',2,1);
    ins.run(1,'en','schedule','일정, 스케줄','Хуваарь','[ˈskedʒuːl]','Check the tournament schedule.','대회 일정을 확인해라.','general',1,1);
    ins.run(1,'en','improvement','향상, 개선','Сайжруулалт','[ɪmˈpruːvmənt]','There is room for improvement.','개선의 여지가 있다.','general',1,1);
    ins.run(1,'en','confidence','자신감','Итгэл','[ˈkɑːnfɪdəns]','Confidence is key in competition.','자신감이 시합의 핵심이다.','mental',2,1);
    ins.run(1,'en','discipline','규율, 훈련','Сахилга бат','[ˈdɪsəplɪn]','Athletes need strong discipline.','선수들에게는 강한 규율이 필요하다.','mental',2,1);

    // Day 1 - Mongolian
    ins.run(1,'mn','Сайн байна уу','안녕하세요',null,'[Sain baina uu]','Сайн байна уу, та сайн байна уу?','안녕하세요, 잘 지내세요?','greeting',1,1);
    ins.run(1,'mn','Баярлалаа','감사합니다',null,'[Bayarlalaa]','Тусалсанд баярлалаа.','도와주셔서 감사합니다.','greeting',1,1);
    ins.run(1,'mn','Мэнд','안녕 (비격식)',null,'[Mend]','Мэнд, юу байна?','안녕, 뭐 해?','greeting',1,1);
    ins.run(1,'mn','Хэд вэ?','얼마예요?',null,'[Khed ve?]','Энэ хэд вэ?','이거 얼마예요?','shopping',1,1);
    ins.run(1,'mn','Тийм','네, 맞아요',null,'[Tiim]','Тийм, зөв байна.','네, 맞아요.','basic',1,1);
    ins.run(1,'mn','Үгүй','아니요',null,'[Ügüi]','Үгүй, би чадахгүй.','아니요, 못해요.','basic',1,1);
    ins.run(1,'mn','Өглөөний мэнд','좋은 아침',null,'[Öglöönii mend]','Өглөөний мэнд, сайхан амарсан уу?','좋은 아침, 잘 잤어요?','greeting',1,1);
    ins.run(1,'mn','Орлого','수입, 매출',null,'[Orlogo]','Энэ сарын орлого сайн байна.','이달 매출이 좋다.','business',1,1);
    ins.run(1,'mn','Дасгалжуулагч','코치, 트레이너',null,'[Dasgaljuulagch]','Дасгалжуулагч маш чадварлаг.','코치가 매우 유능하다.','tennis',2,1);
    ins.run(1,'mn','Тэмцээн','대회, 시합',null,'[Temtseen]','Дараагийн тэмцээн хэзээ вэ?','다음 대회는 언제예요?','tennis',1,1);

    // Day 2 - English
    ins.run(1,'en','consistency','일관성','Тогтвортой байдал','[kənˈsɪstənsi]','Consistency wins matches.','일관성이 경기를 이긴다.','tennis',2,2);
    ins.run(1,'en','determination','결단력, 의지','Шийдэмгий байдал','[dɪˌtɜːrmɪˈneɪʃn]','His determination was incredible.','그의 의지는 대단했다.','mental',2,2);
    ins.run(1,'en','flexibility','유연성','Уян хатан байдал','[ˌfleksəˈbɪləti]','Flexibility prevents injuries.','유연성이 부상을 방지한다.','fitness',1,2);
    ins.run(1,'en','investment','투자','Хөрөнгө оруулалт','[ɪnˈvestmənt]','This is a good investment.','이것은 좋은 투자다.','business',2,2);
    ins.run(1,'en','equipment','장비','Тоног төхөөрөмж','[ɪˈkwɪpmənt]','Buy quality equipment.','좋은 장비를 구매해라.','general',1,2);
    ins.run(1,'en','endurance','지구력','Тэсвэр','[ɪnˈdʊrəns]','Endurance training is important.','지구력 훈련이 중요하다.','fitness',2,2);
    ins.run(1,'en','motivation','동기부여','Урам зориг','[ˌmoʊtɪˈveɪʃn]','Stay motivated during rehab.','재활 중 동기부여를 유지해라.','mental',2,2);
    ins.run(1,'en','recovery','회복','Нөхөн сэргээлт','[rɪˈkʌvəri]','Recovery after surgery takes time.','수술 후 회복은 시간이 걸린다.','medical',2,2);
    ins.run(1,'en','competition','시합, 경쟁','Тэмцээн','[ˌkɑːmpəˈtɪʃn]','Competition makes you stronger.','시합이 너를 강하게 만든다.','tennis',1,2);
    ins.run(1,'en','nutrition','영양','Хоол тэжээл','[nuːˈtrɪʃn]','Proper nutrition aids performance.','적절한 영양이 경기력에 도움된다.','fitness',2,2);
  });
  batch();
}

// Auth
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username=? AND password=?").get(username, password);
  if (!user) return res.status(401).json({ error: '로그인 실패' });
  const token = jwt.sign({ id: user.id, name: user.name }, SECRET, { expiresIn: '30d' });
  res.cookie('vocab_token', token, { httpOnly: false, maxAge: 30*24*60*60*1000, path: '/' });
  res.json({ token, user: { id: user.id, name: user.name } });
});

function auth(req, res, next) {
  const token = req.cookies?.vocab_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try { req.user = jwt.verify(token, SECRET); next(); } catch { res.status(401).json({ error: '토큰 만료' }); }
}
app.use('/api', (req, res, next) => { if (req.path === '/login') return next(); auth(req, res, next); });

// Words
app.get('/api/words', (req, res) => {
  const { language, day, category } = req.query;
  let sql = "SELECT * FROM words WHERE user_id=?";
  const params = [req.user.id];
  if (language) { sql += " AND language=?"; params.push(language); }
  if (day) { sql += " AND day_number=?"; params.push(day); }
  if (category) { sql += " AND category=?"; params.push(category); }
  sql += " ORDER BY day_number, id";
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/words/today', (req, res) => {
  const { language } = req.query;
  // Get the current day number based on how many days of words exist
  const maxDay = db.prepare("SELECT MAX(day_number) as d FROM words WHERE user_id=?").get(req.user.id);
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  // Find words for review (spaced repetition) + today's new words
  let sql = "SELECT * FROM words WHERE user_id=?";
  const params = [req.user.id];
  if (language) { sql += " AND language=?"; params.push(language); }
  // Get words that need review (next_review <= today) or new words
  sql += " AND (next_review IS NULL OR next_review <= ? OR mastery_level = 0)";
  params.push(today);
  sql += " ORDER BY mastery_level ASC, day_number DESC LIMIT 10";
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/words', (req, res) => {
  const b = req.body;
  const maxDay = db.prepare("SELECT MAX(day_number) as d FROM words WHERE user_id=?").get(req.user.id);
  const r = db.prepare("INSERT INTO words (user_id,language,word,meaning_ko,meaning_mn,pronunciation,example_sentence,example_meaning,category,difficulty,day_number,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(req.user.id,b.language||'en',b.word,b.meaning_ko,b.meaning_mn,b.pronunciation,b.example_sentence,b.example_meaning,b.category||'general',b.difficulty||1,b.day_number||((maxDay?.d||0)+1),b.notes);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/words/:id', (req, res) => {
  const b = req.body;
  db.prepare("UPDATE words SET word=?,meaning_ko=?,meaning_mn=?,pronunciation=?,example_sentence=?,example_meaning=?,category=?,difficulty=?,notes=? WHERE id=? AND user_id=?")
    .run(b.word,b.meaning_ko,b.meaning_mn,b.pronunciation,b.example_sentence,b.example_meaning,b.category,b.difficulty,b.notes,req.params.id,req.user.id);
  res.json({ message: 'Updated' });
});

app.delete('/api/words/:id', (req, res) => {
  db.prepare("DELETE FROM words WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  res.json({ message: 'Deleted' });
});

// Quiz / Review
app.post('/api/words/:id/review', (req, res) => {
  const { correct } = req.body;
  const word = db.prepare("SELECT * FROM words WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!word) return res.status(404).json({ error: 'Not found' });

  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  let mastery = word.mastery_level || 0;
  let nextReview;

  if (correct) {
    mastery = Math.min(mastery + 1, 5);
    // Spaced repetition intervals: 1d, 3d, 7d, 14d, 30d
    const intervals = [1, 3, 7, 14, 30];
    const days = intervals[Math.min(mastery - 1, 4)];
    const d = new Date(); d.setDate(d.getDate() + days);
    nextReview = d.toISOString().split('T')[0];
  } else {
    mastery = Math.max(mastery - 1, 0);
    const d = new Date(); d.setDate(d.getDate() + 1);
    nextReview = d.toISOString().split('T')[0];
  }

  db.prepare("UPDATE words SET review_count=review_count+1, correct_count=correct_count+?, mastery_level=?, last_reviewed=?, next_review=? WHERE id=?")
    .run(correct ? 1 : 0, mastery, today, nextReview, req.params.id);

  // Update daily progress
  const existing = db.prepare("SELECT * FROM daily_progress WHERE user_id=? AND study_date=?").get(req.user.id, today);
  if (existing) {
    db.prepare("UPDATE daily_progress SET words_studied=words_studied+1, words_correct=words_correct+?, words_wrong=words_wrong+? WHERE id=?")
      .run(correct ? 1 : 0, correct ? 0 : 1, existing.id);
  } else {
    // Calculate streak
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yd = yesterday.toISOString().split('T')[0];
    const prev = db.prepare("SELECT streak_days FROM daily_progress WHERE user_id=? AND study_date=?").get(req.user.id, yd);
    const streak = (prev?.streak_days || 0) + 1;
    db.prepare("INSERT INTO daily_progress (user_id,study_date,words_studied,words_correct,words_wrong,streak_days) VALUES (?,?,1,?,?,?)")
      .run(req.user.id, today, correct ? 1 : 0, correct ? 0 : 1, streak);
  }

  res.json({ mastery, nextReview });
});

// Stats
app.get('/api/stats', (req, res) => {
  const uid = req.user.id;
  const total = db.prepare("SELECT COUNT(*) as c FROM words WHERE user_id=?").get(uid);
  const mastered = db.prepare("SELECT COUNT(*) as c FROM words WHERE user_id=? AND mastery_level>=4").get(uid);
  const learning = db.prepare("SELECT COUNT(*) as c FROM words WHERE user_id=? AND mastery_level BETWEEN 1 AND 3").get(uid);
  const newW = db.prepare("SELECT COUNT(*) as c FROM words WHERE user_id=? AND mastery_level=0").get(uid);
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  const todayProgress = db.prepare("SELECT * FROM daily_progress WHERE user_id=? AND study_date=?").get(uid, today);
  const streak = todayProgress?.streak_days || 0;
  const history = db.prepare("SELECT * FROM daily_progress WHERE user_id=? ORDER BY study_date DESC LIMIT 30").all(uid);
  const byLang = db.prepare("SELECT language, COUNT(*) as count FROM words WHERE user_id=? GROUP BY language").all(uid);
  const byCat = db.prepare("SELECT category, COUNT(*) as count FROM words WHERE user_id=? GROUP BY category ORDER BY count DESC").all(uid);
  const reviewDue = db.prepare("SELECT COUNT(*) as c FROM words WHERE user_id=? AND next_review <= ?").get(uid, today);
  res.json({ total: total.c, mastered: mastered.c, learning: learning.c, new: newW.c, streak, todayProgress, history, byLang, byCat, reviewDue: reviewDue.c });
});

// Bulk add words (for daily sets)
app.post('/api/words/bulk', (req, res) => {
  const { words } = req.body;
  if (!words?.length) return res.status(400).json({ error: 'No words' });
  const ins = db.prepare("INSERT INTO words (user_id,language,word,meaning_ko,meaning_mn,pronunciation,example_sentence,example_meaning,category,difficulty,day_number) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const maxDay = db.prepare("SELECT MAX(day_number) as d FROM words WHERE user_id=?").get(req.user.id);
  const dayNum = (maxDay?.d || 0) + 1;
  const batch = db.transaction(() => {
    words.forEach(w => ins.run(req.user.id, w.language||'en', w.word, w.meaning_ko, w.meaning_mn||null, w.pronunciation||null, w.example_sentence||null, w.example_meaning||null, w.category||'general', w.difficulty||1, dayNum));
  });
  batch();
  res.json({ day: dayNum, count: words.length });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Vocab Trainer on port ${PORT}`));
