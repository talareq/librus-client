/**
 * Minimalny serwer: zapisuje tokeny FCM z aplikacji i wysyła „budzik” (data message)
 * bez żadnych danych Librus — sync dzieje się tylko po stronie apki.
 *
 * Uruchomienie: npm install && API_SECRET=tajne GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npm start
 *
 * Po dodaniu aplikacji w Firebase Console pobierz `google-services.json` (Android)
 * i ustaw zmienną na ścieżkę do **service account** JSON (Projekt → Ustawienia → konta serwisowe).
 */
import cors from 'cors';
import express from 'express';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const API_SECRET = process.env.API_SECRET || '';
const TOKENS_FILE = process.env.TOKENS_FILE || path.join(__dirname, 'data', 'tokens.json');
const WAKE_ACTION = 'librus_wake_sync';

function bearer(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

function requireAuth(req, res, next) {
  if (!API_SECRET) {
    return res.status(500).json({ error: 'Skonfiguruj API_SECRET w środowisku serwera.' });
  }
  const t = bearer(req);
  if (t !== API_SECRET) {
    return res.status(401).json({ error: 'Nieautoryzowany' });
  }
  next();
}

function loadTokens() {
  try {
    const raw = fs.readFileSync(TOKENS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveTokens(list) {
  fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function upsertToken(token, platform) {
  const now = Date.now();
  const list = loadTokens().filter((x) => x.token !== token);
  list.push({ token, platform: platform || 'unknown', updatedAt: now });
  saveTokens(list);
  return list;
}

function initFirebase() {
  if (admin.apps.length) return;
  const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonRaw) {
    const cred = JSON.parse(jsonRaw);
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    return;
  }
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file && fs.existsSync(file)) {
    const cred = JSON.parse(fs.readFileSync(file, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    return;
  }
  const local = path.join(__dirname, 'service-account.json');
  if (fs.existsSync(local)) {
    const cred = JSON.parse(fs.readFileSync(local, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    return;
  }
  throw new Error(
    'Brak poświadczeń Firebase: ustaw GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT_JSON lub plik service-account.json'
  );
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/v1/devices', requireAuth, (req, res) => {
  const { token, platform } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Wymagane pole token (string FCM).' });
  }
  const list = upsertToken(token, platform);
  res.json({ ok: true, devices: list.length });
});

app.post('/v1/wake', requireAuth, async (_req, res) => {
  try {
    initFirebase();
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
  const tokens = loadTokens().map((x) => x.token);
  if (!tokens.length) {
    return res.status(409).json({ error: 'Brak zarejestrowanych tokenów — uruchom apkę z włączonym remotePushWake.' });
  }

  const base = {
    data: { action: WAKE_ACTION },
    android: {
      priority: 'high',
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: {
        aps: {
          alert: {
            title: 'Librus Client',
            body: 'Synchronizacja na żądanie (FCM)',
          },
          sound: 'default',
        },
      },
    },
  };

  const chunkSize = 400;
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);
    const result = await admin.messaging().sendEachForMulticast({ ...base, tokens: chunk });
    sent += result.successCount;
    failed += result.failureCount;
  }

  res.json({ ok: true, targets: tokens.length, sent, failed, action: WAKE_ACTION });
});

app.listen(PORT, () => {
  console.log(`librus-push-wake listening on :${PORT}`);
  console.log('POST /v1/devices  — rejestracja tokena z aplikacji');
  console.log('POST /v1/wake     — wyślij FCM (Authorization: Bearer API_SECRET)');
});
