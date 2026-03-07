const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const https = require('https');

let mainWindow;
const activeDownloads = new Map();

const BIN_DIR = path.join(app.getPath('userData'), 'bin');
const YTDLP_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const FFMPEG_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

function ensureBinDir() {
	if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
}

function createWindow() {
	const preloadPath = path.join(__dirname, 'preload.js');
	console.log('[VORTEX] preload path:', preloadPath, '| exists:', fs.existsSync(preloadPath));

	mainWindow = new BrowserWindow({
		width: 1100,
		height: 720,
		minWidth: 820,
		minHeight: 560,
		frame: false,
		titleBarStyle: 'hidden',
		trafficLightPosition: { x: 16, y: 11 },
		backgroundColor: '#0a0a0b',
		icon: path.join(__dirname, '..', 'assets', 'icon.png'),
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});
	mainWindow.loadFile('index.html');
	// mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on('win-close', () => mainWindow.close());
ipcMain.on('win-minimize', () => mainWindow.minimize());
ipcMain.on('win-maximize', () => (mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()));

// ─── findBin ──────────────────────────────────────────────────────────────────
function findBin(name) {
	const exe = process.platform === 'win32' ? name + '.exe' : name;
	const candidates = [
		path.join(BIN_DIR, exe),
		path.join(app.getAppPath(), 'bin', exe),
		path.join(os.homedir(), '.local', 'bin', name),
		`/opt/homebrew/bin/${name}`,
		`/usr/local/bin/${name}`,
		`/usr/bin/${name}`,
		name,
	];
	for (const c of candidates) {
		try {
			if (fs.existsSync(c)) return c;
		} catch (_) {}
	}
	return name;
}

// ─── HTTPS helpers ────────────────────────────────────────────────────────────
function httpsGet(url, onData, onEnd, onError, hops = 0) {
	if (hops > 8) {
		onError(new Error('Too many redirects'));
		return;
	}
	const req = https.get(url, { headers: { 'User-Agent': 'Vortex/1.0' } }, (res) => {
		if ([301, 302, 307, 308].includes(res.statusCode)) {
			httpsGet(res.headers.location, onData, onEnd, onError, hops + 1);
			return;
		}
		if (res.statusCode !== 200) {
			onError(new Error(`HTTP ${res.statusCode}`));
			return;
		}
		const total = parseInt(res.headers['content-length'] || '0', 10);
		let received = 0;
		res.on('data', (chunk) => {
			received += chunk.length;
			onData(chunk, received, total);
		});
		res.on('end', onEnd);
		res.on('error', onError);
	});
	req.on('error', onError);
}

function downloadFileTo(url, dest, progressCb) {
	return new Promise((resolve, reject) => {
		ensureBinDir();
		const tmp = dest + '.download';
		const file = fs.createWriteStream(tmp);
		httpsGet(
			url,
			(chunk, received, total) => {
				file.write(chunk);
				if (progressCb && total > 0) progressCb(Math.round((received / total) * 100));
			},
			() => {
				file.end(() => {
					fs.renameSync(tmp, dest);
					if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
					resolve(dest);
				});
			},
			(err) => {
				file.destroy();
				try {
					fs.unlinkSync(tmp);
				} catch (_) {}
				reject(err);
			},
		);
	});
}

// ─── yt-dlp install ───────────────────────────────────────────────────────────
function fetchLatestYtdlpAsset() {
	return new Promise((resolve, reject) => {
		https
			.get('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', { headers: { 'User-Agent': 'Vortex/1.0' } }, (res) => {
				let d = '';
				res.on('data', (c) => (d += c));
				res.on('end', () => {
					try {
						const json = JSON.parse(d);
						const plat = process.platform,
							arch = process.arch;
						let name;
						if (plat === 'win32') name = 'yt-dlp.exe';
						else if (plat === 'darwin') name = arch === 'arm64' ? 'yt-dlp_macos' : 'yt-dlp_macos_legacy';
						else name = 'yt-dlp';
						const asset = json.assets.find((a) => a.name === name);
						if (!asset) reject(new Error(`Asset "${name}" not found`));
						else resolve({ url: asset.browser_download_url, version: json.tag_name });
					} catch (e) {
						reject(e);
					}
				});
				res.on('error', reject);
			})
			.on('error', reject);
	});
}

ipcMain.handle('auto-install-ytdlp', async () => {
	const send = (msg) => mainWindow.webContents.send('install-progress', { tool: 'yt-dlp', ...msg });
	try {
		send({ status: 'fetching', percent: 0, message: 'Consultando última versión en GitHub...' });
		const { url, version } = await fetchLatestYtdlpAsset();
		send({ status: 'downloading', percent: 0, message: `Descargando yt-dlp ${version}...` });
		await downloadFileTo(url, YTDLP_PATH, (pct) => send({ status: 'downloading', percent: pct, message: `Descargando yt-dlp ${version}... ${pct}%` }));
		send({ status: 'done', percent: 100, message: `yt-dlp ${version} instalado ✓` });
		return { success: true, version };
	} catch (err) {
		send({ status: 'error', message: err.message });
		throw err;
	}
});

// ─── ffmpeg install ───────────────────────────────────────────────────────────
function getFfmpegUrl() {
	const plat = process.platform,
		arch = process.arch;
	if (plat === 'win32') return { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip', archType: 'zip' };
	if (plat === 'darwin') return { url: 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip', archType: 'zip' };
	const a = arch === 'arm64' ? 'arm64' : 'amd64';
	return { url: `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${a}-static.tar.xz`, archType: 'tar.xz' };
}

async function extractAndMoveFfmpeg(archivePath, archType) {
	const extractDir = path.join(BIN_DIR, '_ffmpeg_extract');
	if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true });
	fs.mkdirSync(extractDir, { recursive: true });

	await new Promise((resolve, reject) => {
		let proc;
		if (archType === 'zip') {
			proc =
				process.platform === 'win32'
					? spawn('powershell', ['-Command', `Expand-Archive -Force '${archivePath}' '${extractDir}'`])
					: spawn('unzip', ['-o', archivePath, '-d', extractDir]);
		} else {
			proc = spawn('tar', ['-xJf', archivePath, '-C', extractDir]);
		}
		proc.on('close', resolve);
		proc.on('error', reject);
	});

	const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
	function findRecursive(dir) {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, e.name);
			if (e.isFile() && e.name === exeName) return full;
			if (e.isDirectory()) {
				const r = findRecursive(full);
				if (r) return r;
			}
		}
		return null;
	}
	const found = findRecursive(extractDir);
	if (!found) throw new Error('No se encontró el binario de ffmpeg en el archivo');
	fs.renameSync(found, FFMPEG_PATH);
	if (process.platform !== 'win32') fs.chmodSync(FFMPEG_PATH, 0o755);
	fs.rmSync(extractDir, { recursive: true });
}

