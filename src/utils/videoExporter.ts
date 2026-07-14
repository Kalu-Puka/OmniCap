import { CaptionSegment, CaptionStyle, AspectRatio } from "../types";
import { drawCaptionsOnCanvas } from "./canvasRenderer";

interface ExportOptions {
  videoFile: File;
  segments: CaptionSegment[];
  style: CaptionStyle;
  aspectRatio: AspectRatio;
  cropMode: "crop" | "letterbox";
  showTranslation: boolean;
  isPro: boolean;
  onProgress: (progress: number) => void;
}

/**
 * Exports the captioned video fully in the browser.
 * Utilizes standard HTML5 Canvas rendering + MediaRecorder with Web Audio track mixing.
 * This is extremely reliable across all devices (Chrome, Safari, Firefox, Android, iOS).
 */
export async function exportVideoClientSide({
  videoFile,
  segments,
  style,
  aspectRatio,
  cropMode,
  showTranslation,
  isPro,
  onProgress,
}: ExportOptions): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // 1. Create temporary video element to play back the video
    const video = document.createElement("video");
    video.src = URL.createObjectURL(videoFile);
    video.muted = false;
    video.playsInline = true;

    // We keep a clean pointer to clean up object URLs
    const cleanup = () => {
      URL.revokeObjectURL(video.src);
      video.remove();
    };

    video.onloadedmetadata = () => {
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      const duration = video.duration;

      if (!duration || isNaN(duration)) {
        cleanup();
        reject(new Error("Unable to determine video duration."));
        return;
      }

      // Determine canvas dimensions based on chosen export ratio (target high definition, e.g. 720p height)
      let canvasWidth = 1280;
      let canvasHeight = 720;

      switch (aspectRatio) {
        case "9:16":
          canvasWidth = 405;
          canvasHeight = 720;
          break;
        case "1:1":
          canvasWidth = 720;
          canvasHeight = 720;
          break;
        case "4:5":
          canvasWidth = 576;
          canvasHeight = 720;
          break;
        case "16:9":
        default:
          canvasWidth = 1280;
          canvasHeight = 720;
          break;
      }

      // Create recording canvas
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        cleanup();
        reject(new Error("Unable to get 2D context from recording canvas."));
        return;
      }

      // 2. Set up Web Audio API to capture the audio from the video with zero microphone leakage
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      const source = audioCtx.createMediaElementSource(video);
      const audioDestination = audioCtx.createMediaStreamDestination();

      // Connect source to BOTH the audio recorder destination and the speaker (so user could hear or monitor, or keep muted)
      source.connect(audioDestination);
      
      // We also connect to hardware audio output so Web Audio stays active,
      // but we keep the video volume at 0.05 or let it play back.
      // To prevent duplicate echo we can connect a gain node or just destination.
      source.connect(audioCtx.destination);
      video.volume = 0.05; // Quiet monitoring during high-speed export

      // 3. Capture video and audio tracks
      const canvasStream = canvas.captureStream(30); // 30 FPS stream
      const videoTrack = canvasStream.getVideoTracks()[0];
      const audioTrack = audioDestination.stream.getAudioTracks()[0];

      if (!videoTrack) {
        cleanup();
        audioCtx.close();
        reject(new Error("Failed to capture video track from canvas."));
        return;
      }

      // Create combined stream containing our canvas frames and Web Audio track
      const combinedStream = new MediaStream([videoTrack]);
      if (audioTrack) {
        combinedStream.addTrack(audioTrack);
      }

      // 4. Set up MediaRecorder
      let mimeType = "video/webm;codecs=vp9";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "video/webm;codecs=vp8";
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "video/webm";
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "video/mp4"; // iOS Safari support
      }

      let options = { mimeType, videoBitsPerSecond: 2500000 }; // 2.5 Mbps high quality
      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(combinedStream, options);
      } catch (e) {
        console.warn("MediaRecorder with high quality options failed, using defaults:", e);
        mediaRecorder = new MediaRecorder(combinedStream);
      }

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        cleanup();
        audioCtx.close();
        const finalBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "video/mp4" });
        onProgress(100);
        resolve(finalBlob);
      };

      // 5. Start recording loop
      video.currentTime = 0;
      
      // We can accelerate the playback speed to export up to 2x faster than real-time!
      const exportSpeed = 2.0; 
      video.playbackRate = exportSpeed;

      let animationFrameId: number;

      const renderFrame = () => {
        // Calculate progress
        const progress = Math.min(99, Math.round((video.currentTime / duration) * 100));
        onProgress(progress);

        // Clear canvas with deep charcoal background
        ctx.fillStyle = "#121214";
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Draw video frame with selected crop/letterbox
        let drawWidth = canvasWidth;
        let drawHeight = canvasHeight;
        let dx = 0;
        let dy = 0;

        const canvasRatio = canvasWidth / canvasHeight;
        const videoRatio = sourceWidth / sourceHeight;

        if (cropMode === "crop") {
          // COVER/FILL: fill entire canvas, crop excess
          if (videoRatio > canvasRatio) {
            // Video is wider than canvas
            drawHeight = canvasHeight;
            drawWidth = canvasHeight * videoRatio;
            dx = (canvasWidth - drawWidth) / 2;
          } else {
            // Video is taller than canvas
            drawWidth = canvasWidth;
            drawHeight = canvasWidth / videoRatio;
            dy = (canvasHeight - drawHeight) / 2;
          }
        } else {
          // CONTAIN/LETTERBOX: fit whole video, keep aspect ratio, black bars
          if (videoRatio > canvasRatio) {
            // Video is wider
            drawWidth = canvasWidth;
            drawHeight = canvasWidth / videoRatio;
            dy = (canvasHeight - drawHeight) / 2;
          } else {
            // Video is taller
            drawHeight = canvasHeight;
            drawWidth = canvasHeight * videoRatio;
            dx = (canvasWidth - drawWidth) / 2;
          }
        }

        // Draw the frame onto our offscreen canvas
        try {
          ctx.drawImage(video, dx, dy, drawWidth, drawHeight);
        } catch (e) {
          // Sometimes video frame is not ready at the start, safe to ignore
        }

        // Draw subtitles on top
        drawCaptionsOnCanvas(
          ctx,
          canvasWidth,
          canvasHeight,
          video.currentTime,
          segments,
          style,
          showTranslation,
          isPro
        );

        if (!video.paused && !video.ended) {
          animationFrameId = requestAnimationFrame(renderFrame);
        }
      };

      // When play starts, start the MediaRecorder
      video.onplay = () => {
        mediaRecorder.start(100); // chunk every 100ms
        renderFrame();
      };

      video.onended = () => {
        cancelAnimationFrame(animationFrameId);
        mediaRecorder.stop();
      };

      video.onerror = (e) => {
        cancelAnimationFrame(animationFrameId);
        cleanup();
        audioCtx.close();
        reject(new Error("Error playing video during export."));
      };

      // Trigger playback
      video.play().catch((err) => {
        cleanup();
        audioCtx.close();
        reject(new Error(`Failed to initiate video playback for export: ${err.message}`));
      });
    };

    video.onerror = (e) => {
      cleanup();
      reject(new Error("Failed to load video metadata."));
    };
  });
}
