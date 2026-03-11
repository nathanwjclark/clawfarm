import express from "express";
import type { Server } from "node:http";
import type { MemoryBackend } from "./memory-backend.js";

export function registerMemoryBackendRoutes(
  app: ReturnType<typeof express>,
  backend: MemoryBackend,
): void {
  app.post("/memory/search", async (req, res) => {
    try {
      const result = await backend.searchMemory(req.body ?? {});
      res.json({ results: result, provider: "external", model: "clawfarm-backend" });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message, results: [] });
    }
  });

  app.post("/memory/get", async (req, res) => {
    try {
      const result = await backend.readMemory(req.body ?? {});
      res.json(result);
    } catch (err) {
      res.status(400).json({ path: req.body?.path ?? "", text: "", error: (err as Error).message });
    }
  });

  app.post("/memory/write", async (req, res) => {
    try {
      const result = await backend.writeMemory(req.body ?? {});
      res.json(result);
    } catch (err) {
      res.status(400).json({
        ok: false,
        path: req.body?.path ?? "",
        error: (err as Error).message,
      });
    }
  });
}

export class MemoryBackendBridgeServer {
  private server: Server | null = null;
  private baseUrl: string | null = null;

  constructor(private backend: MemoryBackend) {}

  async start(): Promise<string> {
    if (this.baseUrl) {
      return this.baseUrl;
    }

    const app = express();
    app.use(express.json());
    registerMemoryBackendRoutes(app, this.backend);

    await new Promise<void>((resolve) => {
      this.server = app.listen(0, "127.0.0.1", () => resolve());
    });

    const address = this.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    this.baseUrl = `http://127.0.0.1:${port}`;
    return this.baseUrl;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server?.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = null;
    this.baseUrl = null;
  }
}