ipcMain.handle('auto-install-ffmpeg', async () => {
	const send = (msg) => mainWindow.webContents.send('install-progress', { tool: 'ffmpeg', ...msg });
	try {
		send({ status: 'fetching', percent: 0, message: 'Preparando descarga de ffmpeg...' });
		const { url, archType } = getFfmpegUrl();
		const tmpArchive = path.join(BIN_DIR, `ffmpeg.${archType}`);
		send({ status: 'downloading', percent: 0, message: 'Descargando ffmpeg (~100MB)...' });
		await downloadFileTo(url, tmpArchive, (pct) => send({ status: 'downloading', percent: pct, message: `Descargando ffmpeg... ${pct}%` }));
		send({ status: 'extracting', percent: 99, message: 'Extrayendo ffmpeg...' });
		await extractAndMoveFfmpeg(tmpArchive, archType);
		try {
			fs.unlinkSync(tmpArchive);
		} catch (_) {}
		send({ status: 'done', percent: 100, message: 'ffmpeg instalado ✓' });
		return { success: true };
	} catch (err) {
		send({ status: 'error', message: err.message });
		throw err;
	}
});

// ─── check-tools ──────────────────────────────────────────────────────────────
ipcMain.handle('check-tools', async () => {
	const checkBin = (bin) =>
		new Promise((resolve) => {
			const proc = spawn(bin, ['--version']);
			let v = '';
			proc.stdout.on('data', (d) => (v += d.toString()));
			proc.on('close', (code) => resolve(code === 0 ? v.split('\n')[0].trim() : null));
			proc.on('error', () => resolve(null));
		});
	const [ytdlp, ffmpeg] = await Promise.all([checkBin(findBin('yt-dlp')), checkBin(findBin('ffmpeg'))]);
	return { ytdlp, ffmpeg };
});

