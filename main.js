// launcher/main.js — Download Tycoon Launcher v2
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, exec } = require('child_process');

/* ================== КОНСТАНТЫ ================== */
const GAME_DIR       = path.join(__dirname, '..');
const GAME_PACKAGE   = path.join(GAME_DIR, 'package.json');
const GAME_MAIN      = path.join(GAME_DIR, 'main.js');
const GAME_INDEX     = path.join(GAME_DIR, 'index.html');
const GAME_MODULES   = path.join(GAME_DIR, 'node_modules');
const LAUNCHER_EL    = path.join(__dirname, 'electron');
const isWin          = process.platform === 'win32';
const ELECTRON_VER   = '31.0.0';

const USERDATA       = app.getPath('userData');
const SETTINGS_FILE  = path.join(USERDATA, 'settings.json');
const BACKUP_DIR     = path.join(USERDATA, 'backups');
const LOG_FILE       = path.join(USERDATA, 'launcher.log');
const SAVE_DIR       = path.join(app.getPath('appData'), 'Download Tycoon', 'Local Storage');

/* ================== СОСТОЯНИЕ ================== */
let mainWindow = null;
let tray = null;
let gameProcess = null;
let isDownloading = false;
let isUpdating = false;
let isQuitting = false;

let settings = {
  theme: 'dark',
  lang: 'ru',
  autostart: false,
  trayOnClose: true,
  sound: true,
  repo: '',                // репозиторий ИГРЫ для обновлений
  launcherRepo: '',        // репозиторий ЛАУНЧЕРА (для само-обновления)
  autoUpdateLauncher: true,
  checkUpdate: true,
  autoBackup: true,
  compact: false
};

/* ================== УТИЛИТЫ ================== */
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      settings = { ...settings, ...s };
    }
  } catch (e) { console.error('settings load', e); }
}
function saveSettings() {
  try {
    fs.mkdirSync(USERDATA, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) { console.error('settings save', e); }
}
function ensureDirs() {
  for (const d of [USERDATA, BACKUP_DIR]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  }
}
function send(ch, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data);
}
function log(msg, type = 'info') {
  const time = new Date().toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const line = `[${time}] ${msg}`;
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
  send('launcher-log', { time, msg: String(msg), type });
}
function which(cmd) {
  return new Promise(resolve => {
    const finder = isWin ? 'where' : 'which';
    exec(`${finder} ${cmd}`, { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const line = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
      resolve(line || null);
    });
  });
}
async function fileExists(p) {
  try { await fs.promises.access(p); return true; } catch { return false; }
}
function httpsGet(url, cb) {
  https.get(url, { headers: { 'User-Agent': 'Download-Tycoon-Launcher' } }, res => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      return httpsGet(res.headers.location, cb);
    }
    cb(res);
  }).on('error', err => cb(null, err));
}
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    httpsGet(url, (res, err) => {
      if (err) return reject(err);
      if (!res) return reject(new Error('Нет ответа'));
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', chunk => {
        downloaded += chunk.length;
        if (onProgress && total) onProgress(downloaded / total, downloaded, total);
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', reject);
    });
  });
}
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    exec(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`,
      { windowsHide: true }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve();
      });
  });
}

/* ================== ПОИСК ELECTRON ================== */
async function findElectron() {
  const local = path.join(GAME_MODULES, 'electron', 'dist', isWin ? 'electron.exe' : 'electron');
  if (await fileExists(local)) return { path: local, source: 'node_modules игры' };

  const launcherEl = path.join(LAUNCHER_EL, 'electron.exe');
  if (await fileExists(launcherEl)) return { path: launcherEl, source: 'лаунчер (скачанный)' };

  const globalEl = await which('electron');
  if (globalEl) return { path: globalEl, source: 'глобальный electron' };

  // npx кэш
  const npmCache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  if (isWin && await fileExists(npmCache)) {
    try {
      const dirs = await fs.promises.readdir(npmCache);
      for (const d of dirs) {
        const cand = path.join(npmCache, d, 'node_modules', 'electron', 'dist', 'electron.exe');
        if (await fileExists(cand)) return { path: cand, source: 'npx кэш' };
      }
    } catch {}
  }

  if (isWin) {
    const guesses = [
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'electron', 'dist', 'electron.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'electron', 'electron.exe')
    ];
    for (const g of guesses) if (g && await fileExists(g)) return { path: g, source: 'стандартный путь' };
  }
  return null;
}

/* ================== СКАЧИВАНИЕ ELECTRON ================== */
async function downloadElectron() {
  if (isDownloading) return { ok: false, reason: 'already-downloading' };
  isDownloading = true;

  const tmpZip = path.join(USERDATA, 'electron-tmp.zip');

  try {
    log('Скачивание Electron ' + ELECTRON_VER + '...', 'info');
    const url = `https://github.com/electron/electron/releases/download/v${ELECTRON_VER}/electron-v${ELECTRON_VER}-win32-x64.zip`;

    await downloadFile(url, tmpZip, (p, got, total) => {
      const pct = (p * 100).toFixed(1);
      send('launcher-download-progress', { pct, got, total });
      if (Math.floor(pct) % 10 === 0) log(`Скачано ${pct}% (${(got/1024/1024).toFixed(1)} МБ)`, 'dim');
    });

    log('Распаковка...', 'info');
    await extractZip(tmpZip, LAUNCHER_EL);
    try { fs.unlinkSync(tmpZip); } catch {}

    const el = path.join(LAUNCHER_EL, 'electron.exe');
    if (!await fileExists(el)) throw new Error('electron.exe не найден после распаковки');

    log('Electron установлен ✓', 'good');
    notify('Установка завершена', 'Electron готов к запуску игры');
    isDownloading = false;
    return { ok: true };
  } catch (err) {
    log('Ошибка: ' + err.message, 'bad');
    try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch {}
    isDownloading = false;
    return { ok: false, error: err.message };
  }
}

