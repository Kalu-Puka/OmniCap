import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Upload,
  Video,
  Type,
  Sliders,
  Download,
  Check,
  Plus,
  Trash2,
  Split,
  Combine,
  Play,
  Pause,
  Globe,
  Sparkles,
  Smile,
  Volume2,
  VolumeX,
  Award,
  RefreshCw,
  FolderOpen
} from "lucide-react";
import { get, set } from "idb-keyval";

import { CaptionSegment, CaptionStyle, AspectRatio, ModelSizeOption } from "./types";
import { extractAudioFromArrayBuffer } from "./utils/audioExtractor";
import {
  generateWordTimings,
  exportToSRT,
  exportToVTT,
  exportToTXT,
  exportToJSON,
  suggestEmojisForText
} from "./utils/captionUtils";
import { drawCaptionsOnCanvas } from "./utils/canvasRenderer";
import { exportVideoClientSide } from "./utils/videoExporter";
import { BUNDLED_FONTS, BUNDLED_FONTS_GROUPED, DEFAULT_STYLE, STYLE_PRESETS } from "./utils/presets";

export default function App() {
  // App Steps: 'upload' | 'extracting' | 'transcribing' | 'editor' | 'exporting'
  const [step, setStep] = useState<"upload" | "extracting" | "transcribing" | "editor" | "exporting">("upload");

  // Core Data State
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoBytes, setVideoBytes] = useState<ArrayBuffer | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoWidth, setVideoWidth] = useState<number>(640);
  const [videoHeight, setVideoHeight] = useState<number>(360);
  const [segments, setSegments] = useState<CaptionSegment[]>([]);

  // Transcription States
  const [extractedAudio, setExtractedAudio] = useState<Float32Array | null>(null);
  const [extractionProgress, setExtractionProgress] = useState<number>(0);
  const [loadingStatus, setLoadingStatus] = useState<{ progress: number; message: string }>({ progress: 0, message: "" });
  const [transcriptionStatus, setTranscriptionStatus] = useState<{ progress: number; message: string }>({ progress: 0, message: "" });
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Styling and Format Settings
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_STYLE);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [cropMode, setCropMode] = useState<"crop" | "letterbox">("crop");
  const [showTranslation, setShowTranslation] = useState<boolean>(false);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);

  // Monetization Scaffold
  const [isPro, setIsPro] = useState<boolean>(false);

  // BYO Gemini API Key
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => localStorage.getItem("omnicap_gemini_api_key") || "");

  const handleApiKeyChange = (val: string) => {
    setGeminiApiKey(val);
    localStorage.setItem("omnicap_gemini_api_key", val);
  };

  // Live Canvas Player Sync
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [playbackProgress, setPlaybackProgress] = useState<number>(0);
  
  // Export Progress
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportedBlob, setExportedBlob] = useState<Blob | null>(null);
  const [exportedUrl, setExportedUrl] = useState<string>("");

  // UI Panels
  const [activeTab, setActiveTab] = useState<"editor" | "style" | "presets" | "download">("editor");

  // DOM / Audio element references
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // 1. Load preferences from IndexedDB on startup
  useEffect(() => {
    async function loadSavedState() {
      const savedStyle = await get<CaptionStyle>("omnicap_style");
      if (savedStyle) setStyle(savedStyle);

      const savedPro = await get<boolean>("omnicap_is_pro");
      if (savedPro !== undefined) setIsPro(savedPro);

      const savedRatio = await get<AspectRatio>("omnicap_ratio");
      if (savedRatio) setAspectRatio(savedRatio);

      const savedCrop = await get<"crop" | "letterbox">("omnicap_crop");
      if (savedCrop) setCropMode(savedCrop);
    }
    loadSavedState().catch(console.error);
  }, []);

  // Save styles to DB upon edits
  const updateStyle = (newStyle: Partial<CaptionStyle>) => {
    const updated = { ...style, ...newStyle };
    setStyle(updated);
    set("omnicap_style", updated).catch(console.error);
  };

  const handleProToggle = (val: boolean) => {
    setIsPro(val);
    set("omnicap_is_pro", val).catch(console.error);
  };

  const handleRatioChange = (val: AspectRatio) => {
    setAspectRatio(val);
    set("omnicap_ratio", val).catch(console.error);
  };

  const handleCropChange = (val: "crop" | "letterbox") => {
    setCropMode(val);
    set("omnicap_crop", val).catch(console.error);
  };

  // WAV Encoder helpers for Gemini cloud transcription
  const encodeWAV = (samples: Float32Array, sampleRate = 16000): Blob => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (v: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        v.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    const floatTo16BitPCM = (output: DataView, offset: number, input: Float32Array) => {
      for (let i = 0; i < input.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
    };

    /* RIFF identifier */
    writeString(view, 0, "RIFF");
    /* file length */
    view.setUint32(4, 36 + samples.length * 2, true);
    /* RIFF type */
    writeString(view, 8, "WAVE");
    /* format chunk identifier */
    writeString(view, 12, "fmt ");
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, 1, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * 2, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, 2, true);
    /* bits per sample */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    writeString(view, 36, "data");
    /* data chunk length */
    view.setUint32(40, samples.length * 2, true);

    floatTo16BitPCM(view, 44, samples);

    return new Blob([view], { type: "audio/wav" });
  };

  // 3. Audio Extraction and Cloud Chunked Transcription Sequence
  const handleStartCaptioning = async () => {
    if (!videoBytes || !videoFile) return;
    setErrorMsg("");

    let rawAudio = extractedAudio;
    if (!rawAudio) {
      setStep("extracting");
      try {
        // Step A: Extract audio track to Float32Array at 16kHz mono natively in browser
        rawAudio = await extractAudioFromArrayBuffer(videoBytes, (p) => {
          setExtractionProgress(p);
        });
        setExtractedAudio(rawAudio);
      } catch (err: any) {
        console.error(err);
        setErrorMsg(err.message || "Failed to extract video audio.");
        setStep("upload");
        return;
      }
    }

    setStep("transcribing");
    setTranscriptionStatus({ progress: 10, message: "Preparing audio segments for Gemini..." });

    try {
      const SAMPLE_RATE = 16000;
      const CHUNK_DURATION_SEC = 240; // 4 minutes
      const OVERLAP_SEC = 2; // 2 seconds overlap

      const CHUNK_SIZE = CHUNK_DURATION_SEC * SAMPLE_RATE;
      const OVERLAP_SIZE = OVERLAP_SEC * SAMPLE_RATE;
      const STEP_SIZE = CHUNK_SIZE - OVERLAP_SIZE;

      const chunks = [];
      let startSample = 0;
      while (startSample < rawAudio.length) {
        const endSample = Math.min(startSample + CHUNK_SIZE, rawAudio.length);
        const chunkAudio = rawAudio.subarray(startSample, endSample);
        const startSec = startSample / SAMPLE_RATE;
        const isLast = endSample === rawAudio.length;
        chunks.push({
          audio: chunkAudio,
          startSec,
          isLast,
        });
        if (endSample === rawAudio.length) {
          break;
        }
        startSample += STEP_SIZE;
      }

      const allSegments: CaptionSegment[] = [];
      let segmentCounter = 0;

      const readBlobAsBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(",")[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      };

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const { audio: chunkAudio, startSec, isLast } = chunk;

        const progressPct = Math.round(15 + (i / chunks.length) * 75);
        setTranscriptionStatus({
          progress: progressPct,
          message: `Transcribing audio segment ${i + 1} of ${chunks.length} via Gemini AI...`
        });

        // Encode Float32Array to standard WAV format
        const wavBlob = encodeWAV(chunkAudio, SAMPLE_RATE);
        const base64Data = await readBlobAsBase64(wavBlob);

        const response = await fetch("/api/transcribe-cloud", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audio: base64Data,
            mimeType: "audio/wav",
            userApiKey: geminiApiKey || undefined,
          }),
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        if (!data.segments || !Array.isArray(data.segments)) {
          throw new Error(`Invalid response format for segment ${i + 1}.`);
        }

        const filteredSegments = data.segments.filter((seg: any) => {
          const relStart = parseFloat(seg.start);
          const relEnd = parseFloat(seg.end);

          // If first chunk, filter right side if not the only chunk
          if (i === 0) {
            if (chunks.length > 1) {
              return relEnd < (CHUNK_DURATION_SEC - OVERLAP_SEC / 2);
            }
            return true;
          }

          // If middle/last chunk, filter left side
          const keepLeft = relStart >= (OVERLAP_SEC / 2);
          if (!keepLeft) return false;

          // Filter right side if middle chunk
          if (!isLast) {
            return relEnd < (CHUNK_DURATION_SEC - OVERLAP_SEC / 2);
          }
          return true;
        });

        filteredSegments.forEach((seg: any) => {
          const id = `seg_cloud_${Date.now()}_${segmentCounter++}`;
          const absoluteStart = startSec + parseFloat(seg.start);
          const absoluteEnd = startSec + parseFloat(seg.end);

          // Word timings mapping & offset
          const wordTimings = seg.words && Array.isArray(seg.words) && seg.words.length > 0
            ? seg.words.map((w: any) => ({
                text: w.text,
                start: parseFloat((startSec + parseFloat(w.start)).toFixed(2)),
                end: parseFloat((startSec + parseFloat(w.end)).toFixed(2)),
              }))
            : generateWordTimings(seg.text, absoluteStart, absoluteEnd);

          allSegments.push({
            id,
            start: parseFloat(absoluteStart.toFixed(2)),
            end: parseFloat(absoluteEnd.toFixed(2)),
            text: seg.text,
            words: wordTimings,
          });
        });
      }

      setTranscriptionStatus({ progress: 95, message: "Finalizing subtitle sequence..." });
      setSegments(allSegments);
      setStep("editor");
    } catch (cloudErr: any) {
      console.error("Cloud transcription failed:", cloudErr);
      setErrorMsg(`Gemini cloud transcription failed: ${cloudErr.message || "Unknown error"}. Please check your internet connection or API key and try again.`);
      setStep("upload");
    }
  };

  // 4. Video scrubbing and playback canvas loop
  const handleVideoLoadMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const vid = e.currentTarget;
    setVideoDuration(vid.duration || 0);
    setVideoWidth(vid.videoWidth || 640);
    setVideoHeight(vid.videoHeight || 360);
  };

  // Sync canvas drawer with actual video playback
  const runPreviewLoop = () => {
    const canvas = previewCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = "#121214";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Compute sizing for crop vs letterbox fit
    const canvasRatio = canvas.width / canvas.height;
    const videoRatio = videoWidth / videoHeight;

    let drawWidth = canvas.width;
    let drawHeight = canvas.height;
    let dx = 0;
    let dy = 0;

    if (cropMode === "crop") {
      // Cover/Crop Fill
      if (videoRatio > canvasRatio) {
        drawHeight = canvas.height;
        drawWidth = canvas.height * videoRatio;
        dx = (canvas.width - drawWidth) / 2;
      } else {
        drawWidth = canvas.width;
        drawHeight = canvas.width / videoRatio;
        dy = (canvas.height - drawHeight) / 2;
      }
    } else {
      // Letterbox Fit
      if (videoRatio > canvasRatio) {
        drawWidth = canvas.width;
        drawHeight = canvas.width / videoRatio;
        dy = (canvas.height - drawHeight) / 2;
      } else {
        drawHeight = canvas.height;
        drawWidth = canvas.height * videoRatio;
        dx = (canvas.width - drawWidth) / 2;
      }
    }

    // Draw the active video frame
    try {
      ctx.drawImage(video, dx, dy, drawWidth, drawHeight);
    } catch (e) {
      // Frame not ready or decoding delay, fine to ignore
    }

    // Draw Subtitles on top of frame
    drawCaptionsOnCanvas(
      ctx,
      canvas.width,
      canvas.height,
      video.currentTime,
      segments,
      style,
      showTranslation,
      isPro
    );

    setCurrentTime(video.currentTime);
    setPlaybackProgress((video.currentTime / videoDuration) * 100);

    if (!video.paused && !video.ended) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(runPreviewLoop);
    }
  };

  // Pre-load current font family whenever it changes or when we enter editor/exporting steps
  useEffect(() => {
    async function loadFont() {
      if (typeof document !== "undefined" && document.fonts && style.fontFamily) {
        try {
          await document.fonts.ready;
          // Load normal and bold weights
          await Promise.all([
            document.fonts.load(`12px "${style.fontFamily}"`),
            document.fonts.load(`bold 12px "${style.fontFamily}"`)
          ]);

          // Warm-up font rasterization in DOM
          const span = document.createElement("span");
          span.textContent = "OmniCap Font Warm-up";
          span.style.fontFamily = `"${style.fontFamily}"`;
          span.style.position = "absolute";
          span.style.left = "-9999px";
          span.style.top = "-9999px";
          span.style.visibility = "hidden";
          document.body.appendChild(span);
          const _unused = span.offsetWidth; // Force rendering engine to calculate layout & rasterize
          document.body.removeChild(span);

          console.log("Preloaded and warmed up font family successfully:", style.fontFamily);
          
          // Trigger a single frame render to update current view if paused
          if (step === "editor" && !isPlaying) {
            setTimeout(() => {
              if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
              animationFrameRef.current = requestAnimationFrame(runPreviewLoop);
            }, 50);
          }
        } catch (err) {
          console.warn("Failed to load font explicitly:", err);
        }
      }
    }
    loadFont();
  }, [style.fontFamily, step, isPlaying]);

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    } else {
      video.play().then(() => {
        setIsPlaying(true);
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = requestAnimationFrame(runPreviewLoop);
      }).catch(console.error);
    }
  };

  const handleMuteToggle = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = parseFloat(e.target.value);
    const video = videoRef.current;
    if (!video) return;

    const newTime = (pct / 100) * videoDuration;
    video.currentTime = newTime;
    setCurrentTime(newTime);
    setPlaybackProgress(pct);

    // Refresh canvas instantly on scrub
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(runPreviewLoop);
  };

  // Re-draw canvas immediately when styling/crop configs change, canceling existing animation loops
  useEffect(() => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(runPreviewLoop);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [style, cropMode, aspectRatio, showTranslation, segments, isPro]);

  // 5. File Drag & Drop
  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("video/")) {
      setupUploadedVideo(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setupUploadedVideo(file);
    }
  };

  const setupUploadedVideo = async (file: File) => {
    setErrorMsg("");
    try {
      const bytes = await file.arrayBuffer();
      setVideoBytes(bytes);
      setVideoFile(file);
      
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      
      const blob = new Blob([bytes], { type: file.type });
      setVideoUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      console.error("Failed to read selected video:", err);
      setErrorMsg("Couldn't read the selected video — please try selecting it again, or pick a smaller/different file");
      setVideoBytes(null);
      setVideoFile(null);
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      setVideoUrl("");
    }
  };

  // 6. Timeline Subtitle Editing Controls
  const handleUpdateSegmentText = (id: string, text: string) => {
    const updated = segments.map((seg) => {
      if (seg.id === id) {
        // Recalculate word timing list proportionally
        const words = generateWordTimings(text, seg.start, seg.end);
        return { ...seg, text, words };
      }
      return seg;
    });
    setSegments(updated);
  };

  const handleUpdateSegmentTranslation = (id: string, transText: string) => {
    setSegments(
      segments.map((seg) => (seg.id === id ? { ...seg, translatedText: transText } : seg))
    );
  };

  const handleUpdateSegmentTimes = (id: string, field: "start" | "end", val: number) => {
    const updated = segments.map((seg) => {
      if (seg.id === id) {
        const start = field === "start" ? val : seg.start;
        const end = field === "end" ? val : seg.end;
        const words = generateWordTimings(seg.text, start, end);
        return { ...seg, start, end, words };
      }
      return seg;
    });
    // Sort segments chronologically
    setSegments(updated.sort((a, b) => a.start - b.start));
  };

  const handleDeleteSegment = (id: string) => {
    setSegments(segments.filter((seg) => seg.id !== id));
  };

  const handleSplitSegment = (id: string) => {
    const idx = segments.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const seg = segments[idx];
    const midTime = parseFloat(((seg.start + seg.end) / 2).toFixed(2));

    // Split words list
    const firstWords = seg.words.filter((w) => w.end <= midTime);
    const secondWords = seg.words.filter((w) => w.start > midTime);

    const firstText = firstWords.map((w) => w.text).join(" ") || "උපසිරැසි කොටස A";
    const secondText = secondWords.map((w) => w.text).join(" ") || "උපසිරැසි කොටස B";

    const split1: CaptionSegment = {
      id: `seg_${Date.now()}_split_1`,
      start: seg.start,
      end: midTime,
      text: firstText,
      words: firstWords,
    };

    const split2: CaptionSegment = {
      id: `seg_${Date.now()}_split_2`,
      start: midTime,
      end: seg.end,
      text: secondText,
      words: secondWords,
    };

    const newSegments = [...segments];
    newSegments.splice(idx, 1, split1, split2);
    setSegments(newSegments);
  };

  const handleMergeSegment = (id: string) => {
    const idx = segments.findIndex((s) => s.id === id);
    if (idx === -1 || idx === segments.length - 1) return;
    const seg1 = segments[idx];
    const seg2 = segments[idx + 1];

    const merged: CaptionSegment = {
      id: `seg_${Date.now()}_merged`,
      start: seg1.start,
      end: seg2.end,
      text: `${seg1.text} ${seg2.text}`.trim(),
      words: [...seg1.words, ...seg2.words],
      translatedText:
        seg1.translatedText || seg2.translatedText
          ? `${seg1.translatedText || ""} ${seg2.translatedText || ""}`.trim()
          : undefined,
    };

    const newSegments = [...segments];
    newSegments.splice(idx, 2, merged);
    setSegments(newSegments);
  };

  const handleAddSegment = () => {
    const current = videoRef.current ? videoRef.current.currentTime : 0;
    const end = Math.min(videoDuration, current + 3.0);
    const defaultText = "නව උපසිරැසි ලියන්න";
    
    const newSeg: CaptionSegment = {
      id: `seg_${Date.now()}_manual`,
      start: parseFloat(current.toFixed(2)),
      end: parseFloat(end.toFixed(2)),
      text: defaultText,
      words: generateWordTimings(defaultText, current, end),
    };

    // Insert chronologically
    const updated = [...segments, newSeg].sort((a, b) => a.start - b.start);
    setSegments(updated);
  };

  // Quick emoji insertion helper
  const handleInsertEmoji = (id: string, emoji: string) => {
    setSegments(
      segments.map((seg) => {
        if (seg.id === id) {
          const text = seg.text + " " + emoji;
          const words = generateWordTimings(text, seg.start, seg.end);
          return { ...seg, text, words };
        }
        return seg;
      })
    );
  };

  // Rule-based Keyword Auto-Emoji triggers
  const handleAutoSuggestEmojis = () => {
    const updated = segments.map((seg) => {
      const suggestions = suggestEmojisForText(seg.text);
      if (suggestions) {
        const text = (seg.text + suggestions).trim();
        const words = generateWordTimings(text, seg.start, seg.end);
        return { ...seg, text, words };
      }
      return seg;
    });
    setSegments(updated);
  };

  // 7. Full-stack translation helper (Sinhala to English via Gemini)
  const handleTranslateAllWithGemini = async () => {
    if (!isPro) {
      alert("👑 Pro Feature: Please enable Pro Mode in the top header to translate using Gemini AI!");
      return;
    }

    setIsTranslating(true);
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: segments.map((s) => ({ id: s.id, text: s.text })),
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      // Map translation results back to segments
      const translationMap: Record<string, string> = {};
      data.translatedSegments.forEach((t: any) => {
        translationMap[t.id] = t.translatedText;
      });

      setSegments(
        segments.map((seg) => ({
          ...seg,
          translatedText: translationMap[seg.id] || seg.translatedText || "",
        }))
      );
      setShowTranslation(true);
    } catch (err: any) {
      console.error(err);
      alert("Failed to translate: " + (err.message || "An error occurred"));
    } finally {
      setIsTranslating(false);
    }
  };

  // 8. Client-side Video Export Pipeline
  const handleExportVideo = async () => {
    if (!videoBytes || !videoFile) return;

    // Ensure all fonts are loaded before starting video export
    if (typeof document !== "undefined" && document.fonts && style.fontFamily) {
      try {
        await document.fonts.ready;
        await Promise.all([
          document.fonts.load(`12px "${style.fontFamily}"`),
          document.fonts.load(`bold 12px "${style.fontFamily}"`)
        ]);
      } catch (err) {
        console.warn("Explicit font pre-load in export failed, continuing:", err);
      }
    }

    setStep("exporting");
    setExportProgress(0);
    setExportedBlob(null);

    try {
      // Reconstruct safe File from memory cached videoBytes to bypass any stale/revoked OS-level read grants
      const safeVideoFile = new File([videoBytes], videoFile.name, { type: videoFile.type });

      const blob = await exportVideoClientSide({
        videoFile: safeVideoFile,
        segments,
        style,
        aspectRatio,
        cropMode,
        showTranslation,
        isPro,
        onProgress: (p) => setExportProgress(p),
      });

      setExportedBlob(blob);
      const url = URL.createObjectURL(blob);
      setExportedUrl(url);
    } catch (err: any) {
      console.error(err);
      alert("Export failed: " + (err.message || "Unknown error"));
      setStep("editor");
    }
  };

  // Subtitle download helpers
  const triggerSubtitleDownload = (format: "srt" | "vtt" | "txt" | "json") => {
    let content = "";
    let mimeType = "text/plain";
    let extension = format;

    if (format === "srt") {
      content = exportToSRT(segments, showTranslation);
      mimeType = "text/srt";
    } else if (format === "vtt") {
      content = exportToVTT(segments, showTranslation);
      mimeType = "text/vtt";
    } else if (format === "txt") {
      content = exportToTXT(segments, showTranslation);
    } else if (format === "json") {
      content = exportToJSON(segments);
      mimeType = "application/json";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `OmniCap_captions.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#0a0b0d] text-[#f4f4f5] flex flex-col antialiased selection:bg-yellow-400 selection:text-black">
      {/* HEADER BAR */}
      <header className="border-b border-[#262930] bg-[#0a0b0d]/80 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-tr from-yellow-500 via-orange-500 to-pink-500 p-2 rounded-xl text-black shadow-lg">
            <Video size={22} className="stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-zinc-200 to-zinc-400">
              OmniCap
            </h1>
            <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
              Sinhala Subtitle Studio
            </p>
          </div>
        </div>

        {/* Pro Switch / Monetization Scaffolding */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center bg-[#16181d] border border-[#262930] rounded-full p-1 pl-3 pr-2 shadow-sm hover:border-yellow-400/25 transition-colors">
            <div className="flex items-center space-x-1.5 mr-3">
              <Award size={14} className={isPro ? "text-yellow-400" : "text-zinc-500"} />
              <span className="text-xs font-semibold tracking-wide">
                {isPro ? "Pro Mode" : "Free Mode"}
              </span>
            </div>
            <button
              onClick={() => handleProToggle(!isPro)}
              className={`text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full transition-all ${
                isPro
                  ? "bg-gradient-to-r from-yellow-400 to-amber-500 text-black shadow-md"
                  : "bg-zinc-800 text-zinc-400 hover:text-white"
              }`}
            >
              {isPro ? "Enabled" : "Upgrade"}
            </button>
          </div>
        </div>
      </header>

      {/* CORE UX FLOW SCREEN ROUTER */}
      <main className="flex-1 flex flex-col p-4 md:p-6 max-w-7xl w-full mx-auto justify-center">
        <AnimatePresence mode="wait">
          {/* STEP 1: VIDEO UPLOAD */}
          {step === "upload" && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="max-w-2xl w-full mx-auto flex flex-col space-y-6"
            >
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-extrabold tracking-tight">
                  Auto-Caption Sinhala Videos
                </h2>
                <p className="text-zinc-400 text-sm max-w-lg mx-auto">
                  Powered by Gemini Cloud AI. Enjoy super fast, highly accurate, and intelligent multi-modal transcription of your Sinhala videos.
                </p>
              </div>

              {/* Upload Dropzone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                className="border-2 border-dashed border-[#262930] bg-[#16181d]/50 rounded-3xl p-12 flex flex-col items-center justify-center space-y-4 hover:border-yellow-400 hover:bg-[#16181d] transition-all duration-300 cursor-pointer group shadow-lg"
                onClick={() => document.getElementById("file-input")?.click()}
              >
                <input
                  id="file-input"
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-full text-zinc-400 group-hover:text-yellow-400 group-hover:scale-110 transition-all duration-300">
                  <Upload size={32} />
                </div>
                <div className="text-center space-y-1">
                  <p className="font-semibold text-zinc-200">
                    {videoFile ? videoFile.name : "Drag & drop video, or browse files"}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Supports MP4, WEBM, MOV, and MKV
                  </p>
                </div>
              </div>

              {/* Settings Toggle Box */}
              {videoFile && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="bento-card-no-hover p-6 space-y-5 shadow-xl"
                >
                  <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
                    <span className="text-sm font-bold flex items-center space-x-2">
                      <Sliders size={16} className="text-zinc-400" />
                      <span>Model Configurations</span>
                    </span>
                    <span className="text-xs text-zinc-500">
                      {(videoFile.size / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  </div>

                  {errorMsg && (
                    <div className="bg-red-950/20 border border-red-900/40 text-red-200 text-xs px-4 py-3 rounded-xl flex flex-col space-y-3">
                      <div className="flex items-start space-x-2">
                        <span className="text-red-400 font-bold text-sm leading-none mt-0.5 shrink-0">⚠️</span>
                        <div className="flex-1">
                          <p className="font-bold">Transcription Failed</p>
                          <p className="opacity-90">{errorMsg}</p>
                        </div>
                      </div>
                      <button
                        onClick={handleStartCaptioning}
                        className="bg-red-900/40 hover:bg-red-900/60 border border-red-700/50 text-white font-bold text-xs py-1.5 px-3 rounded-lg transition-colors self-end flex items-center space-x-1"
                      >
                        <RefreshCw size={12} className="animate-spin-hover mr-1" />
                        <span>Retry</span>
                      </button>
                    </div>
                  )}

                  <div className="space-y-4">
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-3 p-4 bg-zinc-950/40 border border-zinc-800/80 rounded-2xl"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-zinc-300 flex items-center space-x-1.5">
                          <Sparkles size={13} className="text-yellow-400 animate-pulse" />
                          <span>Gemini Cloud Transcription Options</span>
                        </span>
                        <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 rounded-md">
                          Super Fast & Cloud Grounded
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        For instant, highly accurate transcription of your videos, OmniCap uses our lightning-fast Express backend powered by Gemini 3.5.
                      </p>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-zinc-400 block">Bring-Your-Own Gemini API Key (Optional)</label>
                          <span className="text-[10px] text-zinc-500 italic">Saved locally</span>
                        </div>
                        <input
                          type="password"
                          placeholder="AIzaSy... (leave empty to use server default key)"
                          value={geminiApiKey}
                          onChange={(e) => handleApiKeyChange(e.target.value)}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-mono text-zinc-300 focus:ring-1 focus:ring-yellow-500 focus:outline-none"
                        />
                      </div>
                    </motion.div>
                  </div>

                  <button
                    onClick={handleStartCaptioning}
                    className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-extrabold text-sm py-3 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center space-x-2"
                  >
                    <Sparkles size={16} />
                    <span>Generate Subtitles</span>
                  </button>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* STEP 2: EXTRACTING AUDIO */}
          {step === "extracting" && (
            <motion.div
              key="extracting"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md w-full mx-auto text-center space-y-6 bento-card p-8"
            >
              <div className="flex justify-center">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-yellow-500/20 border-t-yellow-400 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Volume2 className="text-yellow-400 animate-pulse" size={24} />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold">Extracting Sound Track</h3>
                <p className="text-xs text-zinc-400">
                  Using Web Audio API to decode and resample the video audio directly inside your
                  browser. Zero files leave your computer.
                </p>
              </div>
              <div className="space-y-2">
                <div className="w-full bg-zinc-900 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-yellow-400 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${extractionProgress}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                  <span>Decompressing</span>
                  <span>{extractionProgress}%</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* STEP 3: TRANSCRIBING */}
          {step === "transcribing" && (
            <motion.div
              key="transcribing"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md w-full mx-auto text-center space-y-6 bento-card p-8"
            >
              <div className="flex justify-center">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-purple-500/20 border-t-purple-400 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Type className="text-purple-400 animate-pulse" size={24} />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold">ASR Speech-to-Text</h3>
                <p className="text-xs text-zinc-400">
                  Gemini Cloud is transcribing the audio segments. Highly accurate Sinhala transcription is being generated dynamically.
                </p>
              </div>

              {/* Progress Bar Stack */}
              <div className="space-y-4 border-t border-zinc-800/60 pt-4">
                {/* Speech Processing Progress */}
                <div className="space-y-1 text-left">
                  <div className="flex justify-between text-xs font-bold text-zinc-300">
                    <span>{transcriptionStatus.message || "Awaiting transcription..."}</span>
                    <span className="text-zinc-500">{transcriptionStatus.progress}%</span>
                  </div>
                  <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-yellow-400 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${transcriptionStatus.progress}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* STEP 4: INTERACTIVE STUDIO WORKSPACE */}
          {step === "editor" && (
            <motion.div
              key="editor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col lg:flex-row gap-6 items-stretch w-full flex-1"
            >
              {/* HIDDEN NATIVE VIDEO CONTROLLER */}
              {videoUrl && (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="hidden"
                  playsInline
                  onLoadedMetadata={handleVideoLoadMetadata}
                  onTimeUpdate={runPreviewLoop}
                />
              )}

              {/* LEFT HALF: THE VIDEO CANVAS LIVE PLAYER */}
              <div className="flex-1 flex flex-col space-y-4 max-w-2xl mx-auto w-full">
                {/* Visual Viewport Stage Box */}
                <div className="relative bento-card overflow-hidden aspect-video flex items-center justify-center p-3 shadow-2xl">
                  <canvas
                    ref={previewCanvasRef}
                    width={videoWidth || 640}
                    height={videoHeight || 360}
                    className="max-h-full max-w-full rounded-lg shadow-lg object-contain bg-black"
                  />
                </div>

                {/* Custom Playback Console Controls */}
                <div className="bento-card p-5 space-y-4">
                  {/* Timeline scrubbing slider */}
                  <div className="flex items-center space-x-3">
                    <span className="text-[10px] font-mono text-zinc-400">
                      {currentTime.toFixed(1)}s
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="0.1"
                      value={playbackProgress}
                      onChange={handleScrub}
                      className="flex-1 accent-yellow-400 h-1 bg-zinc-800 rounded-lg cursor-pointer appearance-none"
                    />
                    <span className="text-[10px] font-mono text-zinc-400">
                      {videoDuration.toFixed(1)}s
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={handlePlayPause}
                        className="p-2.5 bg-[#0a0b0d] border border-[#262930] hover:border-yellow-400 rounded-xl text-zinc-300 hover:text-white transition-all shadow-sm"
                      >
                        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <button
                        onClick={handleMuteToggle}
                        className="p-2.5 bg-[#0a0b0d] border border-[#262930] hover:border-yellow-400 rounded-xl text-zinc-300 hover:text-white transition-all shadow-sm"
                      >
                        {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      </button>
                    </div>

                    {/* Visual Configuration Quick Bars */}
                    <div className="flex items-center space-x-2 text-xs">
                      {/* Aspect Ratio Box */}
                      <select
                        value={aspectRatio}
                        onChange={(e) => handleRatioChange(e.target.value as AspectRatio)}
                        className="bg-[#0a0b0d] border border-[#262930] rounded-xl px-2.5 py-1.5 font-bold focus:outline-none focus:border-yellow-400"
                      >
                        <option value="16:9">Horizontal (16:9)</option>
                        <option value="9:16">Portrait Reels (9:16)</option>
                        <option value="1:1">Square (1:1)</option>
                        <option value="4:5">Vertical Feed (4:5)</option>
                      </select>

                      {/* Crop Toggle */}
                      <select
                        value={cropMode}
                        onChange={(e) => handleCropChange(e.target.value as "crop" | "letterbox")}
                        className="bg-[#0a0b0d] border border-[#262930] rounded-xl px-2.5 py-1.5 font-bold focus:outline-none focus:border-yellow-400"
                      >
                        <option value="crop">Center-Crop Fill</option>
                        <option value="letterbox">Letterbox Fit</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Translate and Watermark Info Panel */}
                <div className="bento-card-no-hover p-4 flex items-center justify-between bg-gradient-to-r from-[#16181d] via-[#1a1c23] to-[#16181d] shadow-inner">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-1.5">
                      <Globe size={13} className="text-yellow-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                        Subtitles Language
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Toggle English translations if you ran the Gemini Translator.
                    </p>
                  </div>
                  <div className="flex bg-[#0a0b0d] p-0.5 border border-[#262930] rounded-xl space-x-0.5">
                    <button
                      onClick={() => setShowTranslation(false)}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                        !showTranslation ? "bg-[#262930] text-yellow-400" : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Sinhala
                    </button>
                    <button
                      onClick={() => {
                        const hasTrans = segments.some((s) => s.translatedText);
                        if (!hasTrans) {
                          alert("No translation found! Click 'Translate with Gemini' in the editor panel first.");
                          return;
                        }
                        setShowTranslation(true);
                      }}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                        showTranslation ? "bg-[#262930] text-yellow-400" : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      English
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGHT HALF: DETAILED WORKSPACE CONTROL PANEL */}
              <div className="flex-1 bento-card-no-hover overflow-hidden flex flex-col shadow-2xl min-h-[500px]">
                {/* CONTROL PANEL HEADER TABS */}
                <div className="flex border-b border-[#262930] bg-[#121317]">
                  <button
                    onClick={() => setActiveTab("editor")}
                    className={`flex-1 py-4 text-xs font-bold border-b-2 uppercase tracking-wider transition-all flex items-center justify-center space-x-2 ${
                      activeTab === "editor"
                        ? "border-yellow-400 text-yellow-400 bg-[#16181d]"
                        : "border-transparent text-zinc-500 hover:text-white"
                    }`}
                  >
                    <Type size={14} />
                    <span>Edit Captions</span>
                  </button>
                  <button
                    onClick={() => setActiveTab("style")}
                    className={`flex-1 py-4 text-xs font-bold border-b-2 uppercase tracking-wider transition-all flex items-center justify-center space-x-2 ${
                      activeTab === "style"
                        ? "border-yellow-400 text-yellow-400 bg-[#16181d]"
                        : "border-transparent text-zinc-500 hover:text-white"
                    }`}
                  >
                    <Sliders size={14} />
                    <span>Styling</span>
                  </button>
                  <button
                    onClick={() => setActiveTab("presets")}
                    className={`flex-1 py-4 text-xs font-bold border-b-2 uppercase tracking-wider transition-all flex items-center justify-center space-x-2 ${
                      activeTab === "presets"
                        ? "border-yellow-400 text-yellow-400 bg-[#16181d]"
                        : "border-transparent text-zinc-500 hover:text-white"
                    }`}
                  >
                    <Sparkles size={14} />
                    <span>Presets</span>
                  </button>
                  <button
                    onClick={() => setActiveTab("download")}
                    className={`flex-1 py-4 text-xs font-bold border-b-2 uppercase tracking-wider transition-all flex items-center justify-center space-x-2 ${
                      activeTab === "download"
                        ? "border-yellow-400 text-yellow-400 bg-[#16181d]"
                        : "border-transparent text-zinc-500 hover:text-white"
                    }`}
                  >
                    <Download size={14} />
                    <span>Export</span>
                  </button>
                </div>

                {/* SCROLLABLE WORKSPACE TABS */}
                <div className="flex-1 p-5 overflow-y-auto max-h-[60vh] space-y-4">
                  {/* TAB 1: CAPTION TIMELINE EDITOR */}
                  {activeTab === "editor" && (
                    <div className="space-y-4">
                      {/* Top Action Panel */}
                      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0a0b0d]/50 border border-[#262930] p-3.5 rounded-2xl">
                        <button
                          onClick={handleAddSegment}
                          className="px-3 py-1.5 bg-[#16181d] hover:bg-[#20232b] text-zinc-200 hover:text-white border border-[#262930] text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all duration-200"
                        >
                          <Plus size={14} className="text-yellow-400" />
                          <span>Add Segment</span>
                        </button>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={handleAutoSuggestEmojis}
                            className="px-3 py-1.5 bg-[#16181d] hover:bg-[#20232b] text-zinc-200 hover:text-white border border-[#262930] text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all duration-200"
                          >
                            <Smile size={14} className="text-pink-400" />
                            <span>Auto Emojis</span>
                          </button>
                          <button
                            onClick={handleTranslateAllWithGemini}
                            disabled={isTranslating}
                            className="px-3 py-1.5 bg-[#16181d] hover:bg-[#20232b] text-zinc-200 hover:text-white border border-[#262930] text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all duration-200 disabled:opacity-50"
                          >
                            {isTranslating ? (
                              <RefreshCw size={14} className="animate-spin text-purple-400" />
                            ) : (
                              <Globe size={14} className="text-purple-400" />
                            )}
                            <span>{isTranslating ? "Translating..." : "Translate (AI)"}</span>
                          </button>
                        </div>
                      </div>

                      {/* Segments Scroll List */}
                      <div className="space-y-3">
                        {segments.length === 0 && (
                          <div className="text-center py-10 text-zinc-500 text-sm">
                            No segments found. Use "Add Segment" to create some manual captions.
                          </div>
                        )}
                        {segments.map((seg, idx) => {
                          const isActive = currentTime >= seg.start && currentTime <= seg.end;
                          return (
                            <div
                              key={seg.id}
                              className={`p-4 border rounded-2xl transition-all space-y-3.5 relative group ${
                                isActive
                                  ? "border-yellow-400 bg-yellow-400/[0.02] shadow-[0_0_15px_rgba(250,204,21,0.05)]"
                                  : "border-[#262930] bg-[#0a0b0d]/60 hover:bg-[#0a0b0d]"
                              }`}
                            >
                              {/* Timing Indicators + Split/Merge */}
                              <div className="flex items-center justify-between text-[11px] font-bold text-zinc-400">
                                <div className="flex items-center space-x-1.5">
                                  {/* Start input */}
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={seg.start}
                                    onChange={(e) =>
                                      handleUpdateSegmentTimes(seg.id, "start", parseFloat(e.target.value) || 0)
                                    }
                                    className="bg-[#16181d] border border-[#262930] rounded-lg px-1.5 py-0.5 w-12 text-center text-zinc-200 font-mono focus:outline-none focus:border-yellow-400"
                                  />
                                  <span>➔</span>
                                  {/* End input */}
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={seg.end}
                                    onChange={(e) =>
                                      handleUpdateSegmentTimes(seg.id, "end", parseFloat(e.target.value) || 0)
                                    }
                                    className="bg-[#16181d] border border-[#262930] rounded-lg px-1.5 py-0.5 w-12 text-center text-zinc-200 font-mono focus:outline-none focus:border-yellow-400"
                                  />
                                  <span className="text-[9px] uppercase tracking-wider text-zinc-600 bg-[#16181d] px-1.5 py-0.5 rounded">
                                    {(seg.end - seg.start).toFixed(1)}s
                                  </span>
                                </div>

                                <div className="flex items-center space-x-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleSplitSegment(seg.id)}
                                    title="Split segment in half"
                                    className="p-1 hover:bg-[#262930] rounded text-zinc-400 hover:text-white"
                                  >
                                    <Split size={12} />
                                  </button>
                                  {idx < segments.length - 1 && (
                                    <button
                                      onClick={() => handleMergeSegment(seg.id)}
                                      title="Merge with next segment"
                                      className="p-1 hover:bg-[#262930] rounded text-zinc-400 hover:text-white"
                                    >
                                      <Combine size={12} />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleDeleteSegment(seg.id)}
                                    title="Delete segment"
                                    className="p-1 hover:bg-[#262930] rounded text-red-400 hover:text-red-300"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>

                              {/* Sinhala Text Input */}
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                                  Sinhala Text
                                </label>
                                <textarea
                                  value={seg.text}
                                  rows={2}
                                  onChange={(e) => handleUpdateSegmentText(seg.id, e.target.value)}
                                  className="w-full bg-[#0a0b0d] border border-[#262930] rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-yellow-400 focus:border-yellow-400 font-sans transition-all"
                                />
                              </div>

                              {/* English Translation text (if available) */}
                              {seg.translatedText !== undefined && (
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">
                                    English Translation
                                  </label>
                                  <textarea
                                    value={seg.translatedText}
                                    rows={2}
                                    onChange={(e) => handleUpdateSegmentTranslation(seg.id, e.target.value)}
                                    className="w-full bg-[#0a0b0d] border border-purple-900/30 rounded-xl px-3 py-2 text-sm text-purple-200 focus:outline-none focus:ring-1 focus:ring-purple-400 focus:border-purple-400 font-sans transition-all"
                                  />
                                </div>
                              )}

                              {/* Quick Emoji insert bar */}
                              <div className="flex flex-wrap items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider mr-1">Insert:</span>
                                {["❤️", "🔥", "😂", "👍", "😊", "✨", "🎵", "🇱🇰", "🚗", "🍕"].map((em) => (
                                  <button
                                    key={em}
                                    onClick={() => handleInsertEmoji(seg.id, em)}
                                    className="text-xs hover:bg-[#262930] p-1 rounded transition-colors"
                                  >
                                    {em}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* TAB 2: FINE-GRAINED CAPTION STYLING OPTIONS */}
                  {activeTab === "style" && (
                    <div className="space-y-5">
                      {/* Typography Grid */}
                      <div className="bg-[#0a0b0d]/50 border border-[#262930] rounded-2xl p-4.5 space-y-4 shadow-sm">
                        <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block">
                          Typography settings
                        </span>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Font Family */}
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500 font-semibold">Font Family</label>
                            <select
                              value={style.fontFamily}
                              onChange={(e) => updateStyle({ fontFamily: e.target.value })}
                              className="w-full bg-[#16181d] border border-[#262930] rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-yellow-400"
                            >
                              {Object.entries(BUNDLED_FONTS_GROUPED).map(([groupName, fonts]) => (
                                <optgroup key={groupName} label={groupName} className="text-yellow-500 font-bold bg-[#16181d]">
                                  {fonts.map((f) => (
                                    <option key={f.value} value={f.value} className="text-zinc-100 font-medium bg-[#16181d]">
                                      {f.name}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </div>

                          {/* Font Size */}
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500 font-semibold">
                              Base Size ({style.fontSize}px)
                            </label>
                            <input
                              type="range"
                              min="14"
                              max="48"
                              value={style.fontSize}
                              onChange={(e) => updateStyle({ fontSize: parseInt(e.target.value) })}
                              className="w-full accent-yellow-400"
                            />
                          </div>

                          {/* Letter Spacing */}
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500 font-semibold">
                              Letter Spacing ({style.letterSpacing}px)
                            </label>
                            <input
                              type="range"
                              min="-2"
                              max="8"
                              value={style.letterSpacing}
                              onChange={(e) => updateStyle({ letterSpacing: parseInt(e.target.value) })}
                              className="w-full accent-yellow-400"
                            />
                          </div>

                          {/* Line Height */}
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500 font-semibold">
                              Line Height ({style.lineHeight})
                            </label>
                            <input
                              type="range"
                              min="1.0"
                              max="2.0"
                              step="0.05"
                              value={style.lineHeight}
                              onChange={(e) => updateStyle({ lineHeight: parseFloat(e.target.value) })}
                              className="w-full accent-yellow-400"
                            />
                          </div>
                        </div>

                        {/* Text Transform Upper Case Toggle */}
                        <div className="flex items-center justify-between border-t border-[#262930] pt-3">
                          <span className="text-xs font-semibold text-zinc-400">Uppercase All Text</span>
                          <button
                            onClick={() =>
                              updateStyle({
                                textTransform: style.textTransform === "uppercase" ? "none" : "uppercase"
                              })
                            }
                            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                              style.textTransform === "uppercase"
                                ? "bg-yellow-400 text-black font-extrabold"
                                : "bg-[#16181d] border border-[#262930] text-zinc-400 hover:text-white"
                            }`}
                          >
                            {style.textTransform === "uppercase" ? "ON" : "OFF"}
                          </button>
                        </div>
                      </div>

                      {/* Colors & Outline */}
                      <div className="bg-[#0a0b0d]/50 border border-[#262930] rounded-2xl p-4.5 space-y-4 shadow-sm">
                        <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block">
                          Colors & Outlines
                        </span>

                        <div className="grid grid-cols-2 gap-4">
                          {/* Text Color */}
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500 font-semibold block">Text Color</label>
                            <div className="flex items-center space-x-2">
                              <input
                                type="color"
                                value={style.textColor}
                                onChange={(e) => updateStyle({ textColor: e.target.value })}
                                className="w-8 h-8 rounded-lg cursor-pointer bg-[#16181d] border border-[#262930]"
                              />
                              <span className="text-xs font-mono text-zinc-400 uppercase">{style.textColor}</span>
                            </div>
                          </div>

                          {/* Active highlight color */}
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500 font-semibold block">Active Color</label>
                            <div className="flex items-center space-x-2">
                              <input
                                type="color"
                                value={style.activeColor}
                                onChange={(e) => updateStyle({ activeColor: e.target.value })}
                                className="w-8 h-8 rounded-lg cursor-pointer bg-[#16181d] border border-[#262930]"
                              />
                              <span className="text-xs font-mono text-zinc-400 uppercase">{style.activeColor}</span>
                            </div>
                          </div>

                          {/* Stroke Color */}
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500 font-semibold block">Outline Color</label>
                            <div className="flex items-center space-x-2">
                              <input
                                type="color"
                                value={style.outlineColor}
                                onChange={(e) => updateStyle({ outlineColor: e.target.value })}
                                className="w-8 h-8 rounded-lg cursor-pointer bg-[#16181d] border border-[#262930]"
                              />
                              <span className="text-xs font-mono text-zinc-400 uppercase">{style.outlineColor}</span>
                            </div>
                          </div>

                          {/* Outline width */}
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500 font-semibold">
                              Outline ({style.outlineWidth}px)
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="8"
                              value={style.outlineWidth}
                              onChange={(e) => updateStyle({ outlineWidth: parseInt(e.target.value) })}
                              className="w-full accent-yellow-400"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Layout position and offsets */}
                      <div className="bg-[#0a0b0d]/50 border border-[#262930] rounded-2xl p-4.5 space-y-4 shadow-sm">
                        <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block">
                          Alignment & Positions
                        </span>

                        <div className="space-y-3">
                          {/* Position Presets */}
                          <div className="space-y-1.5">
                            <label className="text-xs text-zinc-500 font-semibold">Layout Position</label>
                            <div className="flex bg-[#16181d] p-1 border border-[#262930] rounded-xl space-x-1">
                              {(["top", "center", "bottom"] as const).map((pos) => (
                                <button
                                  key={pos}
                                  onClick={() => updateStyle({ position: pos })}
                                  className={`flex-1 py-1 text-xs font-bold rounded-lg uppercase transition-all ${
                                    style.position === pos
                                      ? "bg-[#262930] text-yellow-400 shadow-md"
                                      : "text-zinc-500 hover:text-white"
                                  }`}
                                >
                                  {pos}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Vertical offsets */}
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500 font-semibold">
                              Vertical Offset Nudge ({style.verticalOffset}px)
                            </label>
                            <input
                              type="range"
                              min="-120"
                              max="120"
                              value={style.verticalOffset}
                              onChange={(e) => updateStyle({ verticalOffset: parseInt(e.target.value) })}
                              className="w-full accent-yellow-400"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Animation Preset Select */}
                      <div className="bg-[#0a0b0d]/50 border border-[#262930] rounded-2xl p-4.5 space-y-4 shadow-sm">
                        <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block">
                          Animation Styles
                        </span>

                        <select
                          value={style.animationStyle}
                          onChange={(e) => updateStyle({ animationStyle: e.target.value as any })}
                          className="w-full bg-[#16181d] border border-[#262930] rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-yellow-400"
                        >
                          <option value="none">Static text lines (no animation)</option>
                          <option value="karaoke">Smooth progressive word wipe (Karaoke)</option>
                          <option value="highlight">Translucent word capsule box (Highlight)</option>
                          <option value="pop">Gentle word pop-in scale (Pop)</option>
                          <option value="bounce">Word jumping bounce upwards (Bounce)</option>
                          <option value="glow">Soft neon color blur outer (Glow)</option>
                          <option value="scale">Segment elastic zoom entry (Scale)</option>
                          <option value="shake">Excited jittery word rumble (Shake)</option>
                          <option value="slide">Slide reveals up and fade (Slide)</option>
                          <option value="typewriter">Character sequence reveal (Typewriter)</option>
                          <option value="zoom">Quick scale word entrance (Zoom)</option>
                          <option value="centeredWord">Single centered TikTok words (Centered Single)</option>
                        </select>
                      </div>

                      {/* Background Pill/Bar Style */}
                      <div className="bg-[#0a0b0d]/50 border border-[#262930] rounded-2xl p-4.5 space-y-4 shadow-sm">
                        <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block">
                          Background Pill/Boxes
                        </span>

                        <div className="space-y-3">
                          <div className="flex bg-[#16181d] p-1 border border-[#262930] rounded-xl space-x-1">
                            {(["none", "pill", "bar"] as const).map((bgType) => (
                              <button
                                key={bgType}
                                onClick={() => updateStyle({ background: bgType })}
                                className={`flex-1 py-1 text-xs font-bold rounded-lg uppercase transition-all ${
                                  style.background === bgType
                                    ? "bg-[#262930] text-yellow-400 shadow-md"
                                    : "text-zinc-500 hover:text-white"
                                }`}
                              >
                                {bgType === "none" ? "None" : bgType === "pill" ? "Rounded Pill" : "Full Width Bar"}
                              </button>
                            ))}
                          </div>

                          {style.background !== "none" && (
                            <div className="grid grid-cols-2 gap-4 pt-2">
                              {/* Background Color */}
                              <div className="space-y-1">
                                <label className="text-xs text-zinc-500 font-semibold block">Box Color</label>
                                <input
                                  type="color"
                                  value={style.backgroundColor}
                                  onChange={(e) => updateStyle({ backgroundColor: e.target.value })}
                                  className="w-full h-8 rounded-lg cursor-pointer bg-[#16181d] border border-[#262930]"
                                />
                              </div>

                              {/* Background Opacity */}
                              <div className="space-y-1">
                                <label className="text-xs text-zinc-500 font-semibold">
                                  Opacity ({Math.round(style.backgroundOpacity * 100)}%)
                                </label>
                                <input
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.05"
                                  value={style.backgroundOpacity}
                                  onChange={(e) => updateStyle({ backgroundOpacity: parseFloat(e.target.value) })}
                                  className="w-full accent-yellow-400"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 3: READY-MADE STYLE PRESETS */}
                  {activeTab === "presets" && (
                    <div className="space-y-4">
                      <div className="text-xs text-zinc-500 pb-2">
                        Click on any preset below to instantly apply pre-designed style configurations!
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        {STYLE_PRESETS.map((preset) => (
                          <button
                            key={preset.name}
                            onClick={() => {
                              updateStyle(preset.style);
                              alert(`Applied '${preset.name}' style configuration successfully!`);
                            }}
                            className="text-left p-4.5 bg-[#0a0b0d]/60 border border-[#262930] hover:border-yellow-400 rounded-2xl hover:bg-[#16181d] transition-all duration-300 shadow-sm space-y-1.5 group"
                          >
                            <span className="text-sm font-bold text-zinc-200 group-hover:text-yellow-400 transition-colors flex items-center space-x-1.5">
                              <span>{preset.name}</span>
                            </span>
                            <p className="text-xs text-zinc-500">{preset.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* TAB 4: CAPTION EXPORTS & BURN VIDEO */}
                  {activeTab === "download" && (
                    <div className="space-y-6">
                      {/* Video Burn-in Action */}
                      <div className="bg-gradient-to-tr from-yellow-500/[0.02] to-amber-500/[0.02] border border-[#262930] p-5.5 rounded-3xl space-y-4 shadow">
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold text-yellow-400 flex items-center space-x-1.5">
                            <Sparkles size={16} />
                            <span>Burn Subtitles into Video</span>
                          </h4>
                          <p className="text-xs text-zinc-400 leading-relaxed">
                            Export a customized, downloadable MP4 with your custom font, colors, and word-highlighting
                            captions permanently burned onto the video track. Rendered fully locally inside your browser context.
                          </p>
                        </div>

                        <button
                          onClick={handleExportVideo}
                          className="w-full bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-black font-extrabold text-xs py-3 px-4 rounded-xl shadow-md transition-all flex items-center justify-center space-x-2"
                        >
                          <Video size={14} />
                          <span>Export & Compile MP4</span>
                        </button>
                      </div>

                      {/* Raw caption downloads */}
                      <div className="bg-[#0a0b0d]/50 border border-[#262930] rounded-2xl p-5 space-y-4 shadow-sm">
                        <div className="space-y-1">
                          <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider block">
                            Raw Subtitle Files
                          </span>
                          <p className="text-[11px] text-zinc-500">
                            Download subtitle timelines directly as SRT, VTT, or JSON data.
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <button
                            onClick={() => triggerSubtitleDownload("srt")}
                            className="p-3 bg-[#16181d] border border-[#262930] hover:border-yellow-400/30 hover:text-white rounded-xl text-xs font-semibold text-zinc-300 transition-all duration-200 flex items-center justify-center space-x-2"
                          >
                            <FolderOpen size={12} className="text-zinc-500" />
                            <span>Download .SRT</span>
                          </button>
                          <button
                            onClick={() => triggerSubtitleDownload("vtt")}
                            className="p-3 bg-[#16181d] border border-[#262930] hover:border-yellow-400/30 hover:text-white rounded-xl text-xs font-semibold text-zinc-300 transition-all duration-200 flex items-center justify-center space-x-2"
                          >
                            <FolderOpen size={12} className="text-zinc-500" />
                            <span>Download .VTT</span>
                          </button>
                          <button
                            onClick={() => triggerSubtitleDownload("txt")}
                            className="p-3 bg-[#16181d] border border-[#262930] hover:border-yellow-400/30 hover:text-white rounded-xl text-xs font-semibold text-zinc-300 transition-all duration-200 flex items-center justify-center space-x-2"
                          >
                            <FolderOpen size={12} className="text-zinc-500" />
                            <span>Download .TXT</span>
                          </button>
                          <button
                            onClick={() => triggerSubtitleDownload("json")}
                            className="p-3 bg-[#16181d] border border-[#262930] hover:border-yellow-400/30 hover:text-white rounded-xl text-xs font-semibold text-zinc-300 transition-all duration-200 flex items-center justify-center space-x-2"
                          >
                            <FolderOpen size={12} className="text-zinc-500" />
                            <span>Download .JSON</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Back / Workspace Footer info */}
                <div className="border-t border-[#262930] bg-[#121317] p-4 flex items-center justify-between text-xs text-zinc-500">
                  <div className="flex items-center space-x-1.5">
                    <Check size={14} className="text-green-500" />
                    <span>Workspace State Saved</span>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm("Are you sure you want to exit? Your current workspace will be reset.")) {
                        setStep("upload");
                        setVideoFile(null);
                        setVideoUrl("");
                        setSegments([]);
                      }
                    }}
                    className="hover:text-red-400 font-bold uppercase tracking-wider text-[10px]"
                  >
                    Reset Studio
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* STEP 5: VIDEO EXPORT PROGRESS / COMPILING */}
          {step === "exporting" && (
            <motion.div
              key="exporting"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md w-full mx-auto text-center space-y-6 bento-card p-8"
            >
              {exportProgress < 100 ? (
                <div className="space-y-5">
                  <div className="flex justify-center">
                    <div className="relative">
                      <div className="w-16 h-16 border-4 border-yellow-500/20 border-t-yellow-400 rounded-full animate-spin"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Sliders className="text-yellow-400 animate-pulse" size={24} />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-bold">Burning Subtitles</h3>
                    <p className="text-xs text-zinc-400">
                      Compiling canvas video frames, drawing animations, mixing original audio track
                      frequencies into a high-quality WebM/MP4 format. Keep this window active.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="w-full bg-[#16181d] rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-yellow-400 h-2.5 rounded-full transition-all duration-300"
                        style={{ width: `${exportProgress}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                      <span>Encoding frames</span>
                      <span>{exportProgress}%</span>
                    </div>
                  </div>
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="flex justify-center text-green-400">
                    <div className="bg-green-400/10 p-4 rounded-full border border-green-400/20">
                      <Check size={48} className="stroke-[2.5]" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-xl font-extrabold">Video Export Finished!</h3>
                    <p className="text-xs text-zinc-400">
                      Your captioned video has been compiled successfully. You can download the completed file below.
                    </p>
                  </div>

                  {exportedUrl && (
                    <video
                      src={exportedUrl}
                      controls
                      className="w-full rounded-xl border border-[#262930] bg-black shadow-lg aspect-video"
                    />
                  )}

                  <div className="flex space-x-3 pt-2">
                    <button
                      onClick={() => setStep("editor")}
                      className="flex-1 bg-[#16181d] border border-[#262930] hover:border-yellow-400/30 text-zinc-300 hover:text-white font-extrabold text-xs py-3 px-4 rounded-xl transition-all duration-200"
                    >
                      Back to Editor
                    </button>
                    {exportedUrl && (
                      <a
                        href={exportedUrl}
                        download={`OmniCap_captioned_video${exportedBlob?.type.includes("mp4") ? ".mp4" : ".webm"}`}
                        className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-black font-extrabold text-xs py-3 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center space-x-1.5"
                      >
                        <Download size={14} />
                        <span>Download Video</span>
                      </a>
                    )}
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Global Error Banner */}
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md w-full mx-auto mt-4 bg-red-950/20 border border-red-900/30 text-red-300 text-xs p-3.5 rounded-xl text-center shadow-lg"
          >
            {errorMsg}
          </motion.div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="border-t border-[#262930] bg-[#0a0b0d] py-6 text-center text-[11px] text-zinc-600 font-medium">
        <div>OmniCap © 2026. Made entirely on-device for total user privacy.</div>
        <div className="text-[10px] text-zinc-700 mt-1">
          Whisper is a trademark of OpenAI. This application runs WebAssembly models compiled for ONNX runtime.
        </div>
      </footer>
    </div>
  );
}
