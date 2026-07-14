import { CaptionSegment, CaptionStyle, WordTiming } from "../types";

/**
 * Draws a subtitle frame on any canvas context.
 * This is a pure function of state and time, meaning it can be run in the main thread
 * (for the real-time preview) and in the Web Codecs exporter worker.
 */
export function drawCaptionsOnCanvas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  currentTime: number,
  segments: CaptionSegment[],
  style: CaptionStyle,
  showTranslation = false,
  isPro = false,
  scaleFactor = 1
) {
  // Clear context or let the caller handle it (we draw over)
  // Usually, the caller draws the video frame first, then calls us.

  // 1. Draw Watermark if Free Tier
  if (!isPro) {
    ctx.save();
    ctx.font = `bold ${Math.max(12, canvasHeight * 0.022)}px "Inter", sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("OmniCap Free", canvasWidth - Math.max(16, canvasWidth * 0.03), canvasHeight - Math.max(16, canvasHeight * 0.03));
    ctx.restore();
  }

  // 2. Find the active subtitle segment
  const activeSegment = segments.find(
    (seg) => currentTime >= seg.start && currentTime <= seg.end
  );

  if (!activeSegment) {
    return;
  }

  // Use translated text if toggled, otherwise original Sinhala text
  let rawText = showTranslation
    ? activeSegment.translatedText || activeSegment.text
    : activeSegment.text;

  if (style.textTransform === "uppercase") {
    rawText = rawText.toUpperCase();
  }

  // Split text into words and map them to segment words
  // If we are showing translation and don't have word timings, we split translation words
  const wordsList = rawText.split(/\s+/).filter((w) => w.length > 0);
  if (wordsList.length === 0) return;

  // Align words with proportional timings
  let words: WordTiming[] = [];
  if (showTranslation && activeSegment.translatedText) {
    // Generate fresh timings for translated words on-the-fly
    const duration = activeSegment.end - activeSegment.start;
    const wordLengths = wordsList.map((w) => w.length);
    const totalChars = wordLengths.reduce((s, l) => s + l, 0);
    let currentStart = activeSegment.start;

    words = wordsList.map((wordText, idx) => {
      const wordLen = wordLengths[idx];
      const wordDur = totalChars > 0 ? (wordLen / totalChars) * duration : duration / wordsList.length;
      const wordEnd = currentStart + wordDur;
      const t = {
        text: wordText,
        start: currentStart,
        end: Math.min(activeSegment.end, wordEnd),
      };
      currentStart = wordEnd;
      return t;
    });
  } else {
    // Use the segment's existing timings
    words = activeSegment.words.map((w, idx) => ({
      text: style.textTransform === "uppercase" ? w.text.toUpperCase() : w.text,
      start: w.start,
      end: w.end,
    }));
  }

  // Scale font size according to the canvas resolution dynamically!
  // Reference width is 640px, so 24px font on 640px video scales to 48px on 1280px video.
  const scale = (canvasWidth / 640) * scaleFactor;
  const fontSize = style.fontSize * scale;
  const outlineWidth = style.outlineWidth * scale;
  const letterSpacing = style.letterSpacing * scale;
  const shadowBlur = style.shadowBlur * scale;
  const shadowOffsetX = style.shadowOffsetX * scale;
  const shadowOffsetY = style.shadowOffsetY * scale;

  ctx.save();

  // Set default drawing settings
  ctx.font = `bold ${fontSize}px "${style.fontFamily}", "Inter", "sans-serif"`;
  ctx.textBaseline = "middle";

  // Segment overall animations (like slide/scale of the whole subtitle box on segment change)
  const segmentDuration = activeSegment.end - activeSegment.start;
  const elapsedSegment = currentTime - activeSegment.start;
  let segmentScale = 1;
  let segmentAlpha = 1;

  if (style.animationStyle === "scale") {
    // Scale in from 0 to 1 in the first 250ms
    const scaleProgress = Math.min(1, elapsedSegment / 0.25);
    // Elastic ease out
    segmentScale = scaleProgress === 1 ? 1 : 1 - Math.pow(2, -10 * scaleProgress);
  }

  // Identify active word index
  const activeWordIdx = words.findIndex(
    (w) => currentTime >= w.start && currentTime <= w.end
  );

  // --- RENDERING MODE 1: Centered Single Word (TikTok Style) ---
  if (style.animationStyle === "centeredWord") {
    const activeWord = activeWordIdx !== -1 ? words[activeWordIdx] : words[0];
    if (!activeWord) {
      ctx.restore();
      return;
    }

    ctx.save();
    
    // Position at middle
    let targetX = canvasWidth / 2;
    let targetY = canvasHeight / 2 + style.verticalOffset * scale;

    if (style.position === "top" || style.position === "topbar") {
      targetY = canvasHeight * 0.25 + style.verticalOffset * scale;
    } else if (style.position === "bottom") {
      targetY = canvasHeight * 0.75 + style.verticalOffset * scale;
    }

    ctx.translate(targetX, targetY);

    // Apply Pop/Bounce to single centered word
    const wordDuration = activeWord.end - activeWord.start;
    const wordElapsed = currentTime - activeWord.start;
    const ratio = Math.max(0, Math.min(1, wordElapsed / (wordDuration || 0.1)));

    let wordScale = 1.3; // Default larger scale for single word TikTok style
    if (style.animationStyle === "centeredWord") {
      // Elastic pop-in effect
      const popProgress = Math.min(1, wordElapsed / 0.15);
      wordScale *= 1 + 0.25 * Math.sin(popProgress * Math.PI);
    }

    ctx.scale(wordScale, wordScale);

    // Draw single word background pill if active
    if (style.background === "pill") {
      const metrics = ctx.measureText(activeWord.text);
      const textWidth = metrics.width;
      const paddingX = fontSize * 0.5;
      const paddingY = fontSize * 0.3;
      ctx.fillStyle = hexToRgba(style.backgroundColor, style.backgroundOpacity);
      drawRoundedRect(
        ctx,
        -textWidth / 2 - paddingX,
        -fontSize * 0.5 - paddingY,
        textWidth + paddingX * 2,
        fontSize + paddingY * 2,
        fontSize * 0.4
      );
      ctx.fill();
    }

    // Set shadow/stroke
    ctx.shadowColor = style.shadowColor;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = shadowOffsetX;
    ctx.shadowOffsetY = shadowOffsetY;

    ctx.strokeStyle = style.outlineColor;
    ctx.lineWidth = outlineWidth;
    ctx.lineJoin = "round";

    // Premium metallic gradient or solid color fill
    if (style.textFillType === "gradient-gold") {
      const gradient = ctx.createLinearGradient(-30, -fontSize * 0.4, 30, fontSize * 0.4);
      gradient.addColorStop(0, "#FFE082");
      gradient.addColorStop(0.3, "#FFD54F");
      gradient.addColorStop(0.5, "#FFC107");
      gradient.addColorStop(0.75, "#FFB300");
      gradient.addColorStop(1, "#FFA000");
      ctx.fillStyle = gradient;
    } else if (style.textFillType === "gradient-chrome") {
      const gradient = ctx.createLinearGradient(-30, -fontSize * 0.4, 30, fontSize * 0.4);
      gradient.addColorStop(0, "#F3F4F6");
      gradient.addColorStop(0.2, "#D1D5DB");
      gradient.addColorStop(0.4, "#9CA3AF");
      gradient.addColorStop(0.5, "#4B5563");
      gradient.addColorStop(0.6, "#9CA3AF");
      gradient.addColorStop(0.8, "#E5E7EB");
      gradient.addColorStop(1, "#FFFFFF");
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = style.activeColor;
    }
    ctx.textAlign = "center";

    // Render text with specific premium styles if active
    if ((style.animationStyle as string) === "neonGlow") {
      ctx.save();
      ctx.shadowColor = style.activeColor || "#39FF14";
      for (let g = 1; g <= 3; g++) {
        ctx.shadowBlur = g * 12 * scale;
        if (outlineWidth > 0) {
          ctx.strokeText(activeWord.text, 0, 0);
        }
        ctx.fillText(activeWord.text, 0, 0);
      }
      ctx.restore();
    } else if ((style.animationStyle as string) === "glitch") {
      const jitterX = (Math.random() - 0.5) * 6 * scale;
      const jitterY = (Math.random() - 0.5) * 6 * scale;
      ctx.save();
      ctx.fillStyle = "rgba(0, 255, 255, 0.75)";
      ctx.fillText(activeWord.text, jitterX, jitterY);
      ctx.fillStyle = "rgba(255, 0, 0, 0.75)";
      ctx.fillText(activeWord.text, -jitterX, -jitterY);
      ctx.restore();
      ctx.fillText(activeWord.text, jitterX * 0.3, jitterY * 0.3);
    } else if ((style.animationStyle as string) === "lightSweep") {
      const sweepGradient = ctx.createLinearGradient(-50 + ratio * 100, -fontSize * 0.5, -50 + ratio * 100 + 40, fontSize * 0.5);
      sweepGradient.addColorStop(0, style.activeColor);
      sweepGradient.addColorStop(0.4, style.activeColor);
      sweepGradient.addColorStop(0.5, "#FFFFFF");
      sweepGradient.addColorStop(0.6, style.activeColor);
      sweepGradient.addColorStop(1, style.activeColor);
      ctx.fillStyle = sweepGradient;
      if (outlineWidth > 0) {
        ctx.strokeText(activeWord.text, 0, 0);
      }
      ctx.fillText(activeWord.text, 0, 0);
    } else {
      if (outlineWidth > 0) {
        ctx.strokeText(activeWord.text, 0, 0);
      }
      ctx.fillText(activeWord.text, 0, 0);
    }

    ctx.restore();
    ctx.restore();
    return;
  }

  // --- RENDERING MODE 2: Full Multiline Text Layout ---

  // Measure word widths and assemble lines
  const spaceWidth = ctx.measureText(" ").width + letterSpacing;
  const maxLineWidth = canvasWidth * 0.85; // safe margin

  interface MeasuredWord {
    text: string;
    width: number;
    wordRef: WordTiming;
    originalIndex: number;
  }

  const measuredWords: MeasuredWord[] = words.map((w, i) => ({
    text: w.text,
    width: ctx.measureText(w.text).width + letterSpacing,
    wordRef: w,
    originalIndex: i,
  }));

  interface Line {
    words: MeasuredWord[];
    width: number;
  }

  const lines: Line[] = [];
  let currentLineWords: MeasuredWord[] = [];
  let currentLineWidth = 0;

  for (const mWord of measuredWords) {
    if (currentLineWords.length > 0 && currentLineWidth + mWord.width > maxLineWidth) {
      lines.push({
        words: currentLineWords,
        width: currentLineWidth - letterSpacing,
      });
      currentLineWords = [mWord];
      currentLineWidth = mWord.width + spaceWidth;
    } else {
      currentLineWords.push(mWord);
      currentLineWidth += mWord.width + spaceWidth;
    }
  }
  if (currentLineWords.length > 0) {
    lines.push({
      words: currentLineWords,
      width: currentLineWidth - letterSpacing,
    });
  }

  // Calculate text block height
  const lineSpacing = style.lineHeight * fontSize;
  const textBlockHeight = lines.length * lineSpacing;

  // Determine starting Y position based on position style
  let blockStartY = 0;
  if (style.position === "top" || style.position === "topbar") {
    blockStartY = canvasHeight * 0.15 + style.verticalOffset * scale;
  } else if (style.position === "center") {
    blockStartY = (canvasHeight - textBlockHeight) / 2 + style.verticalOffset * scale;
  } else {
    // bottom
    blockStartY = canvasHeight * 0.82 - textBlockHeight + style.verticalOffset * scale;
  }

  // Render overall background bar
  if (style.background === "bar") {
    ctx.fillStyle = hexToRgba(style.backgroundColor, style.backgroundOpacity);
    ctx.fillRect(0, blockStartY - fontSize * 0.4, canvasWidth, textBlockHeight + fontSize * 0.2);
  }

  // Render lines and words
  lines.forEach((line, lineIdx) => {
    const lineY = blockStartY + lineIdx * lineSpacing + lineSpacing / 2;
    const lineXStart = (canvasWidth - line.width) / 2;

    // Background pill behind the whole active line
    if (style.background === "pill") {
      ctx.save();
      ctx.fillStyle = hexToRgba(style.backgroundColor, style.backgroundOpacity);
      const pillPadX = fontSize * 0.4;
      const pillPadY = fontSize * 0.2;
      drawRoundedRect(
        ctx,
        lineXStart - pillPadX,
        lineY - fontSize * 0.6 - pillPadY,
        line.width + pillPadX * 2,
        fontSize * 1.2 + pillPadY * 2,
        fontSize * 0.4
      );
      ctx.fill();
      ctx.restore();
    }

    let currentX = lineXStart;

    line.words.forEach((mWord) => {
      const isWordActive = mWord.originalIndex === activeWordIdx;
      const isWordPast = activeWordIdx !== -1 && mWord.originalIndex < activeWordIdx;
      const wordCenterY = lineY;
      const wordCenterX = currentX + mWord.width / 2;

      ctx.save();

      // Core alignment for rotation / scaling
      ctx.translate(wordCenterX, wordCenterY);

      // Apply Segment Scale animation (Elastic appearance)
      if (segmentScale !== 1) {
        ctx.scale(segmentScale, segmentScale);
      }

      // Word level animations
      const wordElapsed = currentTime - mWord.wordRef.start;
      const wordDuration = mWord.wordRef.end - mWord.wordRef.start;
      const r = Math.max(0, Math.min(1, wordElapsed / (wordDuration || 0.1)));

      if (isWordActive) {
        // 1. POP style (elastic grow when active)
        if (style.animationStyle === "pop") {
          const popFactor = 1 + 0.15 * Math.sin(r * Math.PI);
          ctx.scale(popFactor, popFactor);
        }

        // 2. BOUNCE style (sine wave jump upward)
        if (style.animationStyle === "bounce") {
          const bounceOffset = -Math.max(0, Math.sin(r * Math.PI)) * (fontSize * 0.35);
          ctx.translate(0, bounceOffset);
        }

        // 3. GLOW style (shadow/neon effect)
        if (style.animationStyle === "glow") {
          ctx.shadowColor = style.activeColor;
          ctx.shadowBlur = 15 * scale;
        }

        // 4. SHAKE style (small visual jitter)
        if (style.animationStyle === "shake") {
          const jitterX = (Math.random() - 0.5) * 5 * scale;
          const jitterY = (Math.random() - 0.5) * 5 * scale;
          ctx.translate(jitterX, jitterY);
        }

        // 5. SLIDE style (slide up and settle)
        if (style.animationStyle === "slide") {
          const slideProgress = Math.min(1, wordElapsed / 0.15);
          const slideOffset = (1 - slideProgress) * 12 * scale;
          ctx.translate(0, slideOffset);
          ctx.globalAlpha = slideProgress;
        }

        // 6. ZOOM style (zoom-in from 0 to 1)
        if (style.animationStyle === "zoom") {
          const zoomProgress = Math.min(1, wordElapsed / 0.12);
          ctx.scale(zoomProgress, zoomProgress);
        }

        // 7. UNDERLINE POP style
        if (style.animationStyle === "underlinePop") {
          const popFactor = 1 + 0.12 * Math.sin(r * Math.PI);
          ctx.scale(popFactor, popFactor);
        }

        // 8. GLITCH style (jitter)
        if (style.animationStyle === "glitch") {
          const jitterX = (Math.random() - 0.5) * 5 * scale;
          const jitterY = (Math.random() - 0.5) * 5 * scale;
          ctx.translate(jitterX * 0.3, jitterY * 0.3);
        }
      }

      // FADE style (dim inactive words, fully light active/past words)
      if (style.animationStyle === "fade") {
        if (!isWordActive && !isWordPast) {
          ctx.globalAlpha = 0.35;
        } else if (isWordActive) {
          ctx.globalAlpha = 0.35 + 0.65 * r;
        }
      }

      // TYPEWRITER style (only show chars sequentially)
      let textToDraw = mWord.text;
      if (style.animationStyle === "typewriter" && isWordActive) {
        const charCount = mWord.text.length;
        const visibleChars = Math.ceil(r * charCount);
        textToDraw = mWord.text.substring(0, visibleChars);
      }

      // Rounded pill highlights for active word on 'highlight' mode
      if (style.animationStyle === "highlight" && isWordActive) {
        ctx.save();
        ctx.fillStyle = hexToRgba(style.activeColor, 0.25);
        const padX = fontSize * 0.25;
        const padY = fontSize * 0.1;
        drawRoundedRect(
          ctx,
          -mWord.width / 2 - padX,
          -fontSize * 0.55 - padY,
          mWord.width + padX * 2,
          fontSize * 1.1 + padY * 2,
          fontSize * 0.2
        );
        ctx.fill();
        ctx.restore();
      }

      // Apply Shadows
      ctx.shadowColor = style.shadowColor;
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetX = shadowOffsetX;
      ctx.shadowOffsetY = shadowOffsetY;

      // Color selection (active vs default)
      let wordFillColor = style.textColor;
      if (isWordActive || isWordPast) {
        wordFillColor = style.activeColor;
      }

      ctx.fillStyle = wordFillColor;

      // Handle premium linear gradients for filled active/past words
      let useGradient = (isWordActive || isWordPast) && style.textFillType && style.textFillType !== "solid";
      let textGradient: CanvasGradient | null = null;
      if (useGradient) {
        textGradient = ctx.createLinearGradient(-mWord.width / 2, -fontSize * 0.4, mWord.width / 2, fontSize * 0.4);
        if (style.textFillType === "gradient-gold") {
          textGradient.addColorStop(0, "#FFE082");
          textGradient.addColorStop(0.3, "#FFD54F");
          textGradient.addColorStop(0.5, "#FFC107");
          textGradient.addColorStop(0.75, "#FFB300");
          textGradient.addColorStop(1, "#FFA000");
        } else if (style.textFillType === "gradient-chrome") {
          textGradient.addColorStop(0, "#F3F4F6");
          textGradient.addColorStop(0.2, "#D1D5DB");
          textGradient.addColorStop(0.4, "#9CA3AF");
          textGradient.addColorStop(0.5, "#4B5563");
          textGradient.addColorStop(0.6, "#9CA3AF");
          textGradient.addColorStop(0.8, "#E5E7EB");
          textGradient.addColorStop(1, "#FFFFFF");
        }
        ctx.fillStyle = textGradient;
      }

      // Apply Light Sweep style for active word
      if (style.animationStyle === "lightSweep" && isWordActive) {
        const startX = -mWord.width + r * 2 * mWord.width;
        const sweepGradient = ctx.createLinearGradient(startX, -fontSize * 0.5, startX + mWord.width, fontSize * 0.5);
        sweepGradient.addColorStop(0, style.activeColor);
        sweepGradient.addColorStop(0.4, style.activeColor);
        sweepGradient.addColorStop(0.5, "#FFFFFF"); // white shine sweep
        sweepGradient.addColorStop(0.6, style.activeColor);
        sweepGradient.addColorStop(1, style.activeColor);
        ctx.fillStyle = sweepGradient;
      }

      ctx.textAlign = "center";

      // Draw stroke outline
      if (outlineWidth > 0) {
        ctx.strokeStyle = style.outlineColor;
        ctx.lineWidth = outlineWidth;
        ctx.lineJoin = "round";
        ctx.strokeText(textToDraw, 0, 0);
      }

      // Custom high-performance premium rendering
      if (style.animationStyle === "neonGlow" && isWordActive) {
        ctx.save();
        ctx.shadowColor = style.activeColor || "#39FF14";
        for (let g = 1; g <= 3; g++) {
          ctx.shadowBlur = g * 12 * scale;
          if (outlineWidth > 0) {
            ctx.strokeStyle = style.outlineColor;
            ctx.lineWidth = outlineWidth;
            ctx.strokeText(textToDraw, 0, 0);
          }
          ctx.fillText(textToDraw, 0, 0);
        }
        ctx.restore();
      } else if (style.animationStyle === "glitch" && isWordActive) {
        const jitterX = (Math.random() - 0.5) * 5 * scale;
        const jitterY = (Math.random() - 0.5) * 5 * scale;
        ctx.save();
        ctx.fillStyle = "rgba(0, 255, 255, 0.75)";
        ctx.fillText(textToDraw, jitterX, jitterY);
        ctx.fillStyle = "rgba(255, 0, 0, 0.75)";
        ctx.fillText(textToDraw, -jitterX, -jitterY);
        ctx.restore();
        ctx.fillText(textToDraw, 0, 0);
      } else {
        // Draw fill text
        if (style.animationStyle === "karaoke" && isWordActive) {
          // Progressive karaoke wipe effect!
          ctx.fillStyle = style.textColor;
          ctx.fillText(textToDraw, 0, 0);

          ctx.save();
          if (useGradient && textGradient) {
            ctx.fillStyle = textGradient;
          } else {
            ctx.fillStyle = style.activeColor;
          }
          const widthToClip = mWord.width * r;
          ctx.beginPath();
          ctx.rect(-mWord.width / 2, -fontSize, widthToClip, fontSize * 2);
          ctx.clip();

          if (outlineWidth > 0) {
            ctx.strokeText(textToDraw, 0, 0);
          }
          ctx.fillText(textToDraw, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(textToDraw, 0, 0);
        }

        // Underline Pop line drawing
        if (style.animationStyle === "underlinePop" && isWordActive) {
          ctx.save();
          const popFactor = 1 + 0.15 * Math.sin(r * Math.PI);
          ctx.scale(popFactor, popFactor);
          ctx.strokeStyle = style.activeColor;
          ctx.lineWidth = 3 * scale;
          ctx.beginPath();
          ctx.moveTo(-mWord.width / 2, fontSize * 0.6);
          ctx.lineTo(mWord.width / 2, fontSize * 0.6);
          ctx.stroke();
          ctx.restore();
        }
      }

      ctx.restore();
      currentX += mWord.width + spaceWidth;
    });
  });

  ctx.restore();
}

/**
 * Helper to convert HEX to RGBA
 */
function hexToRgba(hex: string, alpha: number): string {
  let c = hex.replace("#", "");
  if (c.length === 3) {
    c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  }
  const r = parseInt(c.substring(0, 2), 16) || 0;
  const g = parseInt(c.substring(2, 4), 16) || 0;
  const b = parseInt(c.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Draw rounded rectangle on context
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
