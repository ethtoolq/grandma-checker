'use strict';

const { File } = require('buffer');
global.File = File;

const express   = require('express');
const cheerio   = require('cheerio');
const rateLimit = require('express-rate-limit');
const helmet    = require('helmet');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ──────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: false, // отключаем CSP чтобы не ломать шрифты Google
}));

// Ограничение размера тела запроса
app.use(express.json({ limit: '10kb' }));

// Rate limiter для API: 5 запросов в минуту с одного IP
const apiLimiter = rateLimit({
  windowMs        : 60 * 1000,
  max             : 5,
  standardHeaders : true,
  legacyHeaders   : false,
  handler         : (req, res) => {
    res.status(429).json({
      error: req.body?.lang === 'en'
        ? 'Too many requests. Please wait a minute.'
        : 'Слишком много запросов. Подождите минуту.',
    });
  },
});

// Rate limiter для статики: 120 запросов в минуту (защита от флуда)
const staticLimiter = rateLimit({
  windowMs : 60 * 1000,
  max      : 120,
  standardHeaders: true,
  legacyHeaders  : false,
});

app.use(staticLimiter);
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ──────────────────────────────────────────────────────────────────

// Заблокированные диапазоны (SSRF защита)
const BLOCKED_HOSTS = [
  'localhost', '127.', '0.0.0.0', '::1',
  '192.168.', '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
  '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
  '169.254.',   // link-local
  'metadata.',  // cloud metadata endpoints
];

function validateUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let url = raw.trim();
  if (url.length > 500) return null;

  // Добавляем схему если нет
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  // Проверяем что это вообще валидный URL
  let parsed;
  try { parsed = new URL(url); }
  catch { return null; }

  // Разрешаем только http/https
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;

  // Блокируем внутренние адреса
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.some(b => host.startsWith(b) || host === b.replace(/\.$/, ''))) {
    return null;
  }

  // Блокируем IP-адреса напрямую (не домены) — опционально, убери если нужно
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;

  return url;
}

// ── Data ─────────────────────────────────────────────────────────────────────

const TECH_TERMS = [
  'api','sdk','oauth','json','xml','backend','frontend','authentication',
  'credential','token','webhook','endpoint','repository','deploy','cache',
  'ssl','vpn','proxy','middleware','kubernetes','docker','devops','agile',
  'saas','paas','microservice','git','bash','cli','rest','graphql','async',
  '2fa','mfa','captcha','firewall','bandwidth','serverless','blockchain',
  'cryptocurrency','metadata','cookie','session','csrf','cors',
];

const CTA_KEYWORDS = [
  'купить','заказать','подписаться','зарегистрироваться','начать','попробовать',
  'войти','скачать','получить','оформить',
  'buy','subscribe','sign up','get started','register','order','try',
  'download','start','join','explore','shop now',
];

// ── HTML Parser ───────────────────────────────────────────────────────────────

function getMenuDepth($, el, d = 0) {
  const lists = $(el).children('ul, ol');
  if (!lists.length) return d;
  let max = d;
  lists.each((_, l) => { max = Math.max(max, getMenuDepth($, l, d + 1)); });
  return max;
}

