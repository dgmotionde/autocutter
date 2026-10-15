// app.js - main application logic
import { createAndLoadFFmpeg } from './ffmpeg-loader.js';

const logEl = document.getElementById('log');
function log(msg){
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `\n[${time}] ${msg}`;
  logEl.scrollTop = logEl.scrollHeight;
}
function setStatus(text, progress){
  document.getElementById('status').textContent = `[Auto Cutter] ${text}`;
  if(typeof progress === 'number'){
    const value = Math.max(0, Math.min(100, Math.round(progress * 100)));
    document.getElementById('progressBar').style.width = `${value}%`;
  }
}
function humanSize(n){
  if(n < 1024) return n + ' B';
  if(n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

const inputVideos = document.getElementById('inputVideos');
const inputAudio = document.getElementById('inputAudio');
const inputLut = document.getElementById('inputLut');
const inputRef = document.getElementById('inputRef');

const btnPickVideos = document.getElementById('btnPickVideos');
const btnPickAudio = document.getElementById('btnPickAudio');
const btnPickLut = document.getElementById('btnPickLut');
const btnPickRef = document.getElementById('btnPickRef');

const videoCount = document.getElementById('videoCount');
const videoList = document.getElementById('videoList');
const audioName = document.getElementById('audioName');
const lutName = document.getElementById('lutName');
const refName = document.getElementById('refName');
const preview = document.getElementById('preview');
const previewInfo = document.getElementById('previewInfo');
const statSmall = document.getElementById('statSmall');
const btnGenerate = document.getElementById('btnGenerate');

let videos = [];
let audio = null;
let lut = null;
let refImage = null;
let ffmpeg = null;
let ffmpegLoaded = false;

function updateFileDisplays(){
  videoList.innerHTML = '';
  if(videos.length === 0){
    videoCount.textContent = 'Keine Videos ausgewählt';
  } else if(videos.length === 1){
    videoCount.textContent = videos[0].name;
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `<span>${videos[0].name}</span><span>${humanSize(videos[0].size)}</span>`;
    videoList.appendChild(item);
  } else {
    videoCount.textContent = `${videos.length} Videos ausgewählt`;
    videos.forEach(f => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `<span>${f.name}</span><span>${humanSize(f.size)}</span>`;
      videoList.appendChild(item);
    });
  }
  audioName.textContent = audio ? audio.name : 'Keine Audio-Datei';
  lutName.textContent = lut ? lut.name : 'Keine LUT';
  refName.textContent = refImage ? refImage.name : 'Kein Referenzbild';
  statSmall.textContent = `Videos: ${videos.length} · Audio: ${audio ? 'ja' : 'aus'} · LUT: ${lut ? 'ja' : 'aus'} · Referenz: ${refImage ? 'ja' : 'aus'}`;
}

btnPickVideos.addEventListener('click', () => inputVideos.click());
btnPickAudio.addEventListener('click', () => inputAudio.click());
btnPickLut.addEventListener('click', () => inputLut.click());
btnPickRef.addEventListener('click', () => inputRef.click());

function bindDrop(dropId, handler){
  const el = document.getElementById(dropId);
  ['dragenter', 'dragover'].forEach(ev => el.addEventListener(ev, e => {
    e.preventDefault();
    el.classList.add('active');
  }));
  ['dragleave', 'drop'].forEach(ev => el.addEventListener(ev, e => {
    e.preventDefault();
    el.classList.remove('active');
  }));
  el.addEventListener('drop', e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : []);
    handler(files);
  });
}

inputVideos.addEventListener('change', e => {
  videos = Array.from(e.target.files || []);
  updateFileDisplays();
  e.target.value = '';
});
inputAudio.addEventListener('change', e => {
  audio = e.target.files[0] || null;
  updateFileDisplays();
  e.target.value = '';
});
inputLut.addEventListener('change', e => {
  lut = e.target.files[0] || null;
  updateFileDisplays();
  e.target.value = '';
});
inputRef.addEventListener('change', e => {
  refImage = e.target.files[0] || null;
  updateFileDisplays();
  e.target.value = '';
});

