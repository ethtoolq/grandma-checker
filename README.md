# 🧓 Can My Grandma Use It?

Rule-based UX analyzer — no AI, pure DOM parsing + scoring engine.

## Stack

- **Backend**: Node.js 18+ · Express · Cheerio · Helmet · express-rate-limit
- **Frontend**: Vanilla JS/HTML, zero dependencies
- **Languages**: RU / EN switcher built-in

## Security

| Защита | Описание |
|--------|----------|
| Rate limiting | 5 запросов / минуту с одного IP |
| SSRF protection | Блокировка localhost, 192.168.x, 10.x, 172.x, link-local |
| Helmet | Безопасные HTTP-заголовки |
| Body limit | Максимум 10 KB на входящий запрос |
| Response limit | Читаем не более 2 MB HTML с целевого сайта |
| URL validation | Только http/https, только домены (не IP-адреса напрямую) |

## Scoring engine

```
complexity = buttons + inputs×2 + menuDepth×3 + words/80

Штрафы:
  > 10 кнопок      → -15 pts    нет CTA       → -15 pts
  > 3 уровня меню  → -22 pts    нет H1        → -8  pts
  > 8 техтерминов  → -15 pts    > 1000 слов   → -8  pts
  > 60 ссылок      → -8  pts    > 1 модалки   → -5  pts
```

## Быстрый старт (локально)

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Deploy на VPS

```bash
# 1. Загрузить файлы
scp -r grandma-project/ user@your-vps:/var/www/grandma/

# 2. Установить зависимости
cd /var/www/grandma
npm install --production

# 3. Запустить через PM2
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# 4. Проверить что работает
pm2 status
curl http://localhost:3000
```

## Nginx + SSL

```nginx
# /etc/nginx/sites-available/grandma
limit_req_zone $binary_remote_addr zone=grandma:10m rate=10r/m;

server {
    listen 80;
    server_name yourdomain.com;

    # Дополнительный rate limit на уровне Nginx
    location /api/ {
        limit_req zone=grandma burst=3 nodelay;
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
    }
}
```

```bash
# Подключить сайт и получить SSL
ln -s /etc/nginx/sites-available/grandma /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d yourdomain.com
```

## API

```
POST /api/analyze
Content-Type: application/json

{ "url": "https://example.com", "lang": "ru" }

→ 200 OK
{
  "score": 72,
  "probability": 65,
  "verdict": "...",
  "quote": "...",
  "findings": [{ "severity": "bad|warn|good", "emoji": "🔴", "text": "..." }],
  "metrics": {
    "buttonCount": 8,
    "inputCount": 3,
    "menuDepth": 2,
    "linkCount": 45,
    "techTermCount": 2,
    "wordCount": 620,
    "complexity": 24,
    "hasCTA": true,
    "hasH1": true,
    "hostname": "example.com",
    "title": "Example Domain"
  }
}

→ 429 Too Many Requests  (rate limit)
→ 400 Bad Request        (невалидный URL)
→ 500 Server Error       (сайт недоступен)
```

## Структура проекта

```
grandma-project/
├── server.js              # Express API + парсер + scoring
├── public/
│   └── index.html         # SPA: тёмная тема, EN/RU
├── package.json
├── ecosystem.config.js    # PM2
├── .env.example
└── README.md
```
