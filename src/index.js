// ─── State ───────────────────────────────────────────────────────────────────
const S = {
	url: '',
	info: null,
	mode: 'single', // 'single' | 'playlist-select'
	type: 'video',
	quality: 'FHD',
	format: 'MP4',
	outputDir: vortex.defaultDownloadPath,
	selectedPl: new Set(),
	queue: [], // { id, title, status, percent, thumb, opts }
	history: [],
	currentDlId: null,
	tools: { ytdlp: null, ffmpeg: null },
};

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
	initDir();
	loadHistory();
	registerEvents();
	checkAndSetupTools();
});

function initDir() {
	document.getElementById('outDirIn').value = S.outputDir;
	document.getElementById('outDirDisp').textContent = S.outputDir;
}

// ─── Tool setup ───────────────────────────────────────────────────────────────
async function checkAndSetupTools() {
	setPill('ytdlp', 'loading', '⏳ yt-dlp');
	setPill('ffmpeg', 'loading', '⏳ ffmpeg');
	const { ytdlp, ffmpeg } = await vortex.checkTools();
	S.tools = { ytdlp: !!ytdlp, ffmpeg: !!ffmpeg };
	setPill('ytdlp', ytdlp ? 'ok' : 'err', ytdlp ? '✓ yt-dlp' : '✕ yt-dlp');
	setPill('ffmpeg', ffmpeg ? 'ok' : 'err', ffmpeg ? '✓ ffmpeg' : '✕ ffmpeg');
	document.getElementById('s-ytdlp').textContent = ytdlp || 'No encontrado';
	document.getElementById('s-ffmpeg').textContent = ffmpeg || 'No encontrado';
	const needWizard = !ytdlp || !ffmpeg;
	document.getElementById('setupWizard').style.display = needWizard ? '' : 'none';
	setWizardTool('ytdlp', ytdlp);
	setWizardTool('ffmpeg', ffmpeg);
}

function setWizardTool(tool, version) {
	const badge = document.getElementById(`wtb-${tool}`);
	const btn = document.getElementById(`wbtn-${tool}`);
	if (version) {
		badge.textContent = '✓ Instalado';
		badge.style.cssText = 'border:1px solid var(--green);color:var(--green);padding:2px 8px;border-radius:20px;font-size:9px';
		btn.textContent = 'Reinstalar';
		btn.disabled = false;
	} else {
		badge.textContent = '✕ No encontrado';
		badge.style.cssText = 'border:1px solid var(--red);color:var(--red);padding:2px 8px;border-radius:20px;font-size:9px';
		btn.textContent = 'Instalar';
		btn.disabled = false;
	}
}

function setPill(tool, cls, text) {
	const el = document.getElementById(`pill-${tool}`);
	el.className = `tool-pill ${cls}`;
	el.textContent = text;
}

export function handleToolClick(tool) {
	if (!S.tools[tool]) switchPanel('settings');
}

export async function installYtdlp() {
	document.getElementById('wbtn-ytdlp').disabled = true;
	try {
		await vortex.autoInstallYtdlp();
	} catch (e) {
		showToast('Error: ' + e.message, 'err');
	}
}

export async function installFfmpeg() {
	const b = document.getElementById('wbtn-ffmpeg');
	if (b) b.disabled = true;
	try {
		await vortex.autoInstallFfmpeg();
	} catch (e) {
		showToast('Error: ' + e.message, 'err');
	}
}

// ─── Panels ───────────────────────────────────────────────────────────────────
const PTITLES = {
	download: 'Desc<em>argar</em>',
	queue: 'C<em>ola</em>',
	history: 'His<em>torial</em>',
	settings: 'A<em>justes</em>',
};

export function switchPanel(id) {
	['download', 'queue', 'history', 'settings'].forEach((p) => {
		document.getElementById(`panel-${p}`).classList.toggle('active', p === id);
		document.getElementById(`nav-${p}`).classList.toggle('active', p === id);
	});
	document.getElementById('page-title').innerHTML = PTITLES[id];
}

// ─── URL / Mode ───────────────────────────────────────────────────────────────
export function setMode(el, mode) {
	el.closest('.mode-toggle')
		.querySelectorAll('.mtab')
		.forEach((b) => b.classList.remove('active'));
	el.classList.add('active');
	S.mode = mode;
}

export async function pasteUrl() {
	try {
		document.getElementById('urlInput').value = await navigator.clipboard.readText();
		analyzeUrl();
	} catch (_) {}
}