/* ================== ВЕРСИИ И СРАВНЕНИЕ ================== */
function getLauncherVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0, vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/* ================== ПРОВЕРКА ОБНОВЛЕНИЯ ЛАУНЧЕРА ================== */
async function checkLauncherUpdate(silent = false) {
  if (!settings.launcherRepo) {
    if (!silent) log('Репозиторий лаунчера не указан в настройках', 'warn');
    return { ok: false, reason: 'no-repo' };
  }

  const info = await githubGet(`https://api.github.com/repos/${settings.launcherRepo}/releases/latest`);
  if (!info.ok) {
    if (info.status === 404) {
      return { ok: false, reason: 'no-releases', error: 'В репозитории лаунчера нет релизов' };
    }
    if (info.status === 403) {
      return { ok: false, reason: 'rate-limit', error: 'GitHub API: слишком много запросов' };
    }
    return { ok: false, reason: 'http', error: 'HTTP ' + info.status };
  }

  const data = info.body;
  const rawTag = data.tag_name || '';
  const remoteVer = rawTag.replace(/^launcher[-_]?v?/i, '').replace(/^v/i, '');
  const localVer = getLauncherVersion();
  const assets = data.assets || [];
  const asset = assets.find(a => /launcher.*\.zip$/i.test(a.name)) || assets.find(a => /\.zip$/i.test(a.name));

  const result = {
    ok: true,
    remoteVer,
    localVer,
    newer: compareVersions(remoteVer, localVer) > 0,
    changelog: data.body || '',
    publishedAt: data.published_at,
    downloadUrl: asset ? asset.browser_download_url : null,
    assetName: asset ? asset.name : null,
    noZip: !asset
  };

  if (result.newer) log(`Доступно обновление лаунчера: ${remoteVer} (у вас ${localVer})`, 'good');
  else if (!silent) log(`Лаунчер актуален (${localVer})`, 'dim');

  return result;
}

