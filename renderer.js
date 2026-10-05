const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let currentSettings = { theme: 'dark', lang: 'ru', sound: true };

/* ---------- ЗВУК ---------- */
const Sound = (() => {
  let ctx = null;
  function ac() { if (!ctx) try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} return ctx; }
  function beep(f = 440, d = .05, t = 'sine', v = .04) {
    if (!currentSettings.sound) return;
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = t; o.frequency.value = f;
    g.gain.setValueAtTime(v, c.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + d);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + d);
  }
  return {
    click: () => beep(880, .03, 'square', .03),
    ok:    () => { beep(660, .06); setTimeout(() => beep(990, .08), 60); },
    error: () => beep(200, .12, 'sawtooth', .05)
  };
})();

/* ---------- ЛОГ ---------- */
const logEl = $('#log');
function appendLog({ time, msg, type }) {
  const line = document.createElement('div');
  line.className = 'log-line ' + (type || 'info');
  line.innerHTML = `<span class="log-time">[${time}]</span><span class="log-msg"></span>`;
  line.querySelector('.log-msg').textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > 300) logEl.removeChild(logEl.firstChild);
}

/* ---------- СТАТУС ---------- */
const statusEl = {
  node:     document.querySelector('.status-item[data-key="node"]'),
  files:    document.querySelector('.status-item[data-key="files"]'),
  electron: document.querySelector('.status-item[data-key="electron"]')
};
function setStatus(key, state, text) {
  const el = statusEl[key]; if (!el) return;
  el.classList.remove('ok', 'bad', 'warn');
  el.classList.add(state);
  el.querySelector('.s-ico').textContent =
    state === 'ok' ? '✅' : state === 'bad' ? '❌' : state === 'warn' ? '⚠️' : '⏳';
  el.querySelector('.s-val').textContent = text;
}

/* ---------- ПРОВЕРКА ---------- */
const btnPlay = $('#btn-play');
const btnDownloadEl = $('#btn-download-el');

async function runCheck() {
  btnPlay.disabled = true;
  btnDownloadEl.hidden = true;

  setStatus('node', 'warn', 'проверка…');
  setStatus('files', 'warn', 'проверка…');
  setStatus('electron', 'warn', 'поиск…');

  const res = await window.launcherAPI.check();

  if (res.node) setStatus('node', 'ok', res.nodeVersion || 'ок');
  else          setStatus('node', 'warn', 'не найден');

  if (res.filesMissing.length === 0) setStatus('files', 'ok', 'на месте');
  else setStatus('files', 'bad', 'нет: ' + res.filesMissing.join(', '));

  if (res.electronFound) setStatus('electron', 'ok', res.electronSource || 'найден');
  else                   setStatus('electron', 'bad', 'не найден');

  $('#local-version').textContent = 'v' + (res.localVersion || '?');

  if (res.ready) {
    btnPlay.disabled = false;
    btnDownloadEl.hidden = true;
  } else if (!res.filesMissing.length && !res.electronFound) {
    btnDownloadEl.hidden = false;
    btnPlay.disabled = true;
  } else {
    btnPlay.disabled = true;
  }
}

/* ---------- ИГРАТЬ ---------- */
async function play() {
  btnPlay.disabled = true;
  Sound.click();
  const res = await window.launcherAPI.play();
  if (!res || !res.ok) {
    btnPlay.disabled = false;
    Sound.error();
    if (res && res.reason === 'no-electron') {
      btnDownloadEl.hidden = false;
    }
  }
}

btnPlay.addEventListener('click', play);
$('#btn-recheck').addEventListener('click', () => { Sound.click(); runCheck(); });
$('#btn-folder').addEventListener('click', () => window.launcherAPI.openFolder());
$('#btn-min').addEventListener('click', () => window.launcherAPI.hideToTray());
$('#btn-close').addEventListener('click', () => window.launcherAPI.close());

/* ---------- СКАЧИВАНИЕ ELECTRON ---------- */
btnDownloadEl.addEventListener('click', async () => {
  btnDownloadEl.disabled = true;
  btnDownloadEl.textContent = '⬇️ Скачивание…';
  Sound.click();
  const res = await window.launcherAPI.downloadEl();
  btnDownloadEl.disabled = false;
  btnDownloadEl.textContent = '⬇️ Скачать Electron';
  if (res.ok) {
    Sound.ok();
    await runCheck();
  } else {
    Sound.error();
  }
});