function parseHTML(html, url) {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg').remove();

  const buttonCount = $('button, input[type="submit"], input[type="button"], [role="button"]').length;
  const inputCount  = $('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]):not([type="image"]), select, textarea').length;
  const linkCount   = $('a[href]').length;
  const formCount   = $('form').length;
  const imageCount  = $('img').length;
  const h1Count     = $('h1').length;

  let menuDepth = 0;
  $('nav, [role="navigation"], header').each((_, el) => {
    menuDepth = Math.max(menuDepth, getMenuDepth($, el));
  });

  const bodyText = $.text().replace(/\s+/g, ' ').trim();
  const words    = bodyText.split(/\s+/).filter(w => w.length > 2);
  const lower    = bodyText.toLowerCase();

  const foundTerms = TECH_TERMS.filter(t => lower.includes(t));
  const hasCTA     = CTA_KEYWORDS.some(k => lower.includes(k));

  const smallTextCount = $('[class*="small"],[class*="-xs"],[class*="caption"],small,figcaption').length;
  const modalCount     = $('[role="dialog"],[class*="modal"],[class*="popup"],[class*="overlay"],[class*="drawer"]').length;

  const complexity = buttonCount + inputCount * 2 + menuDepth * 3 + Math.floor(words.length / 80);

  let hostname = '';
  try { hostname = new URL(url).hostname; } catch {}

  return {
    buttonCount, inputCount, linkCount, formCount, imageCount, h1Count,
    menuDepth, techTermCount: foundTerms.length, foundTerms: foundTerms.slice(0, 6),
    wordCount: words.length, hasCTA, hasH1: h1Count > 0,
    smallTextCount, modalCount, complexity,
    title: $('title').text().trim().slice(0, 80),
    hostname,
  };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function calcScore(m) {
  let s = 100;

  if      (m.buttonCount > 15) s -= 25;
  else if (m.buttonCount > 10) s -= 15;
  else if (m.buttonCount > 7)  s -= 8;
  else if (m.buttonCount > 5)  s -= 4;

  if      (m.inputCount > 12)  s -= 20;
  else if (m.inputCount > 8)   s -= 12;
  else if (m.inputCount > 5)   s -= 6;
  else if (m.inputCount > 3)   s -= 2;

  if      (m.menuDepth >= 3)   s -= 22;
  else if (m.menuDepth === 2)  s -= 10;

  if      (m.wordCount > 2000) s -= 15;
  else if (m.wordCount > 1000) s -= 8;
  else if (m.wordCount > 600)  s -= 4;

  if (!m.hasCTA) s -= 15;
  if (!m.hasH1)  s -= 8;

  if      (m.linkCount > 100)  s -= 15;
  else if (m.linkCount > 60)   s -= 8;
  else if (m.linkCount > 35)   s -= 4;

  if      (m.techTermCount > 8) s -= 15;
  else if (m.techTermCount > 4) s -= 8;
  else if (m.techTermCount > 2) s -= 4;

  if (m.modalCount     > 1) s -= 5;
  if (m.smallTextCount > 8) s -= 6;

  return Math.max(0, Math.min(100, s));
}

function calcProbability(score, m) {
  let p = score * 0.88;
  if (m.hasCTA)          p += 4;
  if (m.hasH1)           p += 2;
  if (m.menuDepth <= 1)  p += 4;
  if (m.buttonCount <= 5) p += 3;
  return Math.max(3, Math.min(97, Math.round(p)));
}

// ── Verdicts ──────────────────────────────────────────────────────────────────

function getVerdict(score, m, lang) {
  const ru = lang === 'ru';
  const clicks = m.menuDepth + m.formCount + 2;

  if (score < 25) return ru
    ? 'Это не сайт — это цифровой квест. Бабушка позвонила внуку на второй секунде.'
    : "This isn't a website — it's a digital maze. Grandma called her grandson after 2 seconds.";
  if (score < 45) return ru
    ? `Чтобы выполнить главное действие нужно пройти через ${clicks} экрана. Бабушка уже закрыла вкладку.`
    : `To complete the main action takes ${clicks} screens. Grandma already closed the tab.`;
  if (score < 65) return ru
    ? 'Можно использовать, но придётся постараться. Бабушка справится с третьей попытки.'
    : 'Usable, but requires effort. Grandma will get through on the third try.';
  if (score < 85) return ru
    ? 'Неплохо. Бабушка разберётся за пять минут.'
    : 'Not bad. Grandma will figure it out in about five minutes.';
  return ru
    ? 'Отлично. Бабушка уже прошла регистрацию и пишет отзыв.'
    : 'Excellent. Grandma already registered and is writing a review.';
}

function getGrandmaQuote(score, lang) {
  const ru = lang === 'ru';
  if (score < 30) return ru ? '"Внучок, иди сюда, что это вообще такое?!"'             : '"Sonny, come here, what on earth is this thing?!"';
  if (score < 50) return ru ? '"Я нажала на кнопку — и всё исчезло. Что я сделала?"'   : '"I pressed a button and everything disappeared. What did I do?"';
  if (score < 70) return ru ? '"Ну вроде разобралась, но зачем тут столько всего?"'     : '"I think I figured it out, but why is there so much stuff here?"';
  if (score < 85) return ru ? '"Почти понятно. Ещё разок попробую."'                    : '"Almost clear. I\'ll try one more time."';
  return               ru ? '"О, это я сама могу! Даже зарегистрировалась!"'           : '"Oh, I can do this myself! I even registered!"';
}

// ── Findings ──────────────────────────────────────────────────────────────────

function getFindings(m, lang) {
  const ru = lang === 'ru';
  const f  = [];

  if (m.buttonCount > 10)
    f.push({ severity:'bad',  emoji:'🔴', text: ru
      ? `На странице обнаружено ${m.buttonCount} кнопок. Это на ${m.buttonCount - 3} больше нормы.`
      : `${m.buttonCount} buttons found. That's ${m.buttonCount - 3} more than the norm of 3.` });
  else if (m.buttonCount > 5)
    f.push({ severity:'warn', emoji:'🟡', text: ru
      ? `${m.buttonCount} кнопок — немного больше оптимального (3–5).`
      : `${m.buttonCount} buttons — slightly above optimal (3–5).` });
  else
    f.push({ severity:'good', emoji:'✅', text: ru
      ? `Кнопок в норме (${m.buttonCount}). Бабушка не растеряется.`
      : `Button count is healthy (${m.buttonCount}). Grandma won't get confused.` });

  if (m.inputCount > 8)
    f.push({ severity:'bad',  emoji:'🔴', text: ru
      ? `Форма требует заполнить ${m.inputCount} полей. Бабушка сдалась на третьем.`
      : `Form requires ${m.inputCount} fields. Grandma gave up at field #3.` });
  else if (m.inputCount > 4)
    f.push({ severity:'warn', emoji:'🟡', text: ru
      ? `${m.inputCount} полей ввода — можно упростить.`
      : `${m.inputCount} input fields — consider simplifying.` });
  else if (m.inputCount > 0)
    f.push({ severity:'good', emoji:'✅', text: ru
      ? `Мало полей ввода (${m.inputCount}). Заполнить легко.`
      : `Few input fields (${m.inputCount}). Easy to complete.` });

  if (m.menuDepth >= 3)
    f.push({ severity:'bad',  emoji:'🔴', text: ru
      ? `${m.menuDepth} уровня вложенности меню. Бабушка потерялась ещё на первом.`
      : `${m.menuDepth} levels of navigation nesting. Grandma got lost at level 1.` });
  else if (m.menuDepth === 2)
    f.push({ severity:'warn', emoji:'🟡', text: ru
      ? 'Двухуровневое меню. Один уровень был бы проще.'
      : 'Two-level navigation. One level would be simpler.' });
  else
    f.push({ severity:'good', emoji:'✅', text: ru
      ? 'Простая навигация без вложенных меню.'
      : 'Simple flat navigation — no nesting.' });

  if (!m.hasCTA)
    f.push({ severity:'bad',  emoji:'🔴', text: ru
      ? 'Призыв к действию не найден. Бабушка не знает, что нажать.'
      : 'No call-to-action found. Grandma has no idea what to click.' });
  else
    f.push({ severity:'good', emoji:'✅', text: ru
      ? 'Призыв к действию присутствует. Бабушка знает куда идти.'
      : 'Call-to-action is present. Grandma knows where to go.' });

  if (m.techTermCount > 4)
    f.push({ severity:'bad',  emoji:'🔴', text: ru
      ? `Найдено ${m.techTermCount} техтерминов${m.foundTerms.length ? ` (${m.foundTerms.slice(0,3).join(', ')})` : ''}. Бабушка думала это рецепт.`
      : `Found ${m.techTermCount} tech terms${m.foundTerms.length ? ` (${m.foundTerms.slice(0,3).join(', ')})` : ''}. Grandma thought it was a recipe.` });
  else if (m.techTermCount > 0)
    f.push({ severity:'warn', emoji:'🟡', text: ru
      ? `${m.techTermCount} техтерминов. Бабушка немного смущена.`
      : `${m.techTermCount} tech terms detected. Grandma is slightly confused.` });
  else
    f.push({ severity:'good', emoji:'✅', text: ru
      ? 'Технических терминов не обнаружено.'
      : 'No technical jargon detected.' });

  if (m.wordCount > 1500)
    f.push({ severity:'bad',  emoji:'🔴', text: ru
      ? `На странице ${m.wordCount} слов — информационная перегрузка.`
      : `${m.wordCount} words on the page — information overload.` });
  else if (m.wordCount > 700)
    f.push({ severity:'warn', emoji:'🟡', text: ru
      ? `${m.wordCount} слов на странице. Многовато для первого визита.`
      : `${m.wordCount} words. A lot of text for a first visit.` });

  return f.slice(0, 6);
}

// ── API ───────────────────────────────────────────────────────────────────────

const fs = require('fs');

const notifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests' }),
});

