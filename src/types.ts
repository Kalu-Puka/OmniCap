export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface CaptionSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  words: WordTiming[];
  translatedText?: string;
}

export type AnimationStyle =
  | 'none'
  | 'karaoke'
  | 'highlight'
  | 'pop'
  | 'bounce'
  | 'fade'
  | 'glow'
  | 'scale'
  | 'shake'
  | 'slide'
  | 'typewriter'
  | 'zoom'
  | 'centeredWord'
  | 'underlinePop'
  | 'neonGlow'
  | 'glitch'
  | 'lightSweep';

export type BackgroundStyle = 'none' | 'pill' | 'bar';
export type TextTransformStyle = 'none' | 'uppercase';
export type PositionPreset = 'top' | 'topbar' | 'center' | 'bottom';

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number; // in pixels (will scale with canvas)
  letterSpacing: number; // in pixels
  lineHeight: number; // ratio, e.g. 1.2
  textColor: string;
  activeColor: string;
  outlineColor: string;
  outlineWidth: number; // in pixels
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  background: BackgroundStyle;
  backgroundColor: string;
  backgroundOpacity: number; // 0 to 1
  textTransform: TextTransformStyle;
  position: PositionPreset;
  verticalOffset: number; // custom slider offset
  animationStyle: AnimationStyle;
  textFillType?: "solid" | "gradient-gold" | "gradient-chrome";
}

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

export interface StylePreset {
  name: string;
  description: string;
  style: Partial<CaptionStyle>;
  isPro?: boolean;
}

export interface CustomPreset {
  id: string;
  name: string;
  style: CaptionStyle;
}

export interface ModelSizeOption {
  id: 'fast' | 'accurate';
  name: string;
  description: string;
  modelId: string;
}

export interface VideoMetadata {
  name: string;
  duration: number;
  width: number;
  height: number;
}