bindDrop('videoDrop', files => {
  const accepted = files.filter(file => file.type.startsWith('video') || /\.(mp4|mov)$/i.test(file.name));
  if(accepted.length) videos = accepted;
  updateFileDisplays();
});
bindDrop('audioDrop', files => {
  const selected = files.find(file => file.type.startsWith('audio') || /\.(mp3|wav)$/i.test(file.name));
  if(selected) audio = selected;
  updateFileDisplays();
});
bindDrop('lutDrop', files => {
  const selected = files.find(file => /\.cube$/i.test(file.name));
  if(selected) lut = selected;
  updateFileDisplays();
});
bindDrop('refDrop', files => {
  const selected = files.find(file => file.type.startsWith('image') || /\.(jpe?g|png)$/i.test(file.name));
  if(selected) refImage = selected;
  updateFileDisplays();
});

async function fileToUint8Array(file){
  const ab = await file.arrayBuffer();
  return new Uint8Array(ab);
}
function extOf(name){
  const match = name.match(/(\.[a-z0-9]+)$/i);
  return match ? match[1] : '';
}

async function analyzeAudioForBeats(file){
  try{
    setStatus('Analysiere Audio auf Bass-Peaks...', 0.09);
    log('Starte Audioanalyse...');

    const buffer = await file.arrayBuffer();
    const audioCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100 * 60, 44100);
    const decoded = await audioCtx.decodeAudioData(buffer.slice(0));
    const offlineCtx = new OfflineAudioContext(1, decoded.length, decoded.sampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = decoded;

    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;

    const analyser = offlineCtx.createAnalyser();
    analyser.fftSize = 2048;

    src.connect(filter);
    filter.connect(analyser);
    analyser.connect(offlineCtx.destination);
    src.start(0);

    const rendered = await offlineCtx.startRendering();
    const data = rendered.getChannelData(0);
    const sampleRate = rendered.sampleRate;
    const windowSize = Math.floor(sampleRate * 0.05);
    const energies = [];

    for(let i = 0; i < data.length; i += windowSize){
      let sum = 0;
      for(let j = 0; j < windowSize && i + j < data.length; j++){
        sum += data[i + j] * data[i + j];
      }
      energies.push(Math.sqrt(sum / Math.max(1, windowSize)));
    }

    const mean = energies.reduce((a, b) => a + b, 0) / Math.max(1, energies.length);
    const threshold = Math.max(mean * 2.4, 0.01);
    const peaks = [];

    for(let i = 2; i < energies.length - 2; i++){
      if(energies[i] > energies[i - 1] && energies[i] > energies[i + 1] && energies[i] > threshold){
        peaks.push((i * windowSize) / sampleRate);
      }
    }

    const unique = [];
    for(const p of peaks){
      if(!unique.length || p - unique[unique.length - 1] > 0.6) unique.push(p);
    }

    setStatus(`Audio analysiert — ${unique.length} Peaks gefunden`, 0.12);
    log(`Audioanalyse: ${unique.length} Peaks`);
    return unique;
  }catch(e){
    log('Audioanalyse fehlgeschlagen: ' + (e && e.message ? e.message : String(e)));
    setStatus('Audioanalyse fehlgeschlagen, verwende Defaults', 0.03);
    return [];
  }
}

async function computeImageStats(file){
  if(!file) return null;
  try{
    setStatus('Analysiere Referenzbild...', 0.02);
    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image load failed'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;

    for(let i = 0; i < data.length; i += 4){
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
      count++;
    }

    URL.revokeObjectURL(url);
    return { meanR: rSum / count, meanG: gSum / count, meanB: bSum / count };
  }catch(e){
    log('Referenzbild-Analyse fehlgeschlagen: ' + (e && e.message ? e.message : String(e)));
    return null;
  }
}

function computeEqParams(srcStats, refStats){
  if(!srcStats || !refStats) return { contrast: 1.12, brightness: 0.03, gamma: 0.95, saturation: 1.08 };
  const sLum = 0.2126 * srcStats.meanR + 0.7152 * srcStats.meanG + 0.0722 * srcStats.meanB;
  const rLum = 0.2126 * refStats.meanR + 0.7152 * refStats.meanG + 0.0722 * refStats.meanB;
  const brightness = ((rLum - sLum) / 255) * 1.1;
  const contrast = Math.max(0.85, Math.min(1.6, 1 + ((refStats.meanR - srcStats.meanR) / 255)));
  const gamma = Math.max(0.85, Math.min(1.25, 1 / contrast));
  const saturation = 1.0;
  return { contrast, brightness, gamma, saturation };
}