app.post('/api/notify', notifyLimiter, (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 200) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  const clean = email.trim().toLowerCase();
  const file  = path.join(__dirname, 'waitlist.txt');
  try {
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8');
      if (existing.includes(clean)) return res.json({ ok: true });
    }
    fs.appendFileSync(file, `${clean}\n`, 'utf8');
    const total = fs.readFileSync(file, 'utf8').trim().split('\n').length;
    console.log(`[waitlist] +${clean} (total: ${total})`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[notify]', err.message);
    res.status(500).json({ error: 'Could not save email' });
  }
});

app.post('/api/analyze', apiLimiter, async (req, res) => {
  const { lang = 'ru' } = req.body;
  const ru = lang === 'ru';

  // Валидация URL
  const url = validateUrl(req.body.url);
  if (!url) {
    return res.status(400).json({
      error: ru
        ? 'Некорректный URL. Введите адрес публичного сайта.'
        : 'Invalid URL. Please enter a public website address.',
    });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    // Ограничиваем размер ответа — читаем не больше 2 МБ
    const reader  = response.body.getReader();
    const maxSize = 2 * 1024 * 1024;
    let received  = 0;
    const chunks  = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxSize) { reader.cancel(); break; }
      chunks.push(value);
    }

    const html = new TextDecoder().decode(
      chunks.reduce((acc, c) => {
        const tmp = new Uint8Array(acc.length + c.length);
        tmp.set(acc); tmp.set(c, acc.length);
        return tmp;
      }, new Uint8Array())
    );

    const metrics     = parseHTML(html, url);
    const score       = calcScore(metrics);
    const probability = calcProbability(score, metrics);
    const verdict     = getVerdict(score, metrics, lang);
    const quote       = getGrandmaQuote(score, lang);
    const findings    = getFindings(metrics, lang);

    res.json({ metrics, score, probability, verdict, quote, findings, url });

  } catch (err) {
    console.error(`[analyze] ${url} → ${err.message}`);
    res.status(500).json({
      error: ru
        ? `Не удалось загрузить сайт: ${err.message}`
        : `Failed to load website: ${err.message}`,
    });
  }
});

// Fallback → SPA
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🧓  Can My Grandma Use It — http://localhost:${PORT}`);
  console.log(`    Rate limit: 5 req/min per IP`);
  console.log(`    SSRF protection: enabled`);
  console.log(`    Max response size: 2 MB`);
});
