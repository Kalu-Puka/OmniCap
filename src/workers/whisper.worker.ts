import { pipeline, env } from "@huggingface/transformers";

// Disable local model loading and force downloading from Hugging Face hub
env.allowLocalModels = false;

let transcriber: any = null;
let currentModelId = "";

self.addEventListener("message", async (event: MessageEvent) => {
  const { command, modelId, audioData, options } = event.data;

  if (command === "load") {
    try {
      if (transcriber && currentModelId === modelId) {
        self.postMessage({ status: "ready", modelId });
        return;
      }

      self.postMessage({ status: "loading", progress: 0, message: "Initializing pipeline..." });

      const dtype = modelId.includes("q8") ? "q8" : "fp32";

      transcriber = await pipeline("automatic-speech-recognition", modelId, {
        dtype,
        progress_callback: (data: any) => {
          if (data.status === "progress") {
            self.postMessage({
              status: "loading",
              modelId,
              progress: Math.round(data.progress || 0),
              file: data.file,
              message: `Downloading ${data.file || "weights"}...`
            });
          }
        },
      });

      currentModelId = modelId;
      self.postMessage({ status: "ready", modelId });
    } catch (error: any) {
      console.error("Worker model load error:", error);
      self.postMessage({ status: "error", message: `Failed to load model: ${error.message || error}` });
    }
  }

  else if (command === "transcribe") {
    if (!transcriber) {
      self.postMessage({ status: "error", message: "Model is not loaded yet." });
      return;
    }

    try {
      const audio = new Float32Array(audioData);
      const sampleRate = 16000;
      const totalSamples = audio.length;
      const totalDuration = totalSamples / sampleRate;

      self.postMessage({ status: "transcribing", progress: 0, message: "Starting transcription..." });

      // Define chunks: 30s with 2s overlap
      const chunkDuration = 30; // seconds
      const overlapDuration = 2; // seconds
      const chunkSamples = chunkDuration * sampleRate;
      const stepSamples = (chunkDuration - overlapDuration) * sampleRate;

      const totalChunks = Math.max(1, Math.ceil((totalSamples - overlapDuration * sampleRate) / stepSamples));
      const rawSegments: any[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const startSample = i * stepSamples;
        const endSample = Math.min(startSample + chunkSamples, totalSamples);
        const offsetSec = startSample / sampleRate;

        self.postMessage({
          status: "transcribing",
          progress: Math.round((i / totalChunks) * 100),
          message: `Processing section ${i + 1} of ${totalChunks} (${Math.round((offsetSec / totalDuration) * 100)}%)...`
        });

        const audioSlice = audio.subarray(startSample, endSample);

        // Run Whisper model
        const result = await transcriber(audioSlice, {
          chunk_length_s: chunkDuration,
          language: "si",
          task: "transcribe",
          return_timestamps: true,
          ...options
        });

        // Transformers.js returns result.chunks or result.text
        const segments = result.chunks || [];

        for (const seg of segments) {
          if (!seg.timestamp) continue;
          
          // Absolute start/end times
          const absStart = seg.timestamp[0] + offsetSec;
          const absEnd = seg.timestamp[1] + offsetSec;
          const center = (absStart + absEnd) / 2;

          // Bucket-based filtering to eliminate duplicates in overlap region
          const minCenter = i * (chunkDuration - overlapDuration);
          const maxCenter = minCenter + (chunkDuration - overlapDuration);

          // For the last chunk, we accept everything beyond minCenter
          const isLastChunk = i === totalChunks - 1;

          if (center >= minCenter && (isLastChunk || center < maxCenter)) {
            rawSegments.push({
              text: seg.text.trim(),
              start: absStart,
              end: absEnd
            });
          }
        }
      }

      self.postMessage({ status: "transcribing", progress: 100, message: "Transcription finished!" });
      self.postMessage({ status: "completed", segments: rawSegments });
    } catch (error: any) {
      console.error("Worker transcription error:", error);
      self.postMessage({ status: "error", message: `Transcription failed: ${error.message || error}` });
    }
  }
});
