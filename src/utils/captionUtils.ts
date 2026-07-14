import { CaptionSegment, WordTiming } from "../types";

/**
 * Distributes a segment's duration proportionally across its words based on character length.
 */
export function generateWordTimings(
  segmentText: string,
  start: number,
  end: number
): WordTiming[] {
  const words = segmentText.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    return [];
  }

  const duration = Math.max(0.1, end - start);
  const wordLengths = words.map((w) => w.length);
  const totalChars = wordLengths.reduce((sum, len) => sum + len, 0);

  if (totalChars === 0) {
    // Fallback: divide equally
    const equalDuration = duration / words.length;
    return words.map((text, i) => ({
      text,
      start: start + i * equalDuration,
      end: start + (i + 1) * equalDuration,
    }));
  }

  const timings: WordTiming[] = [];
  let currentStart = start;

  for (let i = 0; i < words.length; i++) {
    const wordText = words[i];
    const wordLen = wordLengths[i];
    const wordDuration = (wordLen / totalChars) * duration;
    const wordEnd = Math.min(end, currentStart + wordDuration);

    timings.push({
      text: wordText,
      start: parseFloat(currentStart.toFixed(3)),
      end: parseFloat((i === words.length - 1 ? end : wordEnd).toFixed(3)),
    });

    currentStart = wordEnd;
  }

  return timings;
}

/**
 * Formats a time in seconds to HH:MM:SS,ms (SRT style)
 */
export function formatSRTTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  const pad = (num: number, size = 2) => String(num).padStart(size, "0");
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
}

/**
 * Formats a time in seconds to HH:MM:SS.ms (VTT style)
 */
export function formatVTTTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  const pad = (num: number, size = 2) => String(num).padStart(size, "0");
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}.${pad(ms, 3)}`;
}

/**
 * Generates an SRT string from caption segments
 */
export function exportToSRT(segments: CaptionSegment[], useTranslation = false): string {
  return segments
    .map((seg, i) => {
      const text = useTranslation ? (seg.translatedText || seg.text) : seg.text;
      return `${i + 1}\n${formatSRTTime(seg.start)} --> ${formatSRTTime(seg.end)}\n${text}\n`;
    })
    .join("\n");
}

/**
 * Generates a VTT string from caption segments
 */
export function exportToVTT(segments: CaptionSegment[], useTranslation = false): string {
  const body = segments
    .map((seg, i) => {
      const text = useTranslation ? (seg.translatedText || seg.text) : seg.text;
      return `${i + 1}\n${formatVTTTime(seg.start)} --> ${formatVTTTime(seg.end)}\n${text}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

/**
 * Generates a plain text transcript from caption segments
 */
export function exportToTXT(segments: CaptionSegment[], useTranslation = false): string {
  return segments
    .map((seg) => (useTranslation ? (seg.translatedText || seg.text) : seg.text))
    .join("\n");
}

/**
 * Generates a full timing JSON string from caption segments
 */
export function exportToJSON(segments: CaptionSegment[]): string {
  return JSON.stringify(segments, null, 2);
}

/**
 * Maps common Sinhala and English keywords to a relevant emoji.
 */
export function suggestEmojisForText(text: string): string {
  const lowercase = text.toLowerCase();
  const emojiMappings: { keywords: string[]; emoji: string }[] = [
    { keywords: ["ආදරේ", "ආදරය", "ප්‍රේම", "love", "heart", "dear"], emoji: "❤️" },
    { keywords: ["හිනා", "සතුටු", "ප්‍රීති", "happy", "joy", "smile", "laugh", "😂"], emoji: "😊" },
    { keywords: ["ගින්දර", "නියමයි", "සුපිරි", "fire", "awesome", "hot", "cool", "super"], emoji: "🔥" },
    { keywords: ["සිංදු", "සංගීත", "ගීත", "නාද", "sing", "song", "music", "melody"], emoji: "🎵" },
    { keywords: ["කෑම", "කන්න", "බඩගිනි", "රස", "food", "eat", "hungry", "pizza", "delicious"], emoji: "🍕" },
    { keywords: ["ලස්සන", "රන්", "දිදුල", "beauty", "sparkle", "gold", "star", "shine"], emoji: "✨" },
    { keywords: ["ලංකා", "lanka", "sri lanka", "සිංහල", "sinhala"], emoji: "🇱🇰" },
    { keywords: ["වාහන", "කාර්", "යන්න", "car", "drive", "travel", "trip", "go"], emoji: "🚗" },
    { keywords: ["සල්ලි", "මුදල්", "ගණන්", "money", "cash", "rich", "dollar"], emoji: "💵" },
    { keywords: ["වැඩ", "පරිගණක", "work", "job", "laptop", "office", "code"], emoji: "💻" },
    { keywords: ["බල්ලා", "පූසා", "සත්තු", "dog", "cat", "pet", "animal"], emoji: "🐶" },
    { keywords: ["හිරු", "දවස", "උදේ", "sun", "morning", "day"], emoji: "☀️" },
    { keywords: ["හඳ", "රෑ", "තරු", "moon", "night", "stars"], emoji: "🌙" },
    { keywords: ["වතුර", "වැස්ස", "මුහුද", "water", "rain", "sea", "ocean", "river"], emoji: "💧" },
    { keywords: ["බය", "තරහ", "කේන්ති", "angry", "scared", "fear", "ghost"], emoji: "😨" },
    { keywords: ["දුක", "අඬන්න", "කණගාටු", "sad", "cry", "pain"], emoji: "😢" },
  ];

  let suggested = "";
  for (const mapping of emojiMappings) {
    if (mapping.keywords.some((kw) => lowercase.includes(kw))) {
      suggested += " " + mapping.emoji;
    }
  }
  return suggested;
}