export async function analyzeUrl() {
	const url = document.getElementById('urlInput').value.trim();
	if (!url) {
		document.getElementById('urlInput').focus();
		return;
	}
	S.url = url;
	const btn = document.getElementById('btn-analyze');
	btn.disabled = true;
	btn.textContent = '… Analizando';
	hideAll();
	hideError();
	try {
		// "Playlist completa" eliminada — solo single y playlist-select
		const info = await vortex.fetchInfo({ url, isPlaylist: S.mode === 'playlist-select' });
		S.info = info;
		if (info.isPlaylist) {
			renderPlaylist(info);
			show('playlistCard');
			document.getElementById('plSelBar').style.display = 'flex';
			S.selectedPl = new Set(info.items.map((_, i) => i));
			renderPlaylistSelection();
		} else {
			renderPreview(info);
			show('previewCard');
		}
		show('formatCard');
		show('dlBar');
		updateDlBar();
		// Deshabilitar resoluciones no disponibles en este video
		if (!info.isPlaylist) applyRealFormats(info);
	} catch (err) {
		showError('Error al analizar: ' + err.message);
	} finally {
		btn.disabled = false;
		btn.textContent = '→ Analizar';
	}
}

// ─── Codecs reales ────────────────────────────────────────────────────────────
// Desactiva botones de resolución que el video realmente no tiene.
// Requiere que main.js incluya `maxHeight` en la respuesta de fetch-info.
function applyRealFormats(info) {
	if (S.type !== 'video') return;
	const max = info.maxHeight || 0;
	if (!max) return;

	const MAP = { '4K': 2160, FHD: 1080, HD: 720, SD: 480 };
	let bestAvailable = null;

	document
		.getElementById('qGrid')
		.querySelectorAll('.qb')
		.forEach((btn) => {
			const label = btn.querySelector('.ql')?.textContent;
			const needed = MAP[label];
			if (!needed) return;
			const available = needed <= max;
			btn.disabled = !available;
			btn.title = available ? '' : `No disponible (máx. ${max}p)`;
			if (available && !bestAvailable) bestAvailable = btn;
			// Si el activo quedó deshabilitado, quitarle el active
			if (!available && btn.classList.contains('active')) {
				btn.classList.remove('active');
			}
		});

	// Si ningún botón quedó activo, activar el mejor disponible
	const hasActive = !!document.getElementById('qGrid').querySelector('.qb.active');
	if (!hasActive && bestAvailable) {
		bestAvailable.classList.add('active');
		S.quality = bestAvailable.querySelector('.ql').textContent;
		updateDlBar();
	}
}

// ─── Preview ──────────────────────────────────────────────────────────────────
function renderPreview(info) {
	document.getElementById('prevTitle').textContent = info.title;
	document.getElementById('prevDur').textContent = info.duration || '--:--';
	document.getElementById('prevCh').textContent = info.channel || '—';
	document.getElementById('prevDate').textContent = fmtDate(info.uploadDate);
	document.getElementById('prevViews').textContent = fmtViews(info.views);
	document.getElementById('prevRes').textContent = info.width ? `${info.width}×${info.height}` : '';
	document.getElementById('prevDesc').textContent = info.description || '';
	const thumb = document.getElementById('prevThumb');
	const imgSrc = info.thumbnailHD || info.thumbnail || '';
	thumb.innerHTML = imgSrc
		? `<img src="${imgSrc}" alt="thumb"><div class="prev-duration">${info.duration || ''}</div><div class="thumb-overlay"><span class="thumb-overlay-icon">⊕</span></div>`
		: `<div class="thumb-placeholder">▶</div><div class="prev-duration">--:--</div>`;
}

export function openThumbModal() {
	if (!S.info || S.info.isPlaylist) return;
	const main = S.info.thumbnailHD || S.info.thumbnail || '';
	if (!main) return;
	document.getElementById('thumbModalImg').src = main;
	document.getElementById('thumbModal').style.display = 'flex';
	const strip = document.getElementById('thumbStrip');
	strip.innerHTML = (S.info.thumbnails || [])
		.slice(0, 6)
		.map((t, i) => `<div class="thumb-strip-item ${i === 0 ? 'active' : ''}" onclick="window._vortex.switchThumb(this,'${t.url}')">` + `<img src="${t.url}" alt=""></div>`)
		.join('');
}

export function switchThumb(el, url) {
	document.getElementById('thumbModalImg').src = url;
	document
		.getElementById('thumbStrip')
		.querySelectorAll('.thumb-strip-item')
		.forEach((e) => e.classList.remove('active'));
	el.classList.add('active');
}

