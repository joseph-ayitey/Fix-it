#!/usr/bin/env node
// FixIt API. `npm run dev` restarts on changes to src/ or .env; `npm start` for plain runs.
//
// createApp() is exported separately from the startup code so the tests can build the
// app with an in-memory database and a fake geocoder, without opening a port or
// reading .env.

import "dotenv/config";
import express from "express";
import multer from "multer";
import { pathToFileURL } from "node:url";
import { describeMulterError } from "./utils/photos.js";
import { initDb, closeDb } from "./db/index.js";
import { NominatimClient, noGeocoder } from "./utils/geocode.js";
import { assertTokenConfig } from "./utils/token.js";
import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";
import propertiesRouter from "./routes/properties.js";
import issuesRouter from "./routes/issues.js";
import teamRouter from "./routes/team.js";
import offersRouter from "./routes/offers.js";

export function createApp({ geocoder = noGeocoder, logError = console.error } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.use("/api/health", healthRouter({ geocoder }));
  app.use("/api/auth", authRouter);
  app.use("/api/properties", propertiesRouter({ geocoder }));
  app.use("/api/issues", issuesRouter);
  app.use("/api/team", teamRouter);
  app.use("/api/offers", offersRouter);

  app.use("/api", (_req, res) => res.status(404).json({ error: { message: "no such endpoint" } }));

  // Express 5 sends errors thrown in async handlers here automatically.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: { message: "request body is not valid JSON" } });
    }
    if (err instanceof multer.MulterError) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({ error: { message: describeMulterError(err) } });
    }
    if (err.status && err.status < 500) {
      return res.status(err.status).json({ error: { message: err.message, ...(err.details ? { details: err.details } : {}) } });
    }
    logError(err);
    return res.status(500).json({ error: { message: "internal server error" } });
  });

  return app;
}

async function main() {
  const { PORT = "3000", NOMINATIM_USER_AGENT, GEOCODE_LANGUAGE = "en", PGHOST, PGPORT } = process.env;

  // Fail fast with a clear message. Under `npm run dev`, a failed start is followed by
  // "Waiting for file changes before restarting...", so the line above it must say why.
  try {
    assertTokenConfig();
  } catch (err) {
    console.error(`${err.message} Run \`cp .env.example .env\` in backend/ and fill it in.`);
    process.exit(1);
  }

  let geocoder = noGeocoder;
  if (NOMINATIM_USER_AGENT) {
    // ONE client per process: its rate limiter must be shared by every request.
    geocoder = new NominatimClient({ userAgent: NOMINATIM_USER_AGENT, language: GEOCODE_LANGUAGE });
  } else {
    console.warn("NOMINATIM_USER_AGENT not set: properties will be saved without map locations.");
  }

  // Connect and apply pending migrations before accepting any request.
  try {
    await initDb();
  } catch (err) {
    const unreachable = ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(err.code) || err.code === "57P03";
    console.error(
      unreachable
        ? `Can't reach PostgreSQL at ${PGHOST}:${PGPORT}. Start it with \`docker compose up -d db\` in backend/.`
        : err.code === "28P01"
          ? "PostgreSQL rejected the password in .env (PGPASSWORD). See the README's troubleshooting section."
          : `Database setup failed: ${err.message}`,
    );
    process.exit(1);
  }

  const app = createApp({ geocoder });

  const server = app.listen(Number(PORT), () => {
    console.log(`FixIt API listening on http://localhost:${PORT}/api`);
  });
  server.on("error", (err) => {
    console.error(err.code === "EADDRINUSE" ? `Port ${PORT} is already in use. Stop the other server or change PORT in .env.` : err);
    process.exit(1);
  });

  const shutdown = () =>
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
