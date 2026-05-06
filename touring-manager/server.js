const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = 6006;
const SECRET = 'touring-mgr-2026-secret';
const db = new Database(path.join(__dirname, 'touring.db'));

db.pragma('journal_mode = WAL');
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ====== DB SCHEMA ======
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'coach',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_en TEXT,
    birth_year INTEGER,
    gender TEXT DEFAULT 'M',
    nationality TEXT DEFAULT 'MGL',
    itf_id TEXT,
    itf_ranking INTEGER,
    national_ranking INTEGER,
    dominant_hand TEXT DEFAULT 'R',
    backhand TEXT DEFAULT 'two-handed',
    height_cm INTEGER,
    weight_kg INTEGER,
    phone TEXT,
    parent_phone TEXT,
    parent_name TEXT,
    photo_url TEXT,
    status TEXT DEFAULT 'active',
    notes TEXT,
    strengths TEXT,
    weaknesses TEXT,
    injury_history TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    grade TEXT,
    location TEXT,
    country TEXT DEFAULT 'KOR',
    surface TEXT DEFAULT 'hard',
    start_date TEXT,
    end_date TEXT,
    entry_deadline TEXT,
    entry_fee INTEGER DEFAULT 0,
    status TEXT DEFAULT 'planned',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tournament_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    draw_type TEXT DEFAULT 'singles',
    seed INTEGER,
    entry_status TEXT DEFAULT 'entered',
    result TEXT,
    round_reached TEXT,
    points_earned INTEGER DEFAULT 0,
    prize_money INTEGER DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER,
    player_id INTEGER NOT NULL,
    opponent_name TEXT,
    opponent_ranking INTEGER,
    round TEXT,
    score TEXT,
    result TEXT,
    match_date TEXT,
    duration_min INTEGER,
    stats TEXT,
    coach_notes TEXT,
    video_url TEXT,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
  );

  CREATE TABLE IF NOT EXISTS expeditions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    destination TEXT,
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'planning',
    total_budget INTEGER DEFAULT 0,
    actual_cost INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expedition_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expedition_id INTEGER NOT NULL,
    player_id INTEGER,
    role TEXT DEFAULT 'player',
    name TEXT,
    FOREIGN KEY (expedition_id) REFERENCES expeditions(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expedition_id INTEGER,
    category TEXT,
    description TEXT,
    amount INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'KRW',
    paid_by TEXT,
    expense_date TEXT,
    receipt_url TEXT,
    FOREIGN KEY (expedition_id) REFERENCES expeditions(id)
  );

  CREATE TABLE IF NOT EXISTS training_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    log_date TEXT NOT NULL,
    log_type TEXT DEFAULT 'training',
    title TEXT,
    content TEXT,
    physical_rating INTEGER DEFAULT 3,
    technical_rating INTEGER DEFAULT 3,
    mental_rating INTEGER DEFAULT 3,
    injury_note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (player_id) REFERENCES players(id)
  );

  CREATE TABLE IF NOT EXISTS player_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    stat_date TEXT NOT NULL,
    serve_speed_max INTEGER,
    serve_1st_pct INTEGER,
    serve_2nd_pct INTEGER,
    forehand_rating INTEGER,
    backhand_rating INTEGER,
    volley_rating INTEGER,
    fitness_level INTEGER,
    mental_rating INTEGER,
    shuttle_run_level REAL,
    sprint_time REAL,
    plank_seconds INTEGER,
    weight_kg REAL,
    height_cm REAL,
    notes TEXT,
    FOREIGN KEY (player_id) REFERENCES players(id)
  );