export function closeThumbModal(e) {
	if (!e || e.target === document.getElementById('thumbModal') || e.type === 'click') document.getElementById('thumbModal').style.display = 'none';
}

document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') closeThumbModal();
});

// ─── Playlist ─────────────────────────────────────────────────────────────────
function renderPlaylist(info) {
	document.getElementById('plCount').textContent = `${info.count} videos`;
	document.getElementById('playlistList').innerHTML = info.items
		.map(
			(item, i) => `
      <div class="pl-item ${S.selectedPl.has(i) ? 'selected' : ''}" data-idx="${i}"
           onclick="window._vortex.togglePlItem(${i})">
        <div class="pl-check">${S.selectedPl.has(i) ? '✓' : ''}</div>
        <div class="pl-num">${item.index}</div>
        <div class="pl-thumb">${item.thumbnail ? `<img src="${item.thumbnail}" alt="">` : '▶'}</div>
        <div class="pl-info">
          <div class="pl-title">${item.title}</div>
          <div class="pl-dur">${item.duration || '—'}${item.channel ? ' · ' + item.channel : ''}</div>
        </div>
      </div>`,
		)
		.join('');
}

export function togglePlItem(idx) {
	if (S.selectedPl.has(idx)) S.selectedPl.delete(idx);
	else S.selectedPl.add(idx);
	renderPlaylistSelection();
	renderPlaylist(S.info);
}

function renderPlaylistSelection() {
	document.getElementById('plSelCount').textContent = `${S.selectedPl.size} seleccionados`;
}

export function selectAllPl() {
	S.info.items.forEach((_, i) => S.selectedPl.add(i));
	renderPlaylist(S.info);
	renderPlaylistSelection();
}

export function selectNonePl() {
	S.selectedPl.clear();
	renderPlaylist(S.info);
	renderPlaylistSelection();
}

// ─── Format ───────────────────────────────────────────────────────────────────
export function setType(el, type) {
	el.closest('.ftabs')
		.querySelectorAll('.ftab')
		.forEach((b) => b.classList.remove('active'));
	el.classList.add('active');
	S.type = type;
	const a = type === 'audio';

	document.getElementById('qLabel').textContent = a ? 'Calidad de audio' : 'Calidad de video';
	document.getElementById('qGrid').innerHTML = a
		? `<button class="qb active" onclick="window._vortex.setQ(this)"><span class="ql">320</span><span class="qs">kbps</span></button>
       <button class="qb" onclick="window._vortex.setQ(this)"><span class="ql">192</span><span class="qs">kbps</span></button>
       <button class="qb" onclick="window._vortex.setQ(this)"><span class="ql">128</span><span class="qs">kbps</span></button>
       <button class="qb" onclick="window._vortex.setQ(this)"><span class="ql">64</span><span class="qs">kbps</span></button>`
		: `<button class="qb" onclick="window._vortex.setQ(this)"><span class="ql">4K</span><span class="qs">2160p</span></button>
       <button class="qb active" onclick="window._vortex.setQ(this)"><span class="ql">FHD</span><span class="qs">1080p</span></button>
       <button class="qb" onclick="window._vortex.setQ(this)"><span class="ql">HD</span><span class="qs">720p</span></button>
       <button class="qb" onclick="window._vortex.setQ(this)"><span class="ql">SD</span><span class="qs">480p</span></button>`;

	document.getElementById('cGrid').innerHTML = a
		? `<button class="qb active" onclick="window._vortex.setCodec(this)"><span class="ql">MP3</span><span class="qs">MPEG</span></button>
       <button class="qb" onclick="window._vortex.setCodec(this)"><span class="ql">FLAC</span><span class="qs">Lossless</span></button>
       <button class="qb" onclick="window._vortex.setCodec(this)"><span class="ql">AAC</span><span class="qs">M4A</span></button>`
		: `<button class="qb active" onclick="window._vortex.setCodec(this)"><span class="ql">MP4</span><span class="qs">H.264</span></button>
       <button class="qb" onclick="window._vortex.setCodec(this)"><span class="ql">MKV</span><span class="qs">H.265</span></button>
       <button class="qb" onclick="window._vortex.setCodec(this)"><span class="ql">WEBM</span><span class="qs">VP9</span></button>`;

	setOptVisible('opt-subs', !a);
	setOptVisible('opt-thumb', !a);

	S.quality = a ? '320' : 'FHD';
	S.format = a ? 'MP3' : 'MP4';

	if (!a && S.info && !S.info.isPlaylist) applyRealFormats(S.info);
	updateDlBar();
}

