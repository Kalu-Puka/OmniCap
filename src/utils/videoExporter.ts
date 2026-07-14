import { CaptionSegment, CaptionStyle, AspectRatio } from "../types";
import { drawCaptionsOnCanvas } from "./canvasRenderer";

export type ExportResolution = "480p" | "720p" | "1080p" | "2K" | "4K";

interface ExportOptions {
  videoFile: File;
  segments: CaptionSegment[];
  style: CaptionStyle;
  aspectRatio: AspectRatio;
  cropMode: "crop" | "letterbox";
  showTranslation: boolean;
  isPro: boolean;
  resolution: ExportResolution;
  onProgress: (progress: number) => void;
}

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

export function getExportDimensions(
  resolution: ExportResolution,
  aspectRatio: AspectRatio
): { width: number; height: number } {
  let H = 720;
  switch (resolution) {
    case "480p":
      H = 480;
      break;
    case "720p":
      H = 720;
      break;
    case "1080p":
      H = 1080;
      break;
    case "2K":
      H = 1440;
      break;
    case "4K":
      H = 2160;
      break;
  }

  const makeEven = (x: number) => Math.round(x / 2) * 2;

  switch (aspectRatio) {
    case "9:16":
      return { width: makeEven(H * 9 / 16), height: H };
    case "1:1":
      return { width: H, height: H };
    case "4:5":
      return { width: makeEven(H * 4 / 5), height: H };
    case "16:9":
    default:
      return { width: makeEven(H * 16 / 9), height: H };
  }
}

