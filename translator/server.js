const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 6011;
const upload = multer({ dest: os.tmpdir() });

// OpenAI removed — using Gemini for everything (free)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

async function geminiRequest(parts) {
  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || 'Gemini API error');
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

// MyMemory free fallback — no API key, ~50k words/day with email
const MYMEMORY_EMAIL = process.env.MYMEMORY_EMAIL || 'anjaesung2015@gmail.com';

async function myMemoryDirect(text, from, to) {
  // MyMemory has ~500 char limit per request; chunk by sentence/newline boundaries
  const chunks = [];
  let buf = '';
  for (const part of text.split(/(\n+|(?<=[.!?。！？])\s+)/)) {
    if ((buf + part).length > 480 && buf) { chunks.push(buf); buf = part; }
    else buf += part;
  }
  if (buf) chunks.push(buf);
  const out = [];
  for (const chunk of chunks) {
    const params = new URLSearchParams({ q: chunk, langpair: `${from}|${to}`, de: MYMEMORY_EMAIL });
    const resp = await fetch(`https://api.mymemory.translated.net/get?${params}`);
    const data = await resp.json();
    const status = Number(data.responseStatus);
    if (status !== 200) throw new Error('MyMemory: ' + (data.responseDetails || `status ${status}`));
    const t = data.responseData?.translatedText?.trim() || '';
    if (!t) throw new Error('MyMemory: empty response');
    out.push(t);
  }
  return out.join(' ');
}

// 일부 페어는 영어 경유 (MyMemory의 영어 페어가 가장 잘 학습됨)
// 주의: mn→ko는 직접 호출이 더 좋게 나오는 케이스가 있어 영어 경유에서 제외
const PIVOT_VIA_EN = new Set(['ko->mn', 'mn->ja', 'ja->mn', 'mn->ru', 'ru->mn']);
async function myMemoryTranslate(text, from, to) {
  if (from === to) return text;
  if (from !== 'en' && to !== 'en' && PIVOT_VIA_EN.has(`${from}->${to}`)) {
    const en = await myMemoryDirect(text, from, 'en');
    return await myMemoryDirect(en, 'en', to);
  }
  return myMemoryDirect(text, from, to);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Whisper supported languages (no Mongolian!)
const WHISPER_SUPPORTED = ['ko', 'en', 'ja', 'ru'];

// STT - Whisper for supported langs, Gemini for Mongolian
app.post('/api/stt', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file' });
    
    const ext = req.file.originalname?.match(/\.\w+$/)?.[0] || '.webm';
    const newPath = req.file.path + ext;
    fs.renameSync(req.file.path, newPath);
    
    const lang = req.body.language || 'ko';
    
    // Use Gemini for ALL languages (free!)
    const audioData = fs.readFileSync(newPath);
    const base64Audio = audioData.toString('base64');
    fs.unlinkSync(newPath);
    
    const mimeType = req.file.mimetype || 'audio/webm';
    const langNames = { ko: 'Korean', en: 'English', ja: 'Japanese', ru: 'Russian', mn: 'Mongolian (Монгол хэл)' };
    const langName = langNames[lang] || lang;
    const scriptNote = lang === 'mn' ? ' in Cyrillic Mongolian script' : '';
    
    const text = await geminiRequest([
      { inline_data: { mime_type: mimeType, data: base64Audio } },
      { text: `Transcribe this audio. The speaker is speaking ${langName}. Output ONLY the transcription${scriptNote}. No explanations, no translations, just the exact words spoken.` }
    ]);
    
    console.log(`STT Gemini (${lang}): "${text.substring(0, 80)}"`);
    res.json({ text });
  } catch (err) {
    console.error('STT error:', err.message);
    try { fs.unlinkSync(req.file?.path); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// Translation system prompts per target language
const translationPrompts = {
  mn: `You are a professional Korean-Mongolian translator living in Ulaanbaatar.
You translate into NATURAL, everyday Mongolian (Монгол хэл) that locals actually speak.

Rules:
- Use Cyrillic script ONLY (Монгол кирилл бичиг)
- Use colloquial/spoken Mongolian, NOT literary/formal style
- Adapt Korean expressions to Mongolian equivalents (don't translate literally)
- Korean honorifics/politeness → natural Mongolian politeness level
- Slang/informal Korean → casual Mongolian equivalent
- Business terms → use terms Mongolians actually use (mixing Russian loanwords where natural)
- Output ONLY the translation. No explanations, no quotes.

Examples:
- "수고하셨습니다" → "Баярлалаа, сайн ажилласан" (not "Та хичээсэн байна")
- "밥 먹었어?" → "Хоол идсэн үү?" (not "Та хоол идсэн үү?")
- "화이팅!" → "Амжилт хүсье!" or "Тэвчээртэй бай!"`,

  ko: `You are a professional Mongolian-Korean translator.
You translate into natural, everyday Korean (한국어) that Koreans actually speak.

Rules:
- Use natural conversational Korean, matching the formality of the source
- Mongolian casual → Korean 해요체 or 반말 (match the tone)
- Mongolian formal → Korean 존댓말
- Adapt Mongolian expressions to Korean equivalents
- Output ONLY the translation. No explanations, no quotes.`,

  en: `You are a professional translator. Translate into natural, clear English.
- Match the tone/formality of the source text
- Adapt cultural expressions naturally
- Output ONLY the translation. No explanations, no quotes.`,

  ja: `You are a professional translator. Translate into natural Japanese (日本語).
- Use appropriate politeness level (です/ます or casual)
- Adapt cultural expressions naturally
- Output ONLY the translation. No explanations, no quotes.`,

  ru: `You are a professional translator. Translate into natural Russian (Русский).
- Use appropriate register matching the source
- Output ONLY the translation. No explanations, no quotes.`,
};

// Translate
app.post('/api/translate', async (req, res) => {
  try {
    const { text, from, to } = req.body;
    if (!text) return res.status(400).json({ error: 'No text' });

    const langNames = {
      ko: '한국어 (Korean)',
      mn: '몽골어 (Mongolian/Монгол хэл)',
      en: '영어 (English)',
      ja: '일본어 (Japanese)',
      ru: '러시아어 (Russian)',
    };

    const fromName = langNames[from] || from;
    const toName = langNames[to] || to;

    let systemPrompt = translationPrompts[to] || 
      `You are a professional translator. Translate into ${toName}. Output ONLY the translation.`;
    
    systemPrompt += `\n\nTranslate the following ${fromName} text:`;

    let translated;
    try {
      translated = await geminiRequest([
        { text: `${systemPrompt}\n\n${text}` }
      ]);
    } catch (geminiErr) {
      console.error('Gemini failed, trying MyMemory fallback:', geminiErr.message);
      translated = await myMemoryTranslate(text, from, to);
      console.log(`[fallback:MyMemory] ${from}→${to} ok (${text.length} chars)`);
    }

    res.json({ translated });
  } catch (err) {
    console.error('Translate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Translator running on port ${PORT}`);
});
