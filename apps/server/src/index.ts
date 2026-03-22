import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { initDb } from "./db/index.ts";
import { startCleanupSchedule } from "./auth/session.ts";
import authRoutes from "./routes/auth.ts";
import magicLinkRoutes from "./routes/magic-link.ts";
import passkeyRoutes from "./routes/passkey.ts";
import jumpdayRoutes from "./routes/jumpdays.ts";
import userRoutes from "./routes/users.ts";

initDb();
startCleanupSchedule();

const app = new Hono();

app.use("*", logger());

if (process.env.NODE_ENV !== "production") {
  app.use(
    "/api/*",
    cors({
      origin: "http://localhost:5173",
      credentials: true,
    }),
  );
}

// API routes
app.route("/api/auth", authRoutes);
app.route("/api/auth/magic-link", magicLinkRoutes);
app.route("/api/auth/passkey", passkeyRoutes);
app.route("/api/jumpdays", jumpdayRoutes);
app.route("/api/users", userRoutes);

// In production, serve the built frontend
if (process.env.NODE_ENV === "production") {
  app.use("*", serveStatic({ root: "./public" }));
  app.use("*", serveStatic({ path: "./public/index.html" }));
}

const port = Number(process.env.PORT) || 3000;
console.log(`Server running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