function setOptVisible(id, visible) {
	const el = document.getElementById(id);
	if (!el) return;
	el.style.transition = 'opacity 0.2s, transform 0.2s';
	if (visible) {
		el.style.display = '';
		void el.offsetHeight;
		el.style.opacity = '1';
		el.style.transform = 'none';
		el.style.pointerEvents = '';
	} else {
		el.style.opacity = '0';
		el.style.transform = 'scale(0.95)';
		el.style.pointerEvents = 'none';
		setTimeout(() => {
			if (S.type === 'audio') el.style.display = 'none';
		}, 200);
	}
}

export function setQ(el) {
	if (el.disabled) return;
	el.closest('.qgrid')
		.querySelectorAll('.qb')
		.forEach((b) => b.classList.remove('active'));
	el.classList.add('active');
	S.quality = el.querySelector('.ql').textContent;
	updateDlBar();
}

export function setCodec(el) {
	el.closest('.qgrid')
		.querySelectorAll('.qb')
		.forEach((b) => b.classList.remove('active'));
	el.classList.add('active');
	S.format = el.querySelector('.ql').textContent;
	updateDlBar();
}

function updateDlBar() {
	if (!S.info) return;
	const ext = S.type === 'audio' ? (S.format === 'FLAC' ? 'flac' : S.format === 'AAC' ? 'm4a' : 'mp3') : S.format === 'MKV' ? 'mkv' : S.format === 'WEBM' ? 'webm' : 'mp4';
	const title = S.info.isPlaylist ? `[Playlist] ${S.info.count} videos` : S.info.title;
	document.getElementById('dlFname').textContent = title.slice(0, 55) + '.' + ext;
	document.getElementById('dlSize').textContent = S.info.isPlaylist ? `${S.info.count} videos · ${S.format} · ${S.quality}` : `${S.format} · ${S.quality}`;
}

// ─── Download ─────────────────────────────────────────────────────────────────
export async function startDownload() {
	if (!S.info) return;

	let playlistItems = null;
	if (S.info.isPlaylist) {
		if (S.selectedPl.size === 0) {
			showToast('Selecciona al menos un video', 'err');
			return;
		}
		playlistItems = [...S.selectedPl]
			.map((i) => i + 1)
			.sort((a, b) => a - b)
			.join(',');
	}

	const opts = buildDownloadOpts(playlistItems);
	const title = S.info.isPlaylist ? `Playlist · ${S.info.count} videos` : S.info.title;
	const thumb = !S.info.isPlaylist ? S.info.thumbnail : null;

	const qItem = addToQueue({ title, status: 'pending', percent: 0, thumb, opts });
	runQueueItem(qItem);
}

function buildDownloadOpts(playlistItems = null) {
	return {
		url: S.url,
		outputDir: S.outputDir,
		format: S.format,
		quality: S.quality,
		audioOnly: S.type === 'audio',
		subtitles: document.getElementById('opt-subs').classList.contains('on'),
		thumbnail: document.getElementById('opt-thumb').classList.contains('on'),
		notify: document.getElementById('opt-notify').classList.contains('on'),
		playlistItems,
	};
}

async function runQueueItem(qItem) {
	// Si ya hay una descarga activa, quedarse en cola
	if (S.queue.some((q) => q.status === 'active' && q.id !== qItem.id)) return;

	qItem.status = 'active';
	renderQueue();
	hide('dlBar');
	show('progCard');
	hideError();
	document.getElementById('progName').textContent = qItem.title.slice(0, 60);
	resetProgress();

	try {
		const result = await vortex.startDownload(qItem.opts);
		qItem.status = 'done';
		qItem.percent = 100;
		renderQueue();

		document.getElementById('pbf').style.width = '100%';
		document.getElementById('pbf').classList.remove('active');
		document.getElementById('spct').textContent = '✓ Completado';
		document.getElementById('spct').className = 'spct done';
		document.getElementById('sdot').className = 'sdot done';

		addHistory({
			title: qItem.title,
			meta: `${qItem.opts.format} · ${qItem.opts.quality}`,
			thumb: qItem.thumb,
			outputDir: result.outputDir,
			filename: result.filename,
		});

		if (qItem.opts.notify) showToast('✓ Descarga completada', 'ok');

		setTimeout(() => {
			hide('progCard');
			show('dlBar');
			// Encadenar el siguiente pendiente
			const next = S.queue.find((q) => q.status === 'pending');
			if (next) runQueueItem(next);
		}, 2500);
	} catch (err) {
		qItem.status = 'error';
		renderQueue();
		showError('Error: ' + err.message);
		hide('progCard');
		show('dlBar');
	}
}