/* ---------- ТАБЫ ---------- */
$$('.tab[data-tab]').forEach(t => t.addEventListener('click', () => {
  $$('.tab[data-tab]').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  const tab = t.dataset.tab;
  $$('.pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tab));
  Sound.click();
  if (tab === 'backups') loadBackups();
}));

/* ---------- БЭКАПЫ ---------- */
async function loadBackups() {
  const list = await window.launcherAPI.listBackups();
  const el = $('#backup-list');
  if (!list.length) {
    el.innerHTML = `<div style="text-align:center;color:var(--dim);padding:30px">Бэкапов нет. Нажмите «Создать бэкап».</div>`;
    return;
  }
  el.innerHTML = list.map(b => {
    const d = new Date(b.time).toLocaleString('ru-RU');
    const kb = (b.size / 1024).toFixed(0);
    return `<div class="backup-row">
      <span class="b-time">📅 ${d}</span>
      <span class="b-size">${kb} КБ</span>
      <button class="btn acc" data-restore="${b.id}">Восстановить</button>
      <button class="btn red" data-del="${b.id}">✕</button>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Восстановить это сохранение?')) return;
    Sound.click();
    const res = await window.launcherAPI.restoreBackup(b.dataset.restore);
    if (res.ok) {
      Sound.ok();
      notifyUser('Готово', 'Сохранения восстановлены');
    } else if (res.error === 'game-running') {
      Sound.error();
      notifyUser('Игра запущена', 'Закройте игру перед восстановлением');
    } else {
      Sound.error();
      notifyUser('Ошибка', 'Не удалось восстановить сохранения');
    }
  }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить бэкап?')) return;
    await window.launcherAPI.deleteBackup(b.dataset.del);
    Sound.click();
    loadBackups();
  }));
}

$('#btn-backup-now').addEventListener('click', async () => {
  Sound.click();
  const r = await window.launcherAPI.backupNow();
  const res = r && r.id;
  if (res && res.error) {
    Sound.error();
    notifyUser('Не удалось создать бэкап', res.error);
  } else if (res) {
    Sound.ok();
    notifyUser('Бэкап создан', 'ID: ' + res);
  } else {
    Sound.error();
  }
  loadBackups();
});
$('#btn-open-save').addEventListener('click', () => window.launcherAPI.openFolder());

/* ---------- ОБНОВЛЕНИЯ ---------- */
let lastUpdateInfo = null;

$('#btn-check-update').addEventListener('click', async () => {
  const btn = $('#btn-check-update');
  btn.disabled = true; btn.textContent = 'Проверка…';
  Sound.click();
  const res = await window.launcherAPI.checkUpdate();
  btn.disabled = false; btn.textContent = 'Проверить';

  if (!res.ok) {
    $('#upd-status').textContent =
      res.reason === 'repo-not-found' ? 'Репозиторий не найден'
      : res.reason === 'no-releases'  ? 'Ещё нет релизов'
      : res.reason === 'no-repo'      ? 'Не указан репозиторий'
      : res.reason === 'rate-limit'   ? 'Слишком много запросов'
      : 'Ошибка проверки';

    let hint = res.error || '';
    if (res.reason === 'no-releases') {
      hint = 'Зайдите на github.com/' + (await window.launcherAPI.getSettings()).repo +
             '/releases → «Create a new release» → прикрепите zip.';
    }
    if (res.reason === 'no-repo') {
      hint = 'Впишите в Настройках: логин/имя-репозитория';
    }
    $('#upd-sub').innerHTML = hint.replace(/</g, '&lt;');
    Sound.error();
    return;
  }
  lastUpdateInfo = res;

  if (res.newer) {
    $('#upd-status').textContent = `Доступна версия ${res.remoteVer} (у вас ${res.localVer})`;
    $('#upd-sub').textContent = res.publishedAt
      ? 'Опубликовано: ' + new Date(res.publishedAt).toLocaleString('ru-RU')
      : '';
    $('#changelog').innerHTML = (res.changelog || 'Без описания')
      .replace(/</g, '&lt;')
      .replace(/\n/g, '<br>') +
      `<div style="margin-top:14px">
        <button class="btn acc" id="btn-install-upd" ${!res.downloadUrl ? 'disabled' : ''}>
          ⬇️ Установить ${res.remoteVer}
        </button>
      </div>`;
    const bi = $('#btn-install-upd');
    if (bi) bi.addEventListener('click', async () => {
      bi.disabled = true; bi.textContent = 'Скачивание…';
      Sound.click();
      const r = await window.launcherAPI.downloadUpdate(res.downloadUrl);
      if (r.ok) { Sound.ok(); bi.textContent = '✅ Установлено'; }
      else { Sound.error(); bi.disabled = false; bi.textContent = 'Ошибка — повторить'; }
    });
    Sound.ok();
  } else {
    $('#upd-status').textContent = `У вас последняя версия (${res.localVer})`;
    $('#upd-sub').textContent = '';
    $('#changelog').innerHTML = '';
    Sound.ok();
  }
});

/* ---------- НАСТРОЙКИ ---------- */
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  $$('#theme-tabs .tab-inline').forEach(t => t.classList.toggle('active', t.dataset.themeVal === theme));
}

function bindSettings() {
  $$('#theme-tabs .tab-inline').forEach(t => t.addEventListener('click', async () => {
    const v = t.dataset.themeVal;
    applyTheme(v);
    Sound.click();
    const s = await window.launcherAPI.setSettings({ theme: v });
    currentSettings = s;
  }));

  $$('[data-lang]').forEach(t => t.addEventListener('click', async () => {
    $$('[data-lang]').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const s = await window.launcherAPI.setSettings({ lang: t.dataset.lang });
    currentSettings = s;
    Sound.click();
  }));

  $('#set-autostart').addEventListener('change', e =>
    window.launcherAPI.setSettings({ autostart: e.target.checked }));
  $('#set-tray').addEventListener('change', e =>
    window.launcherAPI.setSettings({ trayOnClose: e.target.checked }));
  $('#set-sound').addEventListener('change', async e => {
    const s = await window.launcherAPI.setSettings({ sound: e.target.checked });
    currentSettings = s;
  });
  $('#set-autobackup').addEventListener('change', e =>
    window.launcherAPI.setSettings({ autoBackup: e.target.checked }));

  const repoEl = $('#set-repo');
  repoEl.addEventListener('blur', () =>
    window.launcherAPI.setSettings({ repo: repoEl.value.trim() }));

  const lRepoEl = $('#set-launcher-repo');
  lRepoEl.addEventListener('blur', () =>
    window.launcherAPI.setSettings({ launcherRepo: lRepoEl.value.trim() }));

  $('#set-auto-upd-launcher').addEventListener('change', e =>
    window.launcherAPI.setSettings({ autoUpdateLauncher: e.target.checked }));
}

/* ---------- ИНСТРУМЕНТЫ ---------- */
$('#btn-devtools').addEventListener('click', () => window.launcherAPI.openDevTools());
$('#btn-export-log').addEventListener('click', async () => {
  Sound.click();
  const r = await window.launcherAPI.exportLog();
  if (r.ok) Sound.ok(); else Sound.error();
});
$('#btn-userdata').addEventListener('click', () => window.launcherAPI.openUserData());

/* ---------- КОМПАКТ ---------- */
$('#btn-compact').addEventListener('click', async () => {
  const compact = await window.launcherAPI.toggleCompact();
  document.body.classList.toggle('compact', compact);
  Sound.click();
});

/* ---------- УВЕДОМЛЕНИЯ ОТ MAIN ---------- */
function notifyUser(title, body) {
  // Всплывашка внутри окна (для простоты)
  const div = document.createElement('div');
  div.style.cssText = `
    position:fixed;top:44px;right:18px;padding:10px 14px;
    background:var(--panel2);border:1px solid var(--line);border-left:3px solid var(--acc);
    border-radius:8px;font-size:12px;color:var(--text);z-index:9999;
    box-shadow:0 10px 28px rgba(0,0,0,.5);animation:slideIn .2s ease-out;
  `;
  div.innerHTML = `<div style="font-weight:700">${title}</div><div style="color:var(--dim);margin-top:3px">${body}</div>`;
  document.body.appendChild(div);
  setTimeout(() => { div.style.opacity = '0'; div.style.transition = '.3s'; setTimeout(() => div.remove(), 300); }, 3200);
}

window.launcherAPI.onLog(appendLog);
window.launcherAPI.onGameStarted(() => appendLog({ time: nowStr(), msg: 'Игра запускается…', type: 'info' }));
window.launcherAPI.onGameStopped(() => {
  appendLog({ time: nowStr(), msg: 'Игра закрыта. Лаунчер снова активен.', type: 'info' });
  $('#dl-progress-zone').hidden = true;  // убираем прогресс-бар, если он остался
  runCheck();                            // перепроверяем, что Electron на месте
});
window.launcherAPI.onBackupsChanged(() => loadBackups());
window.launcherAPI.onDownloadProgress(({ pct }) => {
  $('#dl-progress-zone').hidden = false;
  $('#dl-progress-bar').style.width = pct + '%';
  $('#dl-progress-text').textContent = pct + '%';
  // Когда дошли до 100% — через секунду скрываем
  if (parseFloat(pct) >= 99.5) {
    setTimeout(() => {
      $('#dl-progress-zone').hidden = true;
      $('#dl-progress-bar').style.width = '0%';
    }, 1200);
  }
});

function nowStr() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ---------- ХОТКЕИ ---------- */
document.addEventListener('keydown', e => {
  if (e.key === 'F5') { e.preventDefault(); runCheck(); }
  else if (e.key === 'Enter' && !btnPlay.disabled) { e.preventDefault(); play(); }
  else if (e.key === 'Escape') window.launcherAPI.hideToTray();
  else if (e.ctrlKey && e.shiftKey && e.key === 'I') window.launcherAPI.openDevTools();
});

/* ---------- ПРОВЕРКА ОБНОВЛЕНИЯ ЛАУНЧЕРА ---------- */
$('#btn-check-launcher').addEventListener('click', async () => {
  const btn = $('#btn-check-launcher');
  const result = $('#launcher-upd-result');
  const repo = $('#set-launcher-repo').value.trim();

  result.innerHTML = '';
  if (!repo) {
    result.style.color = 'var(--warn)';
    result.textContent = 'Введите логин/имя-репозитория лаунчера';
    Sound.error();
    return;
  }
  await window.launcherAPI.setSettings({ launcherRepo: repo });

  btn.disabled = true;
  btn.textContent = 'Проверка…';
  Sound.click();

  const res = await window.launcherAPI.checkLauncherUpdate();
  btn.disabled = false;
  btn.textContent = '🔍 Проверить обновление лаунчера';

  if (res.ok) {
    if (res.newer) {
      if (res.noZip) {
        result.style.color = 'var(--warn)';
        result.innerHTML = `⚠️ Доступна версия <b>${res.remoteVer}</b>, но в релизе нет zip-архива.<br>Прикрепите zip к релизу на GitHub.`;
      } else {
        result.style.color = 'var(--acc)';
        result.innerHTML = `⬆️ Доступна версия <b>${res.remoteVer}</b> (у вас ${res.localVer}).
          <br><br><button class="btn acc" id="btn-apply-launcher-upd">⬇️ Обновить сейчас</button>`;
        const applyBtn = $('#btn-apply-launcher-upd');
        applyBtn.addEventListener('click', async () => {
          applyBtn.disabled = true;
          applyBtn.textContent = 'Обновление…';
          showLauncherUpdateBar('Подготовка…', 0);
          Sound.click();
          const r = await window.launcherAPI.downloadLauncherUpdate(res.downloadUrl);
          if (!r.ok) {
            Sound.error();
            applyBtn.disabled = false;
            applyBtn.textContent = '⬇️ Повторить';
            hideLauncherUpdateBar();
          }
        });
      }
    } else {
      result.style.color = 'var(--acc)';
      result.innerHTML = `✅ У вас последняя версия (<b>${res.localVer}</b>)`;
    }
    Sound.ok();
  } else {
    result.style.color = 'var(--bad)';
    result.innerHTML = '❌ ' + (res.error || 'Ошибка');
    Sound.error();
  }
});

/* ---------- ПОЛОСА ОБНОВЛЕНИЯ ЛАУНЧЕРА ---------- */
function showLauncherUpdateBar(text, pct) {
  const bar = $('#launcher-upd-bar');
  bar.hidden = false;
  document.body.classList.add('has-launcher-update');
  $('#lub-text').textContent = text;
  $('#lub-fill').style.width = pct + '%';
  $('#lub-pct').textContent = Math.round(pct) + '%';
}

function hideLauncherUpdateBar() {
  const bar = $('#launcher-upd-bar');
  bar.hidden = true;
  document.body.classList.remove('has-launcher-update');
}

/* Автопоявление полосы при старте, если есть обновление */
window.launcherAPI.onLauncherUpdateAvailable(res => {
  appendLog({
    time: nowStr(),
    msg: `Автопроверка: доступна версия лаунчера ${res.remoteVer} (у вас ${res.localVer})`,
    type: 'good'
  });
  // Показываем полосу и ждём 3 секунды, потом автоматически обновляемся
  showLauncherUpdateBar(`Обновление лаунчера: v${res.localVer} → v${res.remoteVer}`, 0);
  let countdown = 3;
  const t = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      $('#lub-text').textContent =
        `Обновление лаунчера: v${res.localVer} → v${res.remoteVer} (через ${countdown} сек)`;
    } else {
      clearInterval(t);
      // Запускаем скачивание
      (async () => {
        const r = await window.launcherAPI.downloadLauncherUpdate(res.downloadUrl);
        if (!r.ok) {
          appendLog({ time: nowStr(), msg: 'Автообновление не удалось: ' + (r.error || ''), type: 'bad' });
          hideLauncherUpdateBar();
        }
      })();
    }
  }, 1000);
});

/* Прогресс скачивания и применения */
window.launcherAPI.onLauncherUpdateProgress(({ stage, pct, text }) => {
  const label =
    stage === 'download' ? '⬇️ ' + (text || 'Скачивание')
    : stage === 'extract' ? '📦 ' + (text || 'Распаковка')
    : stage === 'apply'   ? '📝 ' + (text || 'Применение')
    : stage === 'restart' ? '🔄 ' + (text || 'Перезапуск')
    : (text || 'Обновление');
  showLauncherUpdateBar(label, pct || 0);
});

/* ---------- СТАРТ ---------- */
(async () => {
  const s = await window.launcherAPI.getSettings();
  currentSettings = s;
  applyTheme(s.theme || 'dark');
  $$('#theme-tabs .tab-inline').forEach(t => t.classList.toggle('active', t.dataset.themeVal === s.theme));
  $$('[data-lang]').forEach(t => t.classList.toggle('active', t.dataset.lang === s.lang));
  $('#set-autostart').checked = !!s.autostart;
  $('#set-tray').checked = s.trayOnClose !== false;
  $('#set-sound').checked = s.sound !== false;
  $('#set-autobackup').checked = s.autoBackup !== false;
  $('#set-repo').value = s.repo || '';

  $('#set-launcher-repo').value = s.launcherRepo || '';
  $('#set-auto-upd-launcher').checked = s.autoUpdateLauncher !== false;

  bindSettings();
  runCheck();
})();

$('#btn-check-repo').addEventListener('click', async () => {
  const btn = $('#btn-check-repo');
  const result = $('#repo-check-result');
  const repo = $('#set-repo').value.trim();

  result.innerHTML = '';
  if (!repo) {
    result.style.color = 'var(--warn)';
    result.textContent = 'Введите логин/имя-репозитория';
    Sound.error();
    return;
  }

  // Сохраняем перед проверкой
  await window.launcherAPI.setSettings({ repo });
  currentSettings.repo = repo;

  btn.disabled = true;
  btn.textContent = 'Проверка…';
  Sound.click();

  const res = await window.launcherAPI.checkUpdate();
  btn.disabled = false;
  btn.textContent = '🔍 Проверить репозиторий';

  if (res.ok) {
    result.style.color = 'var(--acc)';
    result.innerHTML = `✅ Репозиторий найден.<br>Ваша версия: <b>${res.localVer}</b> · На GitHub: <b>${res.remoteVer}</b>` +
      (res.newer ? '<br>💡 Доступно обновление!' : '<br>У вас последняя версия.');
    Sound.ok();
  } else {
    result.style.color = 'var(--bad)';
    result.innerHTML = '❌ ' + (res.error || 'Ошибка');
    if (res.reason === 'no-releases') {
      result.innerHTML += `<br><br>Как создать релиз:<br>
        1. Откройте <code>github.com/${repo}/releases</code><br>
        2. Нажмите «Create a new release»<br>
        3. Тег: <code>v1.0.0</code><br>
        4. Прикрепите zip с игрой<br>
        5. Publish release`;
    }
    Sound.error();
  }
});