// ─── Dialogs / shell ──────────────────────────────────────────────────────────
ipcMain.handle('choose-folder', async () => {
	const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
	return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('open-folder', (_, p) => shell.openPath(p));
ipcMain.handle('open-file', (_, p) => shell.openPath(p));

// ─── fetch-info ───────────────────────────────────────────────────────────────
ipcMain.handle('fetch-info', async (_, { url, isPlaylist }) => {
	return new Promise((resolve, reject) => {
		const ytdlp = findBin('yt-dlp');
		const args = isPlaylist ? ['--dump-json', '--flat-playlist', url] : ['--dump-json', '--no-playlist', url];
		let out = '',
			err = '';
		const proc = spawn(ytdlp, args);
		proc.stdout.on('data', (d) => (out += d));
		proc.stderr.on('data', (d) => (err += d));
		proc.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(err || `yt-dlp code ${code}`));
				return;
			}
			try {
				if (isPlaylist) {
					const items = out
						.trim()
						.split('\n')
						.filter(Boolean)
						.map((l) => {
							try {
								return JSON.parse(l);
							} catch (_) {
								return null;
							}
						})
						.filter(Boolean);
					resolve({
						isPlaylist: true,
						count: items.length,
						items: items.map((v, i) => ({
							index: i + 1,
							id: v.id,
							title: v.title || `Video ${i + 1}`,
							duration: v.duration_string || formatDuration(v.duration),
							thumbnail: v.thumbnails?.[0]?.url || v.thumbnail || '',
							url: v.url || `https://www.youtube.com/watch?v=${v.id}`,
							channel: v.channel || v.uploader || '',
						})),
					});
				} else {
					const info = JSON.parse(out);
					const thumbs = (info.thumbnails || []).filter((t) => t.url).sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));

					// Altura máxima real del video — para deshabilitar botones de resolución en la UI
					const maxHeight = info.height || Math.max(0, ...(info.formats || []).map((f) => f.height || 0));

					resolve({
						isPlaylist: false,
						id: info.id,
						title: info.title,
						channel: info.channel || info.uploader,
						duration: info.duration_string || formatDuration(info.duration),
						views: info.view_count,
						uploadDate: info.upload_date,
						thumbnail: info.thumbnail,
						thumbnailHD: thumbs[0]?.url || info.thumbnail,
						thumbnails: thumbs.slice(0, 6).map((t) => ({ url: t.url, width: t.width, height: t.height })),
						width: info.width,
						height: info.height,
						maxHeight,
						description: (info.description || '').slice(0, 400),
					});
				}
			} catch (e) {
				reject(new Error('Parse error: ' + e.message));
			}
		});
		proc.on('error', (e) => reject(new Error(`Cannot run yt-dlp: ${e.message}`)));
	});
});