async function initFFmpeg(){
  if(ffmpegLoaded) return;
  setStatus('Lade FFmpeg.wasm in den Browser (kann einige Sekunden dauern)...', 0.02);
  try{
    ffmpeg = await createAndLoadFFmpeg({ log: true, progressCb: ({ ratio }) => {
      setStatus('FFmpeg arbeitet...', 0.1 + Math.max(0, Math.min(1, ratio)) * 0.6);
    }});
    ffmpeg.setLogger(({ type, message }) => {
      if(message && message.toLowerCase().includes('duration:')) {
        setStatus('Verarbeite Video (probe) ...', null);
      }
      log(`[ffmpeg ${type}] ${message}`);
    });
    ffmpegLoaded = true;
    setStatus('FFmpeg geladen', 0.08);
    log('FFmpeg.wasm geladen.');
  }catch(e){
    log('FFmpeg init fehlgeschlagen: ' + (e && e.message ? e.message : String(e)));
    throw e;
  }
}

btnGenerate.addEventListener('click', async () => {
  try{
    if(!videos.length){
      alert('Bitte mindestens ein Video auswählen.');
      return;
    }

    if(!audio && !confirm('Keine Musik ausgewählt. Weiter ohne Musik?')){
      return;
    }

    await initFFmpeg();
    setStatus('Vorbereiten: Dateien werden geladen...', 0.06);
    log('Schreibe Eingabedateien in den Speicher von FFmpeg.wasm...');

    for(let i = 0; i < videos.length; i++){
      const file = videos[i];
      const name = `vid${i}${extOf(file.name) || '.mp4'}`;
      ffmpeg.FS('writeFile', name, await fileToUint8Array(file));
      log(`geschrieben: ${name} (${humanSize(file.size)})`);
    }

    if(audio){
      const name = 'music' + (extOf(audio.name) || '.mp3');
      ffmpeg.FS('writeFile', name, await fileToUint8Array(audio));
      log(`geschrieben: ${name}`);
    }

    if(lut){
      ffmpeg.FS('writeFile', 'input_lut.cube', await fileToUint8Array(lut));
      log('geschrieben: input_lut.cube');
    }

    if(refImage){
      ffmpeg.FS('writeFile', 'ref_image' + extOf(refImage.name), await fileToUint8Array(refImage));
      log('geschrieben: Referenzbild');
    }

    const beats = audio ? await analyzeAudioForBeats(audio) : [];
    if(beats.length === 0){
      const fallback = [];
      for(let i = 1; i <= 20; i++) fallback.push(i * 2);
      beats.push(...fallback);
      log('Fallback-Beats verwendet (kein erkennbarer Bass).');
      setStatus('Keine starken Bass-Peaks gefunden — verwende Default-Rhythmus', 0.12);
    }

    let eqParams = { contrast: 1.12, brightness: 0.03, gamma: 0.95, saturation: 1.0 };
    if(refImage){
      setStatus('Analysiere Referenzbild für Color Match...', 0.12);
      const refStats = await computeImageStats(refImage);
      eqParams = computeEqParams({ meanR: 120, meanG: 110, meanB: 100 }, refStats || null);
      log('Color Match-Parameter berechnet.');
    }

    setStatus('Erstelle Farbkorrektur + concat...', 0.14);

    const filterParts = [];
    const inArgs = [];
    for(let i = 0; i < videos.length; i++){
      const name = `vid${i}${extOf(videos[i].name) || '.mp4'}`;
      inArgs.push('-i', name);
      let part = `[${i}:v]`;
      if(lut) part += 'lut3d=input_lut.cube,';
      part += `eq=contrast=${eqParams.contrast.toFixed(3)}:brightness=${eqParams.brightness.toFixed(3)}:gamma=${eqParams.gamma.toFixed(3)}:saturation=${eqParams.saturation.toFixed(3)}[v${i}]`;
      filterParts.push(part);
    }

    const concatInputs = videos.map((_, i) => `[v${i}]`).join('');
    const concatFilter = `${filterParts.join(';')};${concatInputs}concat=n=${videos.length}:v=1:a=0[outv]`;

    setStatus('Rendere farbkorrigiertes Video (dies kann lange dauern)...', 0.16);
    log('Starte erstes Rendering (Color Grade + Concat)...');
    await ffmpeg.run(...inArgs, '-filter_complex', concatFilter, '-map', '[outv]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', 'concat_processed.mp4');
    setStatus('Farbkorrektur & Zusammenfügung abgeschlossen', 0.45);
    log('concat_processed.mp4 erstellt.');

    const procData = ffmpeg.FS('readFile', 'concat_processed.mp4');
    const procBlob = new Blob([procData], { type: 'video/mp4' });
    const procUrl = URL.createObjectURL(procBlob);
    const tmpVid = document.createElement('video');
    tmpVid.preload = 'metadata';
    tmpVid.src = procUrl;
    await new Promise(resolve => {
      tmpVid.onloadedmetadata = resolve;
      tmpVid.onerror = resolve;
    });
    const totalDuration = Number.isFinite(tmpVid.duration) ? tmpVid.duration : (beats[beats.length - 1] || 0) + 4;
    URL.revokeObjectURL(procUrl);
    log(`Dauer concatenated video: ${totalDuration.toFixed(2)}s`);

    setStatus('Erstelle Speed Ramps basierend auf Beats...', 0.48);

    const segs = [];
    let cursor = 0;
    for(let i = 0; i < beats.length; i++){
      const beat = beats[i];
      if(beat < 0.2 || beat > totalDuration - 0.2) continue;
      const rampLen = Math.min(0.25, beat - cursor);
      const rampStart = Math.max(cursor, beat - rampLen);
      const slowEnd = Math.min(totalDuration, beat + 0.8);
      if(rampStart > cursor) segs.push({ start: cursor, end: rampStart, mode: 'normal' });
      segs.push({ start: rampStart, end: beat, mode: 'ramp' });
      segs.push({ start: beat, end: slowEnd, mode: 'slow' });
      cursor = slowEnd;
      if(cursor >= totalDuration) break;
    }
    if(cursor < totalDuration) segs.push({ start: cursor, end: totalDuration, mode: 'normal' });

    if(!segs.length){
      segs.push({ start: 0, end: totalDuration, mode: 'normal' });
    }

    const segFilters = [];
    const segLabels = [];
    for(let i = 0; i < segs.length; i++){
      const s = segs[i];
      const label = `s${i}`;
      let expr = `trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS-STARTPTS`;
      if(s.mode === 'ramp') expr = `trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS/3`;
      if(s.mode === 'slow') expr = `trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS/0.5`;
      segFilters.push(`[0:v]${expr}[${label}]`);
      segLabels.push(`[${label}]`);
    }
    const concatSeg = `${segFilters.join(';')};${segLabels.join('')}concat=n=${segLabels.length}:v=1:a=0[finalv]`;

    setStatus('Rendere finalen Schnitt mit Speed Ramps...', 0.6);
    log('Starte Rendering mit Speed-Ramps ...');
    ffmpeg.FS('writeFile', 'concat_processed.mp4', procData);
    await ffmpeg.run('-i', 'concat_processed.mp4', '-filter_complex', concatSeg, '-map', '[finalv]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', 'ramped.mp4');
    setStatus('Speed Ramps gerendert', 0.85);
    log('ramped.mp4 erstellt.');

    setStatus('Füge Musikspur hinzu und exportiere...', 0.88);
    if(audio){
      const musicName = 'music' + extOf(audio.name);
      await ffmpeg.run('-i', 'ramped.mp4', '-i', musicName, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', 'final_autocut.mp4');
    } else {
      await ffmpeg.run('-i', 'ramped.mp4', '-c', 'copy', 'final_autocut.mp4');
    }

    const out = ffmpeg.FS('readFile', 'final_autocut.mp4');
    const outBlob = new Blob([out], { type: 'video/mp4' });
    const outUrl = URL.createObjectURL(outBlob);
    preview.src = outUrl;
    previewInfo.textContent = `Export fertig • ${(outBlob.size / (1024 * 1024)).toFixed(1)} MB`;
    setStatus('Fertig! Download startet...', 1.0);
    log('final_autocut.mp4 fertiggestellt.');

    const a = document.createElement('a');
    a.href = outUrl;
    a.download = `auto-cutter-${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try{ a.remove(); } catch(e){} }, 4000);
  }catch(err){
    console.error(err);
    log('Fehler: ' + (err && err.message ? err.message : String(err)));
    setStatus('Fehler im Renderprozess — siehe Log', 0);
    alert('Fehler beim Generieren. Bitte prüfe die Konsole und das Log.');
  }
});

updateFileDisplays();
setStatus('Bereit', 0);
log('Auto Cutter bereit. Wähle Medien aus, dann drücke "Video mit Auto Cutter generieren".');
