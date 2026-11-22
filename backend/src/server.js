#!/usr/bin/env node
// FixIt API. `npm run dev` restarts on changes to src/ or .env; `npm start` for plain runs.
//
// createApp() is exported separately from the startup code so the tests can build the
// app with a throwaway database and a fake geocoder, without opening a port.
//
// The contract: openapi.yaml. express-openapi-validator checks every request against it
// before any route runs (wrong field -> 400 Problem Details), and, outside production,
// every JSON response too, so the code can't drift away from what the contract promises.

import "dotenv/config";
import express from "express";
import multer from "multer";
import * as OpenApiValidator from "express-openapi-validator";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acceptPhotos, describeMulterError } from "./utils/photos.js";
import { fieldErrorsFromValidator, problem } from "./utils/problems.js";
import { initDb, closeDb } from "./db/index.js";
import { NominatimClient, noGeocoder } from "./utils/geocode.js";
import { assertTokenConfig } from "./utils/token.js";
import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";
import propertiesRouter from "./routes/properties.js";
import issuesRouter from "./routes/issues.js";
import teamRouter from "./routes/team.js";
import offersRouter from "./routes/offers.js";
import dashboardRouter from "./routes/dashboard.js";

export const OPENAPI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "openapi.yaml");

/**
 * @param {{ geocoder?: object, logError?: Function, validateResponses?: boolean }} options
 *   validateResponses: check every JSON response against the contract. On by default
 *   outside production (a mismatch is a bug: it fails loudly as a 500).
 */
export function createApp({ geocoder = noGeocoder, logError = console.error, validateResponses = process.env.NODE_ENV !== "production" } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  // Photo uploads are multipart/form-data. Parse them BEFORE the contract check, so the
  // validator sees the form fields. (multer ignores JSON requests.)
  app.post(["/api/issues", "/api/issues/:issueId/comments"], acceptPhotos);

  // Some POSTs have an OPTIONAL body (e.g. accepting an offer, with or without a
  // message). A request that sends no body at all is valid by the contract, but the
  // validator would answer 415 because there's no Content-Type. Treat "no body" as an
  // empty JSON object, which is exactly what the contract allows.
  app.use((req, _res, next) => {
    const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"];
    if (["POST", "PATCH", "PUT"].includes(req.method) && !hasBody && !req.headers["content-type"]) {
      req.headers["content-type"] = "application/json";
      req.body = {};
    }
    next();
  });

  app.use(
    OpenApiValidator.middleware({
      apiSpec: OPENAPI_PATH,
      validateRequests: { allErrors: true, removeAdditional: false },
      validateResponses: validateResponses ? { removeAdditional: false } : false,
      validateFormats: true,
      ignoreUndocumented: false, // a route that isn't in the contract doesn't exist: 404
      fileUploader: false, // multer above already did it, with our limits and checks
    }),
  );

  app.use("/api/health", healthRouter({ geocoder }));
  app.use("/api/auth", authRouter);
  app.use("/api/properties", propertiesRouter({ geocoder }));
  app.use("/api/issues", issuesRouter);
  app.use("/api/team", teamRouter);
  app.use("/api/offers", offersRouter);
  app.use("/api/dashboard", dashboardRouter);

  // Express 5 sends errors thrown in async handlers here automatically.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const instance = req.originalUrl.split("?")[0];
    let status = 500;
    let body;

    if (err.type === "entity.parse.failed") {
      status = 400;
      body = problem(400, { detail: "the request body is not valid JSON", instance });
    } else if (err instanceof multer.MulterError) {
      status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      body = problem(status, { detail: describeMulterError(err), instance });
    } else if (Array.isArray(err.errors) && err.status && err.status < 500) {
      // From the contract validator.
      status = err.status;
      const errors = status === 400 ? fieldErrorsFromValidator(err.errors) : undefined;
      const detail = errors ? errors.map((e) => `${e.field}: ${e.message}`).join("; ") : err.message;
      body = problem(status, { detail, errors, instance });
    } else if (err.status && err.status < 500) {
      // Our own HttpErrors (utils/errors.js).
      status = err.status;
      body = problem(status, { detail: err.message, errors: err.details, slug: err.slug, instance });
    } else {
      logError(err);
      body = problem(500, { instance });
    }

    res.status(status).type("application/problem+json");
    // A 500 isn't declared per operation in the contract, so send it without response
    // validation (which would only replace this 500 with another one).
    if (status >= 500) return res.send(JSON.stringify(body));
    return res.json(body);
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
