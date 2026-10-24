// 사진 저장 — 공지와 게시판이 함께 쓴다.
// 폰에서 캔버스로 줄인 JPEG 한 장(data:URL)을 받아 uploads/ 에 파일로 떨어뜨린다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
// 테스트는 UPLOAD_DIR 환경변수로 임시 폴더를 준다 (운영 uploads/ 에 테스트 사진이 쌓이지 않게)
const uploadDir = () => process.env.UPLOAD_DIR || UPLOAD_DIR;
const MAX_BYTES = 3 * 1024 * 1024;   // 줄여서 올리므로 3MB면 충분하다

// 저장 경로는 앞에 / 를 붙이지 않는다 — /booking/ 처럼 하위 경로에 올려도 그대로 열리게
function savePhoto(dataUrl) {
  if (!dataUrl) return null;
  return `uploads/${writePhoto(dataUrl, uploadDir())}`;
}

// data:URL 한 장을 dir 에 파일로 쓰고 파일 이름만 돌려준다
function writePhoto(dataUrl, dir) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw new Error('bad_photo');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) throw new Error('photo_too_big');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return name;
}

// 채팅 사진은 공개 폴더(uploads/)가 아니라 DB 옆 chat-photos/ 에 둔다.
// 주소로 바로 못 열고, /api/chat/photo/<메시지 id> 가 방에 들어갈 수 있는 사람인지 보고 내준다.
const chatPhotoDir = (db) => path.join(path.dirname(db.name), 'chat-photos');
function removeChatPhoto(db, name) {
  if (!name) return;
  fs.rm(path.join(chatPhotoDir(db), path.basename(String(name))), { force: true }, () => {});
}

// 여러 장 — 한 장이라도 잘못되면 앞서 저장한 것을 지우고 던진다 (반쪽짜리로 남지 않게)
function savePhotos(list, max = 4) {
  const items = (Array.isArray(list) ? list : []).filter(Boolean).slice(0, max + 1);
  if (items.length > max) throw new Error('too_many_photos');
  const saved = [];
  try {
    for (const d of items) saved.push(savePhoto(d));
    return saved;
  } catch (e) {
    for (const p of saved) removePhoto(p);
    throw e;
  }
}

function removePhoto(webPath) {
  if (!webPath) return;
  const name = path.basename(String(webPath));
  fs.rm(path.join(uploadDir(), name), { force: true }, () => {});
}

// 회원 프로필 사진 — 새 사진(data:URL)으로 바꾸거나 null 이면 지운다. 옛 파일은 지운다.
function setMemberPhoto(db, memberId, dataUrl) {
  const m = db.prepare('SELECT photo FROM member WHERE id=?').get(memberId);
  if (!m) return undefined;
  const photo = dataUrl ? savePhoto(dataUrl) : null;
  db.prepare('UPDATE member SET photo=? WHERE id=?').run(photo, memberId);
  removePhoto(m.photo);
  return photo;
}

module.exports = { setMemberPhoto, savePhoto, savePhotos, removePhoto, writePhoto, chatPhotoDir, removeChatPhoto, UPLOAD_DIR, uploadDir, MAX_BYTES };
