const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');
const path = require('path');

contextBridge.exposeInMainWorld('vortex', {
	// Window
	closeWindow: () => ipcRenderer.send('win-close'),
	minimizeWindow: () => ipcRenderer.send('win-minimize'),
	maximizeWindow: () => ipcRenderer.send('win-maximize'),

	// Dialogs
	chooseFolder: () => ipcRenderer.invoke('choose-folder'),
	openFolder: (p) => ipcRenderer.invoke('open-folder', p),
	openFile: (p) => ipcRenderer.invoke('open-file', p),

	// Tools
	checkTools: () => ipcRenderer.invoke('check-tools'),
	autoInstallYtdlp: () => ipcRenderer.invoke('auto-install-ytdlp'),
	autoInstallFfmpeg: () => ipcRenderer.invoke('auto-install-ffmpeg'),
	updateYtdlp: () => ipcRenderer.invoke('update-ytdlp'),

	// Core
	fetchInfo: (opts) => ipcRenderer.invoke('fetch-info', opts),
	startDownload: (opts) => ipcRenderer.invoke('start-download', opts),
	cancelDownload: (id) => ipcRenderer.send('cancel-download', id),

	// Events
	onDownloadStarted: (cb) => ipcRenderer.on('download-started', (_, d) => cb(d)),
	onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, d) => cb(d)),
	onDownloadError: (cb) => ipcRenderer.on('download-error', (_, d) => cb(d)),
	onInstallProgress: (cb) => ipcRenderer.on('install-progress', (_, d) => cb(d)),

	// Utils
	defaultDownloadPath: path.join(os.homedir(), 'Downloads', 'Vortex'),
	platform: process.platform,
});
