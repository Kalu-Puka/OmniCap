/**
 * Dynamic script loader to fetch FFmpeg.wasm on-demand (only in failure case)
 */
function loadFFmpegScript(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).FFmpeg) {
      resolve((window as any).FFmpeg);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.0/dist/ffmpeg.min.js";
    script.onload = () => {
      resolve((window as any).FFmpeg);
    };
    script.onerror = (err) => {
      reject(new Error("Failed to load FFmpeg.wasm from CDN."));
    };
    document.head.appendChild(script);
  });
}

/**
 * Extracts and resamples audio from a video file entirely in the browser.
 * Resamples to 16000Hz mono Float32Array (Whisper's required input format).
 */
export async function extractAudioFromVideo(
  videoFile: File,
  onProgress: (progress: number) => void
): Promise<Float32Array> {
  onProgress(10); // Started reading file

  // Read video file as ArrayBuffer
  const arrayBuffer = await videoFile.arrayBuffer();
  onProgress(30); // File read into memory, starting native decode

  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Web Audio API (AudioContext) is not supported in this browser.");
  }

  const tempCtx = new AudioContextClass();
  let decodedBuffer: AudioBuffer;

  try {
    decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.warn("Native decodeAudioData failed, trying ffmpeg.wasm fallback...", err);
    try {
      onProgress(40); // Loading FFmpeg script
      const FFmpegLib = await loadFFmpegScript();
      const { createFFmpeg, fetchFile } = FFmpegLib;
      
      const ffmpeg = createFFmpeg({
        log: true,
        corePath: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js"
      });
      
      await ffmpeg.load();
      onProgress(45); // Transcoding file
      
      // Write the video binary to virtual filesystem
      ffmpeg.FS("writeFile", "input_video", new Uint8Array(arrayBuffer));
      
      // Run transcoding to extract audio to wav format (mono, 16kHz)
      await ffmpeg.run(
        "-i", "input_video",
        "-vn",                 // Disable video
        "-acodec", "pcm_s16le", // 16-bit signed little endian
        "-ar", "16000",        // 16kHz
        "-ac", "1",            // 1 mono channel
        "output.wav"
      );
      
      onProgress(55); // Reading transcoded output
      const transcodedData = ffmpeg.FS("readFile", "output.wav");
      
      // Cleanup virtual filesystem
      try {
        ffmpeg.FS("unlink", "input_video");
        ffmpeg.FS("unlink", "output.wav");
      } catch (cleanErr) {
        console.warn("FFmpeg virtual FS cleanup warning:", cleanErr);
      }
      
      // Decode the transcoded WAV data using AudioContext
      decodedBuffer = await tempCtx.decodeAudioData(transcodedData.buffer);
      console.log("Successfully decoded audio via ffmpeg.wasm fallback!");
    } catch (fallbackErr: any) {
      console.error("FFmpeg fallback failed:", fallbackErr);
      throw new Error(
        "Failed to decode video audio natively, and transcoding fallback failed. " +
        "Please ensure the video has a valid audio track or try converting it to a standard format."
      );
    }
  } finally {
    await tempCtx.close();
  }

  onProgress(60); // Audio decoded, now resampling to 16kHz mono

  const duration = decodedBuffer.duration;
  const targetSampleRate = 16000;
  const targetLength = Math.round(duration * targetSampleRate);

  // Use OfflineAudioContext for extremely fast asynchronous resampling in a background thread
  const OfflineAudioContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!OfflineAudioContextClass) {
    throw new Error("OfflineAudioContext is not supported. Unable to resample audio.");
  }

  const offlineCtx = new OfflineAudioContextClass(1, targetLength, targetSampleRate);

  // Create a buffer source node
  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = decodedBuffer;

  // Connect buffer source to the offline context destination
  bufferSource.connect(offlineCtx.destination);
  bufferSource.start(0);

  // Render the audio
  const renderedBuffer = await offlineCtx.startRendering();
  onProgress(90); // Audio resampling completed

  // Extract mono channel data
  const float32Data = renderedBuffer.getChannelData(0);
  onProgress(100); // Fully extracted

  return float32Data;
}
