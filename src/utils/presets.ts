import { CaptionStyle, StylePreset } from "../types";

export const BUNDLED_FONTS = [
  { name: "Abhaya Libre (Elegant Sinhala)", value: "Abhaya Libre" },
  { name: "Noto Sans Sinhala (Modern Sinhala)", value: "Noto Sans Sinhala" },
  { name: "Noto Serif Sinhala (Classic Sinhala)", value: "Noto Serif Sinhala" },
  { name: "Yatra One (Retro Sinhala)", value: "Yatra One" },
  { name: "Inter (Minimalist Clean)", value: "Inter" },
  { name: "Impact (Bold Memes)", value: "Impact" },
  { name: "Space Grotesk (Tech Display)", value: "Space Grotesk" },
  { name: "JetBrains Mono (Technical)", value: "JetBrains Mono" },
];

export const DEFAULT_STYLE: CaptionStyle = {
  fontFamily: "Noto Sans Sinhala",
  fontSize: 26,
  letterSpacing: 0,
  lineHeight: 1.3,
  textColor: "#FFFFFF",
  activeColor: "#FACC15", // yellow-400
  outlineColor: "#000000",
  outlineWidth: 3,
  shadowColor: "rgba(0,0,0,0.5)",
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  background: "none",
  backgroundColor: "#000000",
  backgroundOpacity: 0.65,
  textTransform: "none",
  position: "bottom",
  verticalOffset: 0,
  animationStyle: "karaoke",
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    name: "Bold Karaoke 🎤",
    description: "High-contrast thick outlines with active yellow word fill swipe.",
    style: {
      fontFamily: "Noto Sans Sinhala",
      fontSize: 28,
      textColor: "#FFFFFF",
      activeColor: "#FFDD00",
      outlineColor: "#000000",
      outlineWidth: 4,
      background: "none",
      animationStyle: "karaoke",
    },
  },
  {
    name: "Minimal Clean ✨",
    description: "Simple clean typography with soft translucent background pill and fade in.",
    style: {
      fontFamily: "Inter",
      fontSize: 22,
      textColor: "#FFFFFF",
      activeColor: "#FFFFFF",
      outlineColor: "#000000",
      outlineWidth: 0,
      background: "pill",
      backgroundColor: "#000000",
      backgroundOpacity: 0.5,
      animationStyle: "fade",
    },
  },
  {
    name: "Big Bounce 🚀",
    description: "Thick playful captions with individual letters jumping up on speaking.",
    style: {
      fontFamily: "Impact",
      fontSize: 32,
      textColor: "#FFFFFF",
      activeColor: "#22C55E", // green-500
      outlineColor: "#000000",
      outlineWidth: 4,
      background: "none",
      animationStyle: "bounce",
    },
  },
  {
    name: "TikTok Word 🔥",
    description: "TikTok/Reels style: Single large centered word popping on beat.",
    style: {
      fontFamily: "Space Grotesk",
      fontSize: 42,
      textColor: "#FFFFFF",
      activeColor: "#FF007F", // bright magenta
      outlineColor: "#000000",
      outlineWidth: 5,
      background: "pill",
      backgroundColor: "#000000",
      backgroundOpacity: 0.8,
      position: "center",
      animationStyle: "centeredWord",
    },
  },
  {
    name: "Retro Glow 📻",
    description: "Vintage aesthetics with a warm orange glow and soft slides.",
    style: {
      fontFamily: "Yatra One",
      fontSize: 26,
      textColor: "#E5E7EB",
      activeColor: "#F97316", // orange-500
      outlineColor: "#451A03",
      outlineWidth: 2,
      background: "none",
      animationStyle: "glow",
    },
  },
];