/* ================== ПРИМЕНЕНИЕ ОБНОВЛЕНИЯ ЛАУНЧЕРА ================== */
async function downloadAndApplyLauncherUpdate(url) {
  if (isDownloading) return { ok: false, reason: 'busy' };
  isDownloading = true;

  const tmpZip = path.join(USERDATA, 'launcher-update.zip');
  const extractDir = path.join(USERDATA, 'launcher-extract');
  const backupDir = path.join(USERDATA, 'launcher-backup');

  try {
    log('Скачивание обновления лаунчера...', 'info');
    send('launcher-update-progress', { stage: 'download', pct: 0, text: 'Скачивание' });

    await downloadFile(url, tmpZip, (p, got, total) => {
      const pct = p * 100;
      send('launcher-update-progress', {
        stage: 'download',
        pct,
        text: `Скачивание: ${pct.toFixed(0)}% (${(got/1024/1024).toFixed(1)} МБ)`
      });
    });

    // Бэкап старого лаунчера
    log('Сохранение резервной копии...', 'info');
    try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
    fs.cpSync(__dirname, backupDir, {
      recursive: true,
      filter: src => !src.includes('node_modules')
    });

    // Распаковка во временную папку
    log('Распаковка...', 'info');
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
    await extractZip(tmpZip, extractDir);
    send('launcher-update-progress', { stage: 'extract', pct: 100, text: 'Распаковка завершена' });

    // Иногда zip содержит вложенную папку — определяем корень
    let sourceDir = extractDir;
    try {
      const entries = fs.readdirSync(extractDir);
      if (entries.length === 1 && fs.statSync(path.join(extractDir, entries[0])).isDirectory()) {
        sourceDir = path.join(extractDir, entries[0]);
      }
    } catch {}

    if (!fs.existsSync(path.join(sourceDir, 'main.js'))) {
      throw new Error('В архиве нет main.js — это не лаунчер');
    }

    // Применение: копируем файлы поверх старых
    log('Применение обновления...', 'info');
    send('launcher-update-progress', { stage: 'apply', pct: 30, text: 'Применение' });

    const files = ['main.js', 'preload.js', 'index.html', 'renderer.js', 'styles.css', 'package.json'];
    for (const f of files) {
      const src = path.join(sourceDir, f);
      const dst = path.join(__dirname, f);
      if (fs.existsSync(src)) {
        try {
          fs.copyFileSync(src, dst);
          log('  → ' + f, 'dim');
        } catch (e) {
          log('  Пропущено ' + f + ': ' + e.message, 'warn');
        }
      }
    }

    // Дополнительные папки (на будущее)
    for (const d of ['assets', 'img', 'icons']) {
      const src = path.join(sourceDir, d);
      if (fs.existsSync(src)) {
        try {
          const dst = path.join(__dirname, d);
          fs.rmSync(dst, { recursive: true, force: true });
          fs.cpSync(src, dst, { recursive: true });
          log('  → ' + d + '/', 'dim');
        } catch (e) {}
      }
    }

    send('launcher-update-progress', { stage: 'apply', pct: 100, text: 'Готово' });
    log('Обновление применено ✓', 'good');

    // Чистим временные файлы
    try { fs.unlinkSync(tmpZip); } catch {}
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}

    isDownloading = false;

    // Перезапуск через 1.5 секунды (чтобы игрок увидел финальный прогресс)
    send('launcher-update-progress', { stage: 'restart', pct: 100, text: 'Перезапуск лаунчера...' });
    log('Перезапуск лаунчера...', 'info');

    setTimeout(() => {
      try {
        app.relaunch({
          execPath: process.execPath,
          args: process.argv.slice(1),
          cwd: process.cwd()
        });
        app.exit(0);
      } catch (e) {
        log('Не удалось перезапустить: ' + e.message, 'bad');
        app.quit();
      }
    }, 1500);

    return { ok: true };
  } catch (err) {
    log('Ошибка обновления лаунчера: ' + err.message, 'bad');
    try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch {}
    isDownloading = false;
    return { ok: false, error: err.message };
  }
}

