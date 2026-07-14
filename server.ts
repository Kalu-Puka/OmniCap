import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // Initialize Google Gen AI
  const apiKey = process.env.GEMINI_API_KEY;
  let ai: GoogleGenAI | null = null;

  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }

  // API Route for caption translation
  app.post("/api/translate", async (req, res) => {
    try {
      if (!ai) {
        return res.status(500).json({
          error: "Gemini API is not configured on the server. Please set GEMINI_API_KEY.",
        });
      }

      const { segments } = req.body;
      if (!segments || !Array.isArray(segments)) {
        return res.status(400).json({ error: "Invalid request. Expected 'segments' array." });
      }

      if (segments.length === 0) {
        return res.json({ translatedSegments: [] });
      }

      // Format input segments for prompt
      const segmentsInput = segments.map(s => ({ id: s.id, text: s.text }));

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `You are an expert translator specializing in subtitle translation from Sinhala to English.
Translate the following Sinhala subtitle segments into natural, clear English.
Keep any slang, context, or tone intact. 
Ensure you map each translation to the correct "id" of the input segment.
Do not reorder, merge, or change the IDs under any circumstances.

Input Segments:
${JSON.stringify(segmentsInput, null, 2)}`,
        config: {
          systemInstruction: "You are a professional subtitle translator. You must return translations in the exact requested schema matching the original IDs.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              translatedSegments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    translatedText: { type: Type.STRING, description: "The English translation of the Sinhala text for this segment" }
                  },
                  required: ["id", "translatedText"]
                }
              }
            },
            required: ["translatedSegments"]
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("No translation returned from Gemini model.");
      }

      const result = JSON.parse(responseText.trim());
      res.json(result);
    } catch (error: any) {
      console.error("Translation error:", error);
      res.status(500).json({ error: error.message || "An error occurred during translation" });
    }
  });

  // Serve static files / Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[OmniCap Server] running on http://localhost:${PORT} (${process.env.NODE_ENV || "development"} mode)`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});