`);

// Default users
const hasAdmin = db.prepare("SELECT id FROM users WHERE username='admin'").get();
if (!hasAdmin) {
  db.prepare("INSERT INTO users (username,password,name,role) VALUES (?,?,?,?)").run('admin','admin123','관리자','admin');
  db.prepare("INSERT INTO users (username,password,name,role) VALUES (?,?,?,?)").run('coach1','coach123','코치','coach');
}

// ====== AUTH ======
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username=? AND password=?").get(username, password);
  if (!user) return res.status(401).json({ error: '로그인 실패' });
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: '30d' });
  res.cookie('touring_token', token, { httpOnly: false, maxAge: 30*24*60*60*1000, path: '/' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

function auth(req, res, next) {
  const token = req.cookies?.touring_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try { req.user = jwt.verify(token, SECRET); next(); } catch { res.status(401).json({ error: '토큰 만료' }); }
}
app.use('/api', (req, res, next) => { if (req.path === '/login') return next(); auth(req, res, next); });

app.get('/api/me', (req, res) => res.json(req.user));

// ====== PLAYERS ======
app.get('/api/players', (req, res) => res.json(db.prepare("SELECT * FROM players ORDER BY name").all()));
app.get('/api/players/:id', (req, res) => {
  const p = db.prepare("SELECT * FROM players WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.matches = db.prepare("SELECT m.*, t.name as tournament_name, t.grade FROM matches m LEFT JOIN tournaments t ON m.tournament_id=t.id WHERE m.player_id=? ORDER BY m.match_date DESC").all(p.id);
  p.entries = db.prepare("SELECT te.*, t.name as tournament_name, t.grade, t.start_date, t.location FROM tournament_entries te JOIN tournaments t ON te.tournament_id=t.id WHERE te.player_id=? ORDER BY t.start_date DESC").all(p.id);
  p.logs = db.prepare("SELECT * FROM training_logs WHERE player_id=? ORDER BY log_date DESC LIMIT 20").all(p.id);
  p.stats = db.prepare("SELECT * FROM player_stats WHERE player_id=? ORDER BY stat_date DESC LIMIT 10").all(p.id);
  res.json(p);
});
app.post('/api/players', (req, res) => {
  const b = req.body;
  const r = db.prepare("INSERT INTO players (name,name_en,birth_year,gender,nationality,itf_id,dominant_hand,backhand,height_cm,weight_kg,phone,parent_phone,parent_name,notes,strengths,weaknesses) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(b.name,b.name_en,b.birth_year,b.gender,b.nationality,b.itf_id,b.dominant_hand,b.backhand,b.height_cm,b.weight_kg,b.phone,b.parent_phone,b.parent_name,b.notes,b.strengths,b.weaknesses);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/players/:id', (req, res) => {
  const b = req.body;
  db.prepare("UPDATE players SET name=?,name_en=?,birth_year=?,gender=?,nationality=?,itf_id=?,itf_ranking=?,national_ranking=?,dominant_hand=?,backhand=?,height_cm=?,weight_kg=?,phone=?,parent_phone=?,parent_name=?,notes=?,strengths=?,weaknesses=?,injury_history=?,status=? WHERE id=?")
    .run(b.name,b.name_en,b.birth_year,b.gender,b.nationality,b.itf_id,b.itf_ranking,b.national_ranking,b.dominant_hand,b.backhand,b.height_cm,b.weight_kg,b.phone,b.parent_phone,b.parent_name,b.notes,b.strengths,b.weaknesses,b.injury_history,b.status||'active',req.params.id);
  res.json({ message: 'Updated' });
});
app.delete('/api/players/:id', (req, res) => {
  db.prepare("DELETE FROM players WHERE id=?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ====== TOURNAMENTS ======
app.get('/api/tournaments', (req, res) => res.json(db.prepare("SELECT * FROM tournaments ORDER BY start_date").all()));
app.post('/api/tournaments', (req, res) => {
  const b = req.body;
  const r = db.prepare("INSERT INTO tournaments (name,grade,location,country,surface,start_date,end_date,entry_deadline,entry_fee,notes) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(b.name,b.grade,b.location,b.country,b.surface,b.start_date,b.end_date,b.entry_deadline,b.entry_fee,b.notes);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/tournaments/:id', (req, res) => {
  const b = req.body;
  db.prepare("UPDATE tournaments SET name=?,grade=?,location=?,country=?,surface=?,start_date=?,end_date=?,entry_deadline=?,entry_fee=?,status=?,notes=? WHERE id=?")
    .run(b.name,b.grade,b.location,b.country,b.surface,b.start_date,b.end_date,b.entry_deadline,b.entry_fee,b.status,b.notes,req.params.id);
  res.json({ message: 'Updated' });
});
app.delete('/api/tournaments/:id', (req, res) => {
  db.prepare("DELETE FROM tournaments WHERE id=?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ====== ENTRIES ======
app.get('/api/entries', (req, res) => {
  const { tournament_id, player_id } = req.query;
  let sql = "SELECT te.*, p.name as player_name, t.name as tournament_name, t.grade, t.start_date FROM tournament_entries te JOIN players p ON te.player_id=p.id JOIN tournaments t ON te.tournament_id=t.id WHERE 1=1";
  const params = [];
  if (tournament_id) { sql += " AND te.tournament_id=?"; params.push(tournament_id); }
  if (player_id) { sql += " AND te.player_id=?"; params.push(player_id); }
  sql += " ORDER BY t.start_date";
  res.json(db.prepare(sql).all(...params));
});
app.post('/api/entries', (req, res) => {
  const b = req.body;
  const r = db.prepare("INSERT INTO tournament_entries (tournament_id,player_id,draw_type,entry_status) VALUES (?,?,?,?)")
    .run(b.tournament_id,b.player_id,b.draw_type||'singles',b.entry_status||'entered');
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/entries/:id', (req, res) => {
  const b = req.body;
  db.prepare("UPDATE tournament_entries SET result=?,round_reached=?,points_earned=?,prize_money=?,entry_status=?,seed=?,notes=? WHERE id=?")
    .run(b.result,b.round_reached,b.points_earned,b.prize_money,b.entry_status,b.seed,b.notes,req.params.id);
  res.json({ message: 'Updated' });
});
app.delete('/api/entries/:id', (req, res) => {
  db.prepare("DELETE FROM tournament_entries WHERE id=?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ====== MATCHES ======
app.get('/api/matches', (req, res) => {
  const { player_id, tournament_id } = req.query;
  let sql = "SELECT m.*, p.name as player_name, t.name as tournament_name, t.grade FROM matches m JOIN players p ON m.player_id=p.id LEFT JOIN tournaments t ON m.tournament_id=t.id WHERE 1=1";
  const params = [];
  if (player_id) { sql += " AND m.player_id=?"; params.push(player_id); }
  if (tournament_id) { sql += " AND m.tournament_id=?"; params.push(tournament_id); }
  sql += " ORDER BY m.match_date DESC";
  res.json(db.prepare(sql).all(...params));
});
app.get('/api/matches/:id', (req, res) => {
  const m = db.prepare("SELECT m.*, p.name as player_name, t.name as tournament_name, t.grade FROM matches m JOIN players p ON m.player_id=p.id LEFT JOIN tournaments t ON m.tournament_id=t.id WHERE m.id=?").get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});
app.post('/api/matches', (req, res) => {
  try {
  const b = req.body;
  const r = db.prepare(`INSERT INTO matches (tournament_id,player_id,opponent_name,opponent_ranking,opponent_nationality,round,score,set_scores,result,match_date,duration_min,surface,weather,
    serve_1st_pct,serve_1st_won,serve_2nd_won,aces,double_faults,winners,unforced_errors,forced_errors,break_points_won,break_points_faced,net_points_won,
    serve_speed_max,serve_speed_avg1,serve_speed_avg2,return_1st_won,return_2nd_won,total_points_won,total_points_played,
    rally_short,rally_medium,rally_long,
    opp_serve_1st_pct,opp_aces,opp_df,opp_winners,opp_ue,opp_serve_speed_max,
    forehand_rating,backhand_rating,serve_rating,return_rating,mental_rating,movement_rating,
    physical_rating,strategy_rating,consistency_rating,aggression_rating,
    forehand_winners,backhand_winners,serve_direction,opponent_style,pressure_points,injury_status,warm_up_notes,
    set1_stats,set2_stats,set3_stats,
    coach_notes,tactical_notes,improvement_points,key_moments,video_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.tournament_id,b.player_id,b.opponent_name,b.opponent_ranking,b.opponent_nationality,b.round,b.score,b.set_scores,b.result,b.match_date,b.duration_min,b.surface,b.weather,
      b.serve_1st_pct,b.serve_1st_won,b.serve_2nd_won,b.aces,b.double_faults,b.winners,b.unforced_errors,b.forced_errors,b.break_points_won,b.break_points_faced,b.net_points_won,
      b.serve_speed_max,b.serve_speed_avg1,b.serve_speed_avg2,b.return_1st_won,b.return_2nd_won,b.total_points_won,b.total_points_played,
      b.rally_short,b.rally_medium,b.rally_long,
      b.opp_serve_1st_pct,b.opp_aces,b.opp_df,b.opp_winners,b.opp_ue,b.opp_serve_speed_max,
      b.forehand_rating||3,b.backhand_rating||3,b.serve_rating||3,b.return_rating||3,b.mental_rating||3,b.movement_rating||3,
      b.physical_rating||3,b.strategy_rating||3,b.consistency_rating||3,b.aggression_rating||3,
      b.forehand_winners,b.backhand_winners,b.serve_direction,b.opponent_style,b.pressure_points,b.injury_status,b.warm_up_notes,
      b.set1_stats,b.set2_stats,b.set3_stats,
      b.coach_notes,b.tactical_notes,b.improvement_points,b.key_moments,b.video_url);
  res.json({ id: r.lastInsertRowid });
  } catch(e) { console.error('POST match err:', e.message); res.status(500).json({error:e.message}); }
});
app.put('/api/matches/:id', (req, res) => {
  try {
  const b = req.body;
  db.prepare(`UPDATE matches SET opponent_name=?,opponent_ranking=?,opponent_nationality=?,round=?,score=?,set_scores=?,result=?,match_date=?,duration_min=?,surface=?,weather=?,
    serve_1st_pct=?,serve_1st_won=?,serve_2nd_won=?,aces=?,double_faults=?,winners=?,unforced_errors=?,forced_errors=?,break_points_won=?,break_points_faced=?,net_points_won=?,
    serve_speed_max=?,serve_speed_avg1=?,serve_speed_avg2=?,return_1st_won=?,return_2nd_won=?,total_points_won=?,total_points_played=?,
    rally_short=?,rally_medium=?,rally_long=?,
    opp_serve_1st_pct=?,opp_aces=?,opp_df=?,opp_winners=?,opp_ue=?,opp_serve_speed_max=?,
    forehand_rating=?,backhand_rating=?,serve_rating=?,return_rating=?,mental_rating=?,movement_rating=?,
    physical_rating=?,strategy_rating=?,consistency_rating=?,aggression_rating=?,
    forehand_winners=?,backhand_winners=?,serve_direction=?,opponent_style=?,pressure_points=?,injury_status=?,warm_up_notes=?,
    set1_stats=?,set2_stats=?,set3_stats=?,
    coach_notes=?,tactical_notes=?,improvement_points=?,key_moments=?,video_url=? WHERE id=?`)
    .run(b.opponent_name,b.opponent_ranking,b.opponent_nationality,b.round,b.score,b.set_scores,b.result,b.match_date,b.duration_min,b.surface,b.weather,
      b.serve_1st_pct,b.serve_1st_won,b.serve_2nd_won,b.aces,b.double_faults,b.winners,b.unforced_errors,b.forced_errors,b.break_points_won,b.break_points_faced,b.net_points_won,
      b.serve_speed_max,b.serve_speed_avg1,b.serve_speed_avg2,b.return_1st_won,b.return_2nd_won,b.total_points_won,b.total_points_played,
      b.rally_short,b.rally_medium,b.rally_long,
      b.opp_serve_1st_pct,b.opp_aces,b.opp_df,b.opp_winners,b.opp_ue,b.opp_serve_speed_max,
      b.forehand_rating,b.backhand_rating,b.serve_rating,b.return_rating,b.mental_rating,b.movement_rating,
      b.physical_rating||3,b.strategy_rating||3,b.consistency_rating||3,b.aggression_rating||3,
      b.forehand_winners,b.backhand_winners,b.serve_direction,b.opponent_style,b.pressure_points,b.injury_status,b.warm_up_notes,
      b.set1_stats,b.set2_stats,b.set3_stats,
      b.coach_notes,b.tactical_notes,b.improvement_points,b.key_moments,b.video_url,req.params.id);
  res.json({ message: 'Updated' });
  } catch(e) { console.error('PUT match err:', e.message); res.status(500).json({error:e.message}); }
});
app.delete('/api/matches/:id', (req, res) => {
  db.prepare("DELETE FROM matches WHERE id=?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ====== EXPEDITIONS ======
app.get('/api/expeditions', (req, res) => {
  const exps = db.prepare("SELECT * FROM expeditions ORDER BY start_date DESC").all();
  exps.forEach(e => {
    e.members = db.prepare("SELECT em.*, p.name as player_name FROM expedition_members em LEFT JOIN players p ON em.player_id=p.id WHERE em.expedition_id=?").all(e.id);
    e.expenses = db.prepare("SELECT * FROM expenses WHERE expedition_id=? ORDER BY expense_date").all(e.id);
    e.tournaments = db.prepare("SELECT * FROM tournaments WHERE start_date >= ? AND end_date <= ? ORDER BY start_date").all(e.start_date, e.end_date);
  });
  res.json(exps);
});
app.post('/api/expeditions', (req, res) => {
  const b = req.body;
  const r = db.prepare("INSERT INTO expeditions (name,destination,start_date,end_date,total_budget,notes) VALUES (?,?,?,?,?,?)")
    .run(b.name,b.destination,b.start_date,b.end_date,b.total_budget,b.notes);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/expeditions/:id', (req, res) => {
  const b = req.body;
  db.prepare("UPDATE expeditions SET name=?,destination=?,start_date=?,end_date=?,total_budget=?,actual_cost=?,status=?,notes=? WHERE id=?")
    .run(b.name,b.destination,b.start_date,b.end_date,b.total_budget,b.actual_cost,b.status,b.notes,req.params.id);
  res.json({ message: 'Updated' });
});
app.delete('/api/expeditions/:id', (req, res) => {
  db.prepare("DELETE FROM expeditions WHERE id=?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// Expedition members
app.post('/api/expeditions/:id/members', (req, res) => {
  const { player_id, role, name } = req.body;
  db.prepare("INSERT INTO expedition_members (expedition_id,player_id,role,name) VALUES (?,?,?,?)").run(req.params.id, player_id, role||'player', name);
  res.json({ message: 'Added' });
});
app.delete('/api/expedition-members/:id', (req, res) => {
  db.prepare("DELETE FROM expedition_members WHERE id=?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// Expenses
app.post('/api/expenses', (req, res) => {
  const b = req.body;
  const r = db.prepare("INSERT INTO expenses (expedition_id,category,description,amount,currency,paid_by,expense_date) VALUES (?,?,?,?,?,?,?)")
    .run(b.expedition_id,b.category,b.description,b.amount,b.currency||'KRW',b.paid_by,b.expense_date);
  // Update actual_cost
  const total = db.prepare("SELECT SUM(amount) as total FROM expenses WHERE expedition_id=?").get(b.expedition_id);
  db.prepare("UPDATE expeditions SET actual_cost=? WHERE id=?").run(total?.total||0, b.expedition_id);
  res.json({ id: r.lastInsertRowid });
});
app.delete('/api/expenses/:id', (req, res) => {
  const exp = db.prepare("SELECT expedition_id FROM expenses WHERE id=?").get(req.params.id);
  db.prepare("DELETE FROM expenses WHERE id=?").run(req.params.id);
  if (exp) {
    const total = db.prepare("SELECT SUM(amount) as total FROM expenses WHERE expedition_id=?").get(exp.expedition_id);
    db.prepare("UPDATE expeditions SET actual_cost=? WHERE id=?").run(total?.total||0, exp.expedition_id);
  }
  res.json({ message: 'Deleted' });
});

// ====== TRAINING LOGS ======
app.get('/api/training-logs', (req, res) => {
  const { player_id } = req.query;
  let sql = "SELECT tl.*, p.name as player_name FROM training_logs tl JOIN players p ON tl.player_id=p.id";
  const params = [];
  if (player_id) { sql += " WHERE tl.player_id=?"; params.push(player_id); }
  sql += " ORDER BY tl.log_date DESC LIMIT 50";
  res.json(db.prepare(sql).all(...params));
});
app.post('/api/training-logs', (req, res) => {
  const b = req.body;
  const r = db.prepare("INSERT INTO training_logs (player_id,log_date,log_type,title,content,physical_rating,technical_rating,mental_rating,injury_note) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(b.player_id,b.log_date,b.log_type||'training',b.title,b.content,b.physical_rating||3,b.technical_rating||3,b.mental_rating||3,b.injury_note);
  res.json({ id: r.lastInsertRowid });
});
app.delete('/api/training-logs/:id', (req, res) => {
  db.prepare("DELETE FROM training_logs WHERE id=?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ====== PLAYER STATS ======
app.post('/api/player-stats', (req, res) => {
  const b = req.body;
  const r = db.prepare("INSERT INTO player_stats (player_id,stat_date,serve_speed_max,serve_1st_pct,serve_2nd_pct,forehand_rating,backhand_rating,volley_rating,fitness_level,mental_rating,shuttle_run_level,sprint_time,plank_seconds,weight_kg,height_cm,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(b.player_id,b.stat_date,b.serve_speed_max,b.serve_1st_pct,b.serve_2nd_pct,b.forehand_rating,b.backhand_rating,b.volley_rating,b.fitness_level,b.mental_rating,b.shuttle_run_level,b.sprint_time,b.plank_seconds,b.weight_kg,b.height_cm,b.notes);
  res.json({ id: r.lastInsertRowid });
});

// ====== DASHBOARD ======
app.get('/api/dashboard', (req, res) => {
  const players = db.prepare("SELECT COUNT(*) as count FROM players WHERE status='active'").get();
  const upcoming = db.prepare("SELECT * FROM tournaments WHERE start_date >= date('now') ORDER BY start_date LIMIT 5").all();
  const recentMatches = db.prepare("SELECT m.*, p.name as player_name, t.name as tournament_name FROM matches m JOIN players p ON m.player_id=p.id LEFT JOIN tournaments t ON m.tournament_id=t.id ORDER BY m.match_date DESC LIMIT 10").all();
  const activeExpedition = db.prepare("SELECT * FROM expeditions WHERE status IN ('planning','active') ORDER BY start_date LIMIT 1").get();
  const winRate = db.prepare("SELECT COUNT(CASE WHEN result='W' THEN 1 END) as wins, COUNT(*) as total FROM matches").get();
  res.json({ players: players.count, upcoming, recentMatches, activeExpedition, winRate });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Touring Manager running on port ${PORT}`));