/* ================== ЗАПУСК ИГРЫ ================== */
async function launchGame() {
  if (gameProcess) { log('Игра уже запущена', 'warn'); return { ok: false }; }

  const el = await findElectron();
  if (!el) {
    log('Electron не найден. Нажмите «Скачать Electron».', 'bad');
    return { ok: false, reason: 'no-electron' };
  }

  // Авто-бэкап перед запуском
  if (settings.autoBackup) {
    try { backupSave(true); } catch (e) {}
  }

  log(`Electron: ${el.source}`, 'dim');
  log('Запуск Download Tycoon...', 'good');
  send('game-started');

  if (mainWindow && !mainWindow.isDestroyed() && settings.trayOnClose) mainWindow.hide();

  gameProcess = spawn(el.path, ['.'], {
    cwd: GAME_DIR,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false
  });

  gameProcess.stdout.on('data', d => {
    const t = d.toString().trim();
    if (t) log(t, 'dim');
  });
  gameProcess.stderr.on('data', d => {
    const t = d.toString().trim();
    if (t) log(t, 'warn');
  });

  gameProcess.on('error', err => {
    log('Ошибка запуска: ' + err.message, 'bad');
    gameProcess = null;
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); send('game-stopped'); }
  });

  gameProcess.on('close', code => {
    gameProcess = null;
    log(`Игра закрыта (код ${code})`, 'info');
    notify('Игра завершена', `Код выхода: ${code}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show(); mainWindow.focus();
      send('game-stopped');
    }
  });

  return { ok: true };
}

/* ================== БЭКАПЫ ================== */
function listBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(d => fs.statSync(path.join(BACKUP_DIR, d)).isDirectory())
      .map(d => {
        const p = path.join(BACKUP_DIR, d);
        const st = fs.statSync(p);
        let size = 0;
        try {
          const walk = dir => {
            for (const f of fs.readdirSync(dir)) {
              const fp = path.join(dir, f);
              const s = fs.statSync(fp);
              if (s.isDirectory()) walk(fp); else size += s.size;
            }
          };
          walk(p);
        } catch {}
        return { id: d, time: st.mtimeMs, size };
      })
      .sort((a, b) => b.time - a.time);
  } catch { return []; }
}
function backupSave(auto = false) {
  if (!fs.existsSync(SAVE_DIR)) {
    const msg = 'Папка сохранений игры не найдена. Запустите игру хотя бы раз.';
    if (!auto) log(msg, 'warn');
    return { error: msg };
  }
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, id);
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.cpSync(SAVE_DIR, dest, { recursive: true });
    log(`Бэкап сохранений создан: ${id}`, 'good');
    // ротация: держим 20 последних
    const all = listBackups();
    for (const b of all.slice(20)) {
      try { fs.rmSync(path.join(BACKUP_DIR, b.id), { recursive: true, force: true }); } catch {}
    }
    send('backups-changed');
    return id;
  } catch (e) {
    log('Ошибка бэкапа: ' + e.message, 'bad');
    return null;
  }
}
function restoreBackup(id) {
  if (gameProcess) {
    log('Закройте игру перед восстановлением сохранений', 'bad');
    return { ok: false, error: 'game-running' };
  }
  const src = path.join(BACKUP_DIR, id);
  if (!fs.existsSync(src)) return { ok: false, error: 'not-found' };
  try {
    // Сначала сохраним текущее во временную папку
    backupSave(true);
    // Удаляем текущее и копируем из бэкапа
    if (fs.existsSync(SAVE_DIR)) fs.rmSync(SAVE_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(SAVE_DIR), { recursive: true });
    fs.cpSync(src, SAVE_DIR, { recursive: true });
    log('Сохранение восстановлено: ' + id, 'good');
    notify('Восстановление', 'Сохранения восстановлены из бэкапа');
    return { ok: true };
  } catch (e) {
    log('Ошибка восстановления: ' + e.message, 'bad');
    return { ok: false, error: e.message };
  }
}
function deleteBackup(id) {
  try { fs.rmSync(path.join(BACKUP_DIR, id), { recursive: true, force: true }); send('backups-changed'); return true; }
  catch { return false; }
}

/* ================== ОБНОВЛЕНИЯ ================== */
async function checkUpdate() {
  if (!settings.repo) {
    log('Не указан GitHub-репозиторий в настройках', 'warn');
    return { ok: false, reason: 'no-repo' };
  }

  // 1) Сначала проверим, существует ли репозиторий вообще
  const repoInfo = await githubGet(`https://api.github.com/repos/${settings.repo}`);

  if (!repoInfo.ok) {
    if (repoInfo.status === 404) {
      log('Репозиторий не найден: ' + settings.repo, 'bad');
      return {
        ok: false,
        reason: 'repo-not-found',
        error: 'Репозиторий не найден или приватный. Проверьте логин/имя в настройках.'
      };
    }
    if (repoInfo.status === 403) {
      log('GitHub API: превышен лимит запросов', 'bad');
      return {
        ok: false,
        reason: 'rate-limit',
        error: 'Слишком много запросов. Подождите 10 минут.'
      };
    }
    log('Ошибка GitHub: ' + repoInfo.status, 'bad');
    return { ok: false, reason: 'http', error: 'HTTP ' + repoInfo.status };
  }

  log('Репозиторий найден: ' + settings.repo, 'dim');

  // 2) Теперь проверяем релизы
  const relInfo = await githubGet(`https://api.github.com/repos/${settings.repo}/releases/latest`);

  if (!relInfo.ok) {
    if (relInfo.status === 404) {
      log('В репозитории ещё нет опубликованных релизов', 'warn');
      return {
        ok: false,
        reason: 'no-releases',
        error: 'В репозитории ещё нет релизов. Создайте Release с zip-архивом на GitHub.'
      };
    }
    log('Ошибка получения релиза: ' + relInfo.status, 'bad');
    return { ok: false, reason: 'http', error: 'HTTP ' + relInfo.status };
  }

  const data = relInfo.body;
  const remoteVer = (data.tag_name || '').replace(/^v/, '');
  const localVer = getLocalVersion();
  const asset = (data.assets || []).find(a => /\.zip$/i.test(a.name));

  const info = {
    ok: true,
    remoteVer,
    localVer,
    newer: remoteVer && remoteVer !== localVer,
    changelog: data.body || '',
    publishedAt: data.published_at,
    downloadUrl: asset ? asset.browser_download_url : null,
    assetName: asset ? asset.name : null,
    noZip: !asset
  };

  if (info.newer) log(`Доступна версия ${remoteVer} (у вас ${localVer})`, 'good');
  else log(`У вас последняя версия (${localVer})`, 'good');

  return info;
}

/* Универсальный GET к GitHub API — возвращает { ok, status, body } */
function githubGet(url) {
  return new Promise(resolve => {
    httpsGet(url, (res, err) => {
      if (err || !res) {
        return resolve({ ok: false, status: 0, error: err ? err.message : 'no response' });
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: parsed
        });
      });
    });
  });
}

function getLocalVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(GAME_PACKAGE, 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

async function downloadUpdate(url) {
  if (isUpdating) return { ok: false };
  isUpdating = true;
  try {
    log('Скачивание обновления...', 'info');
    const tmpZip = path.join(USERDATA, 'update-tmp.zip');
    await downloadFile(url, tmpZip, (p) => {
      send('launcher-download-progress', { pct: (p * 100).toFixed(1) });
    });
    log('Распаковка обновления...', 'info');
    await extractZip(tmpZip, GAME_DIR);
    try { fs.unlinkSync(tmpZip); } catch {}
    log('Обновление установлено ✓', 'good');
    notify('Обновление установлено', 'Перезапустите игру');
    isUpdating = false;
    return { ok: true };
  } catch (e) {
    log('Ошибка обновления: ' + e.message, 'bad');
    isUpdating = false;
    return { ok: false, error: e.message };
  }
}

/* ================== УВЕДОМЛЕНИЯ ================== */
function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: String(title), body: String(body) }).show();
    }
  } catch {}
}

/* ================== АВТОЗАПУСК ================== */
function setAutostart(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      path: process.execPath,
      args: [__dirname]   // Electron принимает папку приложения, не JS-файл
    });
    log(`Автозапуск: ${enabled ? 'ВКЛ' : 'ВЫКЛ'}`, 'info');
    return true;
  } catch (e) { log('Автозапуск недоступен: ' + e.message, 'warn'); return false; }
}

/* ================== ТРЕЙ ================== */
function createTray() {
  try {
    // Простая иконка-квадрат
    const icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAX0lEQVR42mNkYPhfz0AEYBxVSF+FjIyM/xkYGP4zMjL+Z2Rk/M/AwPCfkZHxPwMDw39GRsb/DAwM/xkZGf8DAG4dF/9jM2EBAAAAAElFTkSuQmCC'
    );
    tray = new Tray(icon);
    tray.setToolTip('Download Tycoon');
    const menu = Menu.buildFromTemplate([
      { label: '▶ Играть', click: () => launchGame() },
      { label: '📁 Папка игры', click: () => shell.openPath(GAME_DIR) },
      { label: '🔄 Проверить обновления', click: () => checkUpdate() },
      { type: 'separator' },
      { label: '💾 Бэкап сейчас', click: () => backupSave() },
      { type: 'separator' },
      { label: '❌ Выход', click: () => { isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
    tray.on('double-click', () => launchGame());
  } catch (e) { console.error('tray', e); }
}

/* ================== ОКНО ================== */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: settings.compact ? 520 : 900,
    height: settings.compact ? 320 : 640,
    minWidth: 500, minHeight: 300,
    frame: false, resizable: !settings.compact,
    backgroundColor: '#070a0e',
    show: false,
    title: 'Download Tycoon — Лаунчер',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', e => {
    if (!isQuitting && settings.trayOnClose) {
      e.preventDefault();
      mainWindow.hide();
      notify('Лаунчер свёрнут', 'Кликните по иконке в трее, чтобы вернуться');
    }
  });
}

