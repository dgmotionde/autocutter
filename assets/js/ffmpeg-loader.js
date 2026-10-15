// ffmpeg-loader.js
// Dynamically load the UMD ffmpeg bundle and provide a createFFmpeg factory.
export async function loadScript(src, timeout = 15000){
  return new Promise((resolve, reject) => {
    if(document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Script load error: ' + src));
    document.head.appendChild(s);
    if(timeout) setTimeout(() => reject(new Error('Script load timeout: ' + src)), timeout);
  });
}

export async function ensureFFmpegGlobal(options = {}){
  const { primary = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.2/dist/ffmpeg.min.js', fallback = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.2/dist/ffmpeg.min.js' } = options;
  if(window.FFmpeg && typeof window.FFmpeg.createFFmpeg === 'function') return window.FFmpeg;

  try{
    await loadScript(primary);
  }catch(e){
    console.warn('Primary FFmpeg CDN failed, trying fallback', e);
    await loadScript(fallback);
  }

  if(!(window.FFmpeg && typeof window.FFmpeg.createFFmpeg === 'function')){
    throw new Error('FFmpeg global wurde nicht geladen. Prüfe die CDN-Script-Tags und die Browser-Console.');
  }
  return window.FFmpeg;
}

// Provide a helper to create and load ffmpeg instance
export async function createAndLoadFFmpeg({ corePath = 'https://unpkg.com/@ffmpeg/core@0.12.2/dist/ffmpeg-core.js', log = false, progressCb } = {}){
  const FFmpegAPI = await ensureFFmpegGlobal();
  const { createFFmpeg } = FFmpegAPI;
  const ffmpeg = createFFmpeg({ log, corePath });
  if(progressCb) ffmpeg.setProgress(progressCb);
  if(log) ffmpeg.setLogger(({ type, message }) => console.log('[ffmpeg]', type, message));
  await ffmpeg.load();
  return ffmpeg;
}
