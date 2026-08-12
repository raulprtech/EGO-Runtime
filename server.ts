import express from "express";
import path from "path";
import cors from "cors";
import runtimeRoutes from "./src/api/routes/runtime";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", runtime: "ego-runtime" });
  });

  // API Routes
  app.use("/v1/runtime", runtimeRoutes);
  
  // Also expose at /v1 (if Nigma calls /v1/capabilities directly)
  app.use("/v1", runtimeRoutes);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`EGO Runtime Server running on http://localhost:${PORT}`);
  });
}

startServer();
