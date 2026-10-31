# Oila shajarasi — mustaqil sayt

Cloudflare Worker (bepul) + D1 bazasi. Kod va haftalik zaxira shu GitHub repozitoriyda saqlanadi.

- **Ko'rish:** havolani olgan har kim ko'radi (kirishsiz). Tirik insonlarning tug'ilgan kun va oyi yashiriladi — faqat yili ko'rinadi.
- **Tahrirlash:** faqat egasi, sahifadagi «Kirish» tugmasi orqali parol bilan.
- Qidiruv tizimlari saytni indekslamaydi (`noindex`).

## Bir martalik sozlash

Loyiha Cloudflare **Worker** (statik fayllar + API) sifatida ishlaydi. Har `main` ga push qilinganda Cloudflare o'zi qayta quradi.

1. **Workers & Pages → Create → Import a repository** → `shajara` (allaqachon ulangan).
   Build command: `npm run build`, Deploy command: `npx wrangler deploy` (standart).
2. D1 bazasi (`shajara-db`) birinchi deployda **avtomatik yaratiladi** — qo'lda hech narsa kerak emas.
   Jadvallar va boshlang'ich 40 kishi sayt birinchi ochilganda yoziladi.
3. Worker → **Settings → Variables and Secrets → Add**:
   - Type **Secret**, `ADMIN_PASSWORD` = tahrirlash paroli (kamida 12 belgi)
   - Type **Secret**, `BACKUP_TOKEN` = kamida 16 belgili tasodifiy matn (zaxira uchun)
4. Sayt manzili: Worker → **Domains** bo'limida (`shajara.<akkaunt>.workers.dev`). Oching → **Kirish** → parol.

### Haftalik avtomatik zaxira
GitHub → repozitoriy → **Settings → Secrets and variables → Actions → New repository secret**:
- `SITE_URL` = sayt manzili (masalan `https://shajara.xxxx.workers.dev`)
- `BACKUP_TOKEN` = Cloudflare'dagi bilan aynan bir xil

Har yakshanba `backup/shajara-zaxira.json` yangilanadi. Darhol sinash: **Actions → Haftalik zaxira → Run workflow**.

## Shajarada aka-uka / opa-singillar tartibi
Odatiy tartib — tug'ilgan sana bo'yicha. Admin (kirgan holda) tartibni o'zgartira oladi:
- kartaning pastki chap burchagidagi ⠿ tutqichni surib (butun shox — turmush o'rtog'i, farzandlari, nabiralari — birga ko'chadi);
- yoki insonni bosib, ochilgan panelda **Tartib ‹ ›** tugmalari bilan (telefonda qulay); tutqich tanlanganda ← → tugmalari ham ishlaydi;
- **Tug'ilgan sana bo'yicha** tugmasi tartibni asl holiga qaytaradi.

Tartib alohida `sibling_order` jadvalida saqlanadi (inson yozuvlari, sanalar o'zgarmaydi). Jadval worker ishga tushganda o'zi yaratiladi
(`CREATE TABLE IF NOT EXISTS`); qo'lda qo'llash ixtiyoriy: `npx wrangler d1 execute shajara-db --remote --file=migrations/0001_sibling_order.sql`.

## Zaxiradan tiklash
Saytda **Eksport → Zaxira nusxa → Fayldan tiklash** → `backup/shajara-zaxira.json` (suratlar bilan birga tiklanadi).

## O'z domeningiz (ixtiyoriy, pullik)
Masalan `qochqorovlar.uz` sotib olsangiz: Worker → **Domains → Add custom domain**.

## Dasturchi uchun
- `src/shajara.html` — asosiy sahifa (claude.ai versiyasi bilan bir xil).
- `python3 build.py` → `public/index.html` yasaydi (server adapteri va kirish tugmasini qo'shadi).
- `public/sj-adapter.js` — sahifani `/api` ga ulaydi.
- `src/worker.js` — kirish nuqtasi, `src/api.js` — API (D1), `src/blob.js` — suratlar, `wrangler.jsonc` — sozlama.
- Daraxt ko'rinishi: «Ikki tomon» rejimi (`combLayout` — `src/shajara.html`) ota tomoni (chapda) va ona tomoni (o'ngda) ajdodlarini nikoh orqali bitta daraxtda ko'rsatadi; o'chirilsa — avvalgi bir oilali daraxt (`layoutTree`).
- `lib/seed.js` — boshlang'ich ma'lumot (faqat baza bo'sh bo'lganda bir marta yoziladi).
- Testlar: `npm test` (tartib, shox joylashuvi, API va saqlanish — mahalliy D1 bilan, internet kerak emas).
- Mahalliy sinov: `npm i && npm run dev` → http://localhost:8788 (parol: `sinov123`).
