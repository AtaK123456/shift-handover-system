import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { aiFailure, createOpenAiAnalyzer, validateAnalysis, type AnalysisInput, type Analyzer } from "../services/ai-analysis.js";

export function createAiRouter(analyzer: Analyzer | null = createOpenAiAnalyzer()) {
  const router = Router();
  router.get("/status", (_req, res) => { res.json({ enabled: Boolean(analyzer) }); });
  const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10,
    keyGenerator: req => String(req.user!.id), standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "AI_RATE_LIMIT" } });
  // Bound simultaneous upstream requests per application instance as well as requests per user.
  let inFlight = 0;
  router.post("/analyze", limit, async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some(key => !["title", "description", "language"].includes(key)) ||
        typeof body.title !== "string" || body.title.length > 160 ||
        typeof body.description !== "string" || !body.description.trim() || body.description.length > 4000 ||
        !["tr", "en"].includes(body.language)) {
      return res.status(400).json({ error: "AI_INVALID_INPUT" });
    }
    if (!analyzer) return res.status(503).json({ error: "AI_DISABLED" });
    if (inFlight >= 3) return res.status(503).json({ error: "AI_BUSY" });
    const input: AnalysisInput = { title: body.title.trim(), description: body.description.trim(), language: body.language };
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const timer = setTimeout(cancel, 22_000);
    res.once("close", cancel);
    inFlight++;
    try {
      const analysis = await analyzer(input, controller.signal);
      res.json({ analysis: validateAnalysis(analysis, input) });
    } catch (error) {
      const failure = controller.signal.aborted ? { error: "AI_TIMEOUT", status: 504 } : aiFailure(error);
      if (!res.destroyed) res.status(failure.status).json({ error: failure.error });
    } finally {
      clearTimeout(timer); res.off("close", cancel); inFlight--;
    }
  });
  return router;
}