export async function retryQueueItem(id) {
	const qItem = S.queue.find((q) => q.id === id);
	if (!qItem || qItem.status !== 'error') return;
	qItem.percent = 0;
	await runQueueItem(qItem);
}

function resetProgress() {
	document.getElementById('pbf').style.width = '0%';
	document.getElementById('pbf').classList.add('active');
	document.getElementById('spct').textContent = '0%';
	document.getElementById('spct').className = 'spct';
	document.getElementById('sdot').className = 'sdot';
	document.getElementById('dlSpeed').textContent = '—';
	document.getElementById('dlEta').textContent = '—';
	document.getElementById('dlDown').textContent = '—';
}

export function cancelDl() {
	if (S.currentDlId) {
		vortex.cancelDownload(S.currentDlId);
		S.currentDlId = null;
	}
	const active = S.queue.find((q) => q.status === 'active');
	if (active) {
		active.status = 'error';
		renderQueue();
	}
	hide('progCard');
	show('dlBar');
	showToast('Descarga cancelada', 'err');
}

// ─── Events ───────────────────────────────────────────────────────────────────
function registerEvents() {
	vortex.onInstallProgress(({ tool, status, percent, message }) => {
		const prog = document.getElementById(`wtp-${tool}`);
		const fill = document.getElementById(`wtf-${tool}`);
		const msg = document.getElementById(`wtm-${tool}`);
		const btn = document.getElementById(`wbtn-${tool}`);
		if (!prog) return;
		msg.textContent = message || '';
		if (status === 'downloading' || status === 'extracting') {
			prog.style.display = '';
			fill.style.width = (percent || 0) + '%';
			btn.disabled = true;
			btn.textContent = 'Instalando…';
		}
		if (status === 'fetching') {
			btn.disabled = true;
			btn.textContent = 'Consultando…';
		}
		if (status === 'done') {
			prog.style.display = 'none';
			btn.disabled = false;
			btn.textContent = 'Reinstalar';
			checkAndSetupTools();
			showToast(`✓ ${tool} instalado`, 'ok');
		}
		if (status === 'error') {
			prog.style.display = 'none';
			btn.disabled = false;
			btn.textContent = 'Reintentar';
			showToast(`Error: ${message}`, 'err');
		}
	});

	vortex.onDownloadStarted(({ id }) => {
		S.currentDlId = id;
	});

	vortex.onDownloadProgress(({ percent, total, speed, eta, status, playlistCurrent, playlistTotal }) => {
		const p = Math.min(Math.round(percent || 0), 99);
		document.getElementById('pbf').style.width = p + '%';
		document.getElementById('spct').textContent = status || p + '%';
		if (speed) document.getElementById('dlSpeed').textContent = speed;
		if (eta) document.getElementById('dlEta').textContent = eta;
		if (total) document.getElementById('dlDown').textContent = total;
		if (playlistCurrent && playlistTotal) document.getElementById('progName').textContent = `Video ${playlistCurrent} de ${playlistTotal}`;
		const q = S.queue.find((q) => q.status === 'active');
		if (q) {
			q.percent = p;
			renderQueue();
		}
	});

	vortex.onDownloadError(({ message }) => showError(message));
}

// ─── Queue ────────────────────────────────────────────────────────────────────
function addToQueue({ title, status, percent, thumb, opts }) {
	const item = { id: Date.now(), title, status, percent: percent || 0, thumb, opts };
	S.queue.push(item);
	renderQueue();
	return item;
}