export async function exportVideoClientSide({
  videoFile,
  segments,
  style,
  aspectRatio,
  cropMode,
  showTranslation,
  isPro,
  resolution,
  onProgress,
}: ExportOptions): Promise<Blob> {
  onProgress(2); // Initialization started

  // 1. Load FFmpeg.wasm
  const FFmpegLib = await loadFFmpegScript();
  const { createFFmpeg } = FFmpegLib;

  const ffmpeg = createFFmpeg({
    log: true,
    corePath: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js",
  });

  await ffmpeg.load();
  onProgress(5); // FFmpeg loaded

  // 2. Prepare video dimensions
  const video = document.createElement("video");
  video.src = URL.createObjectURL(videoFile);
  video.muted = true;
  video.playsInline = true;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      URL.revokeObjectURL(video.src);
      video.remove();
    };

    video.onloadedmetadata = async () => {
      try {
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        const duration = video.duration;

        if (!duration || isNaN(duration)) {
          cleanup();
          reject(new Error("Unable to determine video duration."));
          return;
        }

        const { width: canvasWidth, height: canvasHeight } = getExportDimensions(resolution, aspectRatio);
        const scaleFactor = canvasWidth / 640;

        // Create canvas
        const canvas = document.createElement("canvas");
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          cleanup();
          reject(new Error("Unable to get 2D context from recording canvas."));
          return;
        }

        // 3. Extract the audio track to bypass latency/pitch issues
        onProgress(8);
        const videoBuffer = await videoFile.arrayBuffer();
        ffmpeg.FS("writeFile", "input_video.mp4", new Uint8Array(videoBuffer));

        let hasAudio = false;
        try {
          console.log("[videoExporter] Attempting to extract audio track...");
          await ffmpeg.run("-i", "input_video.mp4", "-vn", "-c:a", "aac", "audio.aac");
          hasAudio = ffmpeg.FS("readdir", "/").includes("audio.aac");
        } catch (audioErr) {
          console.warn("[videoExporter] No audio track extracted, proceeding with video-only:", audioErr);
        }

        onProgress(12);

        // 4. Seek frame-by-frame at 30 FPS and write images to FFmpeg virtual FS
        const fps = 30;
        const totalFrames = Math.floor(duration * fps);
        const frameInterval = 1 / fps;

        let currentFrame = 0;

        const seekAndCapture = () => {
          return new Promise<void>((resolveSeek, rejectSeek) => {
            const onSeeked = () => {
              video.removeEventListener("seeked", onSeeked);

              // Draw canvas frame
              ctx.fillStyle = "#121214";
              ctx.fillRect(0, 0, canvasWidth, canvasHeight);

              let drawWidth = canvasWidth;
              let drawHeight = canvasHeight;
              let dx = 0;
              let dy = 0;

              const canvasRatio = canvasWidth / canvasHeight;
              const videoRatio = sourceWidth / sourceHeight;

              if (cropMode === "crop") {
                if (videoRatio > canvasRatio) {
                  drawHeight = canvasHeight;
                  drawWidth = canvasHeight * videoRatio;
                  dx = (canvasWidth - drawWidth) / 2;
                } else {
                  drawWidth = canvasWidth;
                  drawHeight = canvasWidth / videoRatio;
                  dy = (canvasHeight - drawHeight) / 2;
                }
              } else {
                if (videoRatio > canvasRatio) {
                  drawWidth = canvasWidth;
                  drawHeight = canvasWidth / videoRatio;
                  dy = (canvasHeight - drawHeight) / 2;
                } else {
                  drawHeight = canvasHeight;
                  drawWidth = canvasHeight * videoRatio;
                  dx = (canvasWidth - drawWidth) / 2;
                }
              }

              try {
                ctx.drawImage(video, dx, dy, drawWidth, drawHeight);
              } catch (e) {
                // Ignore missing frames
              }

              // Draw subtitles
              drawCaptionsOnCanvas(
                ctx,
                canvasWidth,
                canvasHeight,
                video.currentTime,
                segments,
                style,
                showTranslation,
                isPro,
                scaleFactor
              );

              // Convert canvas frame to jpeg
              const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
              const base64 = dataUrl.split(",")[1];
              const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

              const filename = `frame_${String(currentFrame).padStart(5, "0")}.jpg`;
              ffmpeg.FS("writeFile", filename, binary);

              // Progress mapping (from 12% to 85%)
              const frameProgress = Math.min(85, Math.round(12 + (currentFrame / totalFrames) * 73));
              onProgress(frameProgress);

              resolveSeek();
            };

            video.addEventListener("seeked", onSeeked);
            video.currentTime = currentFrame * frameInterval;
          });
        };

        while (currentFrame < totalFrames) {
          await seekAndCapture();
          currentFrame++;
        }

        onProgress(87);

        // 5. Run FFmpeg to assemble JPEGs and Audio into MP4
        console.log("[videoExporter] Compiling frames with FFmpeg...");

        const ffmpegArgs = [
          "-r", "30",
          "-i", "frame_%05d.jpg",
        ];

        if (hasAudio) {
          ffmpegArgs.push("-i", "audio.aac");
        }

        ffmpegArgs.push(
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-preset", "ultrafast",
        );

        if (hasAudio) {
          ffmpegArgs.push("-c:a", "aac", "-shortest");
        }

        ffmpegArgs.push("output.mp4");

        await ffmpeg.run(...ffmpegArgs);
        onProgress(97);

        // 6. Read and construct final MP4 Blob
        const outData = ffmpeg.FS("readFile", "output.mp4");
        const finalBlob = new Blob([outData.buffer], { type: "video/mp4" });

        // 7. Cleanup virtual FS files to keep memory footprint clean
        try {
          ffmpeg.FS("unlink", "input_video.mp4");
          if (hasAudio) {
            ffmpeg.FS("unlink", "audio.aac");
          }
          ffmpeg.FS("unlink", "output.mp4");

          for (let f = 0; f < currentFrame; f++) {
            const filename = `frame_${String(f).padStart(5, "0")}.jpg`;
            try {
              ffmpeg.FS("unlink", filename);
            } catch (e) {
              // file already unlinked/missing
            }
          }
        } catch (cleanErr) {
          console.warn("[videoExporter] Cleanup virtual FS files warning:", cleanErr);
        }

        cleanup();
        onProgress(100);
        resolve(finalBlob);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Failed to load video metadata for export."));
    };
  });
}
