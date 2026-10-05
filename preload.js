const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherAPI', {
  check:          () => ipcRenderer.invoke('launcher:check'),
  play:           () => ipcRenderer.invoke('launcher:play'),
  downloadEl:     () => ipcRenderer.invoke('launcher:download-electron'),
  openFolder:     () => ipcRenderer.invoke('launcher:open-folder'),
  openUserData:   () => ipcRenderer.invoke('launcher:open-userdata'),
  minimize:       () => ipcRenderer.invoke('launcher:minimize'),
  close:          () => ipcRenderer.invoke('launcher:close'),
  hideToTray:     () => ipcRenderer.invoke('launcher:hide-to-tray'),
  getSettings:    () => ipcRenderer.invoke('launcher:get-settings'),
  setSettings:    (s) => ipcRenderer.invoke('launcher:set-settings', s),
  listBackups:    () => ipcRenderer.invoke('launcher:list-backups'),
  backupNow:      () => ipcRenderer.invoke('launcher:backup-now'),
  restoreBackup:  (id) => ipcRenderer.invoke('launcher:restore-backup', id),
  deleteBackup:   (id) => ipcRenderer.invoke('launcher:delete-backup', id),
  checkUpdate:    () => ipcRenderer.invoke('launcher:check-update'),
  downloadUpdate: (url) => ipcRenderer.invoke('launcher:download-update', url),
  exportLog:      () => ipcRenderer.invoke('launcher:export-log'),
  openDevTools:   () => ipcRenderer.invoke('launcher:open-devtools'),
  toggleCompact:  () => ipcRenderer.invoke('launcher:toggle-compact'),

  onLog:              cb => ipcRenderer.on('launcher-log', (_, d) => cb(d)),
  onGameStarted:      cb => ipcRenderer.on('game-started', () => cb()),
  onGameStopped:      cb => ipcRenderer.on('game-stopped', () => cb()),
  onBackupsChanged:   cb => ipcRenderer.on('backups-changed', () => cb()),
  onDownloadProgress: cb => ipcRenderer.on('launcher-download-progress', (_, d) => cb(d)),

  checkLauncherUpdate:    () => ipcRenderer.invoke('launcher:check-launcher-update'),
  downloadLauncherUpdate: (url) => ipcRenderer.invoke('launcher:download-launcher-update', url),
  getLauncherVersion:     () => ipcRenderer.invoke('launcher:get-launcher-version'),

  onLauncherUpdateAvailable: cb => ipcRenderer.on('launcher-update-available', (_, d) => cb(d)),
  onLauncherUpdateProgress:  cb => ipcRenderer.on('launcher-update-progress',  (_, d) => cb(d)),
});