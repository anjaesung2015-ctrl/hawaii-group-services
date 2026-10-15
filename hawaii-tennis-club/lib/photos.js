// 사진 저장 — 공지와 게시판이 함께 쓴다.
// 폰에서 캔버스로 줄인 JPEG 한 장(data:URL)을 받아 uploads/ 에 파일로 떨어뜨린다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_BYTES = 3 * 1024 * 1024;   // 줄여서 올리므로 3MB면 충분하다

// 저장 경로는 앞에 / 를 붙이지 않는다 — /booking/ 처럼 하위 경로에 올려도 그대로 열리게
function savePhoto(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw new Error('bad_photo');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) throw new Error('photo_too_big');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return `uploads/${name}`;
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
  fs.rm(path.join(UPLOAD_DIR, name), { force: true }, () => {});
}

module.exports = { savePhoto, savePhotos, removePhoto, UPLOAD_DIR, MAX_BYTES };
