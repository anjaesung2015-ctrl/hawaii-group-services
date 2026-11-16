// 동영상 받기 — multipart/form-data 를 디스크로 바로 흘려 쓴다 (50MB 를 메모리에 올리지 않게).
// 필드: video(파일), poster(첫 장면 JPEG data:URL), duration(초), caption.
// 서버에 영상 변환 도구(ffmpeg)가 없어 길이는 폰이 잰 값을 믿고, 크기는 여기서 막는다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Busboy = require('busboy');
const { uploadDir } = require('./photos');

const TYPES = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp', 'video/x-m4v': 'm4v' };
const VIDEO_EXT = /\.(mp4|mov|webm|3gp|m4v)$/i;
// 테스트는 VIDEO_MAX_BYTES 로 작게 줄여 본다
const maxBytes = () => Number(process.env.VIDEO_MAX_BYTES) || 50 * 1024 * 1024;
const MAX_SECONDS = 61;        // 1분 (폰마다 잰 길이가 조금씩 달라 1초 여유)

// 성공: { file: 'uploads/…', fields }   실패: Error(code) — 쓰다 만 파일은 지운다
function receiveVideo(req) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: maxBytes(), fields: 6, fieldSize: 4 * 1024 * 1024 } });
    } catch (e) { return reject(new Error('bad_video')); }

    const fields = {};
    let file = null, full = null, failed = null, writing = null;
    const fail = (code) => { if (!failed) failed = new Error(code); };

    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, stream, info) => {
      const ext = TYPES[String(info.mimeType || '').toLowerCase()];
      if (name !== 'video' || !ext || file) { fail('bad_video'); stream.resume(); return; }
      const dir = uploadDir();
      fs.mkdirSync(dir, { recursive: true });
      const fname = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      full = path.join(dir, fname);
      file = `uploads/${fname}`;
      const out = fs.createWriteStream(full);
      writing = new Promise((ok) => out.on('close', ok));
      stream.on('limit', () => fail('video_too_big'));
      out.on('error', () => fail('bad_video'));
      stream.pipe(out);
    });
    bb.on('error', () => fail('bad_video'));
    bb.on('close', async () => {
      if (writing) await writing;
      if (!file && !failed) fail('video_required');
      if (failed) {
        if (full) fs.rm(full, { force: true }, () => {});
        return reject(failed);
      }
      resolve({ file, full, fields });
    });
    // 올리다 끊기면 busboy 가 close 를 못 낼 수 있다 — 여기서 정리하고 끝낸다
    req.on('aborted', () => {
      fail('bad_video');
      if (full) fs.rm(full, { force: true }, () => {});
      reject(failed);
    });
    req.pipe(bb);
  });
}

module.exports = { receiveVideo, VIDEO_EXT, MAX_SECONDS, maxBytes };
