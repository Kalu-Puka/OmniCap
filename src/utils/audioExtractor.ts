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

  // Create standard AudioContext to decode audio data
  // Note: AudioContext can fail on certain old browsers or inside strict secure contexts,
  // but it is widely supported in modern browsers.
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Web Audio API (AudioContext) is not supported in this browser.");
  }

  const tempCtx = new AudioContextClass();
  let decodedBuffer: AudioBuffer;

  try {
    decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.error("Native decodeAudioData failed, trying fallback:", err);
    throw new Error(
      "Failed to decode video audio. Please ensure the video has a valid audio track or try converting it to a standard MP4."
    );
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