function renderQueue() {
	const list = document.getElementById('queueList');
	list.innerHTML = S.queue.length
		? S.queue
				.map(
					(q) => `
          <div class="qi">
            <div class="qt">${q.thumb ? `<img src="${q.thumb}">` : '▶'}</div>
            <div class="qi-info">
              <div class="qi-title">${q.title}</div>
              <div class="qi-meta">${
					q.status === 'active' ? `${q.percent}% · descargando` : q.status === 'pending' ? 'En cola' : q.status === 'done' ? 'Completado' : 'Error'
				}</div>
            </div>
            <div class="qs-tag ${q.status === 'done' ? 'qs-done' : q.status === 'error' ? 'qs-err' : q.status === 'pending' ? 'qs-pend' : 'qs-act'}">
              ${
					q.status === 'done'
						? '✓ Listo'
						: q.status === 'error'
							? `<span onclick="window._vortex.retryQueueItem(${q.id})" style="cursor:pointer">↺ Reintentar</span>`
							: q.status === 'pending'
								? '⏳ Espera'
								: '↓ Activo'
				}
            </div>
          </div>`,
				)
				.join('')
		: `<div class="cx-empty">
             <div class="cx-empty-icon">◻</div>
             <div class="cx-empty-title">Sin descargas</div>
             <div class="cx-empty-text">Las descargas activas aparecerán aquí.</div>
           </div>`;

	const done = S.queue.filter((q) => q.status === 'done').length;
	const badge = document.getElementById('queue-badge');
	badge.textContent = S.queue.length;
	badge.style.display = S.queue.length ? '' : 'none';
	document.getElementById('dl-count').textContent = `${done} / ${S.queue.length}`;
	document.getElementById('queue-fill').style.width = S.queue.length ? (done / S.queue.length) * 100 + '%' : '0%';
}

// ─── History ──────────────────────────────────────────────────────────────────
function loadHistory() {
	try {
		S.history = JSON.parse(localStorage.getItem('vortex-history') || '[]');
	} catch (_) {}
	renderHistory();
}

function addHistory(item) {
	S.history.unshift(item);
	if (S.history.length > 60) S.history.pop();
	localStorage.setItem('vortex-history', JSON.stringify(S.history));
	renderHistory();
}

export function clearHistory() {
	S.history = [];
	localStorage.removeItem('vortex-history');
	renderHistory();
}

function renderHistory() {
	const list = document.getElementById('historyList');
	list.innerHTML = S.history.length
		? S.history
				.map(
					(h) => `
          <div class="qi">
            <div class="qt">${h.thumb ? `<img src="${h.thumb}">` : '▶'}</div>
            <div class="qi-info">
              <div class="qi-title">${h.title}</div>
              <div class="qi-meta">${h.meta}</div>
            </div>
          </div>`,
				)
				.join('')
		: `<div class="cx-empty">
             <div class="cx-empty-icon">◻</div>
             <div class="cx-empty-title">Sin historial</div>
             <div class="cx-empty-text">Las descargas completadas aparecerán aquí.</div>
           </div>`;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export async function chooseDir() {
	const f = await vortex.chooseFolder();
	if (f) {
		S.outputDir = f;
		document.getElementById('outDirIn').value = f;
		document.getElementById('outDirDisp').textContent = f;
	}
}

export async function doUpdateYtdlp(btn) {
	btn.disabled = true;
	btn.textContent = '↻ Actualizando…';
	try {
		await vortex.updateYtdlp();
		showToast('yt-dlp actualizado ✓', 'ok');
		checkAndSetupTools();
	} catch (e) {
		showToast('Error: ' + e.message, 'err');
	} finally {
		btn.disabled = false;
		btn.textContent = '↻ Actualizar';
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const show = (id) => (document.getElementById(id).style.display = '');
const hide = (id) => (document.getElementById(id).style.display = 'none');

function hideAll() {
	['previewCard', 'playlistCard', 'formatCard', 'dlBar', 'progCard'].forEach(hide);
}
function showError(m) {
	const b = document.getElementById('errBox');
	b.textContent = m;
	b.style.display = '';
}
function hideError() {
	hide('errBox');
}

function showToast(msg, type = '') {
	const t = document.createElement('div');
	t.className = 'toast ' + type;
	t.textContent = msg;
	document.getElementById('toast-root').appendChild(t);
	setTimeout(() => t.remove(), 4000);
}

function fmtDate(d) {
	if (!d) return '—';
	const s = String(d);
	return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : d;
}

function fmtViews(n) {
	if (!n) return '—';
	return n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n + ' vistas';
}

// ─── Global bridge ────────────────────────────────────────────────────────────
window._vortex = {
	handleToolClick,
	installYtdlp,
	installFfmpeg,
	switchPanel,
	setMode,
	pasteUrl,
	analyzeUrl,
	openThumbModal,
	switchThumb,
	closeThumbModal,
	togglePlItem,
	selectAllPl,
	selectNonePl,
	setType,
	setQ,
	setCodec,
	startDownload,
	cancelDl,
	retryQueueItem,
	clearHistory,
	chooseDir,
	doUpdateYtdlp,
};