// ─── start-download ───────────────────────────────────────────────────────────
ipcMain.handle('start-download', async (_, opts) => {
	const { url, outputDir, format, quality, audioOnly, subtitles, thumbnail, playlistItems } = opts;
	// Nota: `metadata` ya no viene de la UI — siempre se añade abajo.

	const ytdlp = findBin('yt-dlp');
	const ffmpeg = findBin('ffmpeg');

	// ── Selector de formato ──────────────────────────────────────
	let fmtSel;
	if (audioOnly) {
		fmtSel = 'bestaudio/best';
	} else {
		const H = { '4K': 2160, FHD: 1080, HD: 720, SD: 480 };
		fmtSel = `bestvideo[height<=${H[quality] || 1080}]+bestaudio/best[height<=${H[quality] || 1080}]`;
	}

	const tpl = path.join(outputDir, '%(title)s.%(ext)s');
	const args = ['-f', fmtSel, '--ffmpeg-location', ffmpeg, '-o', tpl, '--newline'];

	if (playlistItems) args.push('--playlist-items', playlistItems);
	else args.push('--no-playlist');

	// ── Formato de salida ────────────────────────────────────────
	if (audioOnly) {
		args.push('-x');
		if (format === 'FLAC') args.push('--audio-format', 'flac');
		else if (format === 'AAC') args.push('--audio-format', 'm4a');
		else args.push('--audio-format', 'mp3', '--audio-quality', `${quality}K`);
	} else {
		args.push('--merge-output-format', format === 'MKV' ? 'mkv' : format === 'WEBM' ? 'webm' : 'mp4');
	}

	// ── Opciones condicionales ───────────────────────────────────
	if (subtitles) args.push('--write-auto-subs', '--sub-langs', 'es,en', '--convert-subs', 'srt');
	if (thumbnail) args.push('--write-thumbnail');
	// ── Metadata — siempre activo ────────────────────────────────
	args.push('--add-metadata');

	args.push(url);

	const downloadId = Date.now().toString();
	let lastFilename = '';
	const proc = spawn(ytdlp, args);
	activeDownloads.set(downloadId, proc);

	proc.stdout.on('data', (data) => {
		for (const line of data.toString().split('\n')) {
			if (!line.trim()) continue;

			// Progreso porcentual
			const dlM = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+\/s)\s+ETA\s+(\S+)/);
			if (dlM) {
				mainWindow.webContents.send('download-progress', {
					id: downloadId,
					percent: parseFloat(dlM[1]),
					total: dlM[2],
					speed: dlM[3],
					eta: dlM[4],
				});
				continue;
			}

			// Archivo destino
			const destM = line.match(/\[download\] Destination: (.+)/);
			if (destM) lastFilename = path.basename(destM[1]);

			// Fusionando streams
			if (line.includes('[Merger]') || line.includes('Merging'))
				mainWindow.webContents.send('download-progress', {
					id: downloadId,
					percent: 99,
					speed: '—',
					eta: '—',
					status: 'Fusionando streams...',
				});

			// Progreso de playlist
			const plM = line.match(/\[download\] Downloading item (\d+) of (\d+)/);
			if (plM)
				mainWindow.webContents.send('download-progress', {
					id: downloadId,
					playlistCurrent: +plM[1],
					playlistTotal: +plM[2],
					status: `Playlist: video ${plM[1]} de ${plM[2]}`,
				});
		}
	});

	proc.stderr.on('data', (data) => {
		const l = data.toString();
		if (l.toLowerCase().includes('error')) mainWindow.webContents.send('download-error', { id: downloadId, message: l });
	});

	return new Promise((resolve, reject) => {
		proc.on('close', (code) => {
			activeDownloads.delete(downloadId);
			code === 0 ? resolve({ id: downloadId, filename: lastFilename, outputDir }) : reject(new Error(`Code ${code}`));
		});
		proc.on('error', (err) => {
			activeDownloads.delete(downloadId);
			reject(new Error(err.message));
		});
		mainWindow.webContents.send('download-started', { id: downloadId });
	});
});

// ─── cancel-download ──────────────────────────────────────────────────────────
ipcMain.on('cancel-download', (_, id) => {
	const p = activeDownloads.get(id);
	if (p) {
		p.kill();
		activeDownloads.delete(id);
	}
});

// ─── update-ytdlp ─────────────────────────────────────────────────────────────
ipcMain.handle(
	'update-ytdlp',
	() => new Promise((resolve, reject) => execFile(findBin('yt-dlp'), ['-U'], (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)))),
);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(s) {
	if (!s) return '?';
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