/* ================== APP ================== */
app.whenReady().then(() => {
  loadSettings();
  ensureDirs();
  createWindow();
  createTray();
  setAutostart(settings.autostart);

  // Автопроверка обновления лаунчера через 2 секунды после старта
  if (settings.autoUpdateLauncher && settings.launcherRepo) {
    setTimeout(async () => {
      try {
        const res = await checkLauncherUpdate(true);
        if (res.ok && res.newer) {
          log(`Найдено обновление лаунчера: ${res.localVer} → ${res.remoteVer}`, 'good');
          if (res.noZip) {
            log('В релизе нет zip-архива — автообновление невозможно', 'warn');
            return;
          }
          send('launcher-update-available', res);
        }
      } catch (e) {
        log('Ошибка автопроверки: ' + e.message, 'warn');
      }
    }, 2000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  if (!settings.trayOnClose) app.quit();
});

app.on('before-quit', () => { isQuitting = true; });

/* ================== IPC ================== */
ipcMain.handle('launcher:check', async () => {
  log('Проверка окружения...', 'info');
  const node = await which('node');
  const nodeVer = node ? await new Promise(r => {
    exec('node --version', { windowsHide: true }, (e, o) => r(e ? null : o.trim()));
  }) : null;

  const missing = [];
  if (!fs.existsSync(GAME_PACKAGE)) missing.push('package.json');
  if (!fs.existsSync(GAME_MAIN))    missing.push('main.js');
  if (!fs.existsSync(GAME_INDEX))   missing.push('index.html');

  const el = await findElectron();
  const localVer = getLocalVersion();

  if (nodeVer) log('Node.js: ' + nodeVer, 'good');
  else log('Node.js не найден (не критично)', 'warn');

  if (!missing.length) log('Файлы игры на месте ✓', 'good');
  else log('Отсутствуют: ' + missing.join(', '), 'bad');

  if (el) log('Electron: ' + el.source, 'good');
  else log('Electron не найден', 'bad');

  return {
    ready: !missing.length && !!el,
    node: !!node,
    nodeVersion: nodeVer,
    filesMissing: missing,
    electronFound: !!el,
    electronSource: el ? el.source : null,
    localVersion: localVer
  };
});

ipcMain.handle('launcher:play', () => launchGame());
ipcMain.handle('launcher:download-electron', () => downloadElectron());
ipcMain.handle('launcher:open-folder', () => { shell.openPath(GAME_DIR); return true; });
ipcMain.handle('launcher:open-userdata', () => { shell.openPath(USERDATA); return true; });
ipcMain.handle('launcher:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('launcher:close', () => { isQuitting = true; app.quit(); });
ipcMain.handle('launcher:hide-to-tray', () => { if (mainWindow) mainWindow.hide(); });

ipcMain.handle('launcher:get-settings', () => settings);
ipcMain.handle('launcher:set-settings', (_, s) => {
  settings = { ...settings, ...s };
  saveSettings();
  if ('autostart' in s) setAutostart(settings.autostart);
  log('Настройки сохранены', 'info');
  return settings;
});

ipcMain.handle('launcher:list-backups', () => listBackups());
ipcMain.handle('launcher:backup-now', () => ({ id: backupSave() }));
ipcMain.handle('launcher:restore-backup', (_, id) => restoreBackup(id));
ipcMain.handle('launcher:delete-backup', (_, id) => ({ ok: deleteBackup(id) }));

ipcMain.handle('launcher:check-launcher-update', () => checkLauncherUpdate(false));
ipcMain.handle('launcher:download-launcher-update', (_, url) => downloadAndApplyLauncherUpdate(url));
ipcMain.handle('launcher:get-launcher-version', () => getLauncherVersion());

ipcMain.handle('launcher:check-update', () => checkUpdate());
ipcMain.handle('launcher:download-update', (_, url) => downloadUpdate(url));

ipcMain.handle('launcher:export-log', async () => {
  try {
    const text = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : 'Пусто';
    const dest = path.join(app.getPath('desktop'), `download-tycoon-log-${Date.now()}.txt`);
    fs.writeFileSync(dest, text);
    shell.showItemInFolder(dest);
    log('Лог экспортирован: ' + dest, 'good');
    return { ok: true, path: dest };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('launcher:open-devtools', () => {
  if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' });
});

ipcMain.handle('launcher:toggle-compact', () => {
  settings.compact = !settings.compact;
  saveSettings();
  if (mainWindow) {
    mainWindow.setSize(settings.compact ? 520 : 900, settings.compact ? 320 : 640);
    mainWindow.setResizable(!settings.compact);
  }
  return settings.compact;
});