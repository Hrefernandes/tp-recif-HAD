import express from "express";
import { buildWhere } from "./utils/query-helper.js";
import { db } from "./data/db.js";
import { parse } from "./schemas/validation.js";
import { fishSchema } from "./schemas/fish.schema.js";
import { adoptionSchema } from "./schemas/adoption.schema.js";
import { parseId } from "./schemas/common.js";
import { AppError } from "./errors/app-error.js";
import { requireApiKey } from "./middlewares/require-api-key.js";
import { notFound } from "./middlewares/not-found.js";
import { errorHandler } from "./middlewares/error-handler.js";

// Liste blanche : champ validé (camelCase) → colonne SQL (snake_case)
const FISH_COLUMNS: Record<string, string> = {
  name: "name",
  species: "species",
  breed: "breed",
  birthDate: "birth_date",
  description: "description",
  internalNotes: "internal_notes",
};

export function createApp() {
  const app = express();
  app.use(express.json()); // une seule fois, avant les routes

  // ---------------------------------------------------------------- POISSONS

  app.get("/fish", (req, res) => {
    const filters: any = {};
    if (req.query.species) filters.species = { op: "eq", value: req.query.species };
    if (req.query.status) filters.status = { op: "eq", value: req.query.status };
    res.json(db.prepare("SELECT * FROM fish " + buildWhere(filters) + " ORDER BY id").all());
  });

  app.get("/fish/:id", (req, res) => {
    const id = parseId(req.params.id);
    const fish: any = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!fish) throw new AppError(404, "NOT_FOUND", `Fish ${id} introuvable`);
    fish.requests = db.prepare("SELECT * FROM adoption_requests WHERE fish_id = ?").all(id);
    res.json(fish);
  });

  app.post("/fish", requireApiKey, (req, res) => {
    const b = parse(fishSchema, req.body);
    const info = db
      .prepare(
        "INSERT INTO fish (name, species, breed, birth_date, description, internal_notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'disponible', ?)",
      )
      .run(b.name, b.species, b.breed ?? null, b.birthDate ?? null, b.description ?? "", b.internalNotes ?? "", new Date().toISOString());
    res.status(201).json(db.prepare("SELECT * FROM fish WHERE id = ?").get(info.lastInsertRowid));
  });

  app.put("/fish/:id", requireApiKey, (req, res) => {
    const id = parseId(req.params.id);
    const changes = parse(fishSchema, req.body, { partial: true });
    if (!db.prepare("SELECT * FROM fish WHERE id = ?").get(id)) throw new AppError(404, "NOT_FOUND", `Fish ${id} introuvable`);
    const fields = Object.keys(changes);
    if (fields.length > 0) {
      const sets = fields.map((f) => `${FISH_COLUMNS[f]} = ?`).join(", ");
      db.prepare(`UPDATE fish SET ${sets} WHERE id = ?`).run(...fields.map((f) => changes[f]), id);
    }
    res.json(db.prepare("SELECT * FROM fish WHERE id = ?").get(id));
  });

  app.delete("/fish/:id", requireApiKey, (req, res) => {
    const id = parseId(req.params.id);
    if (!db.prepare("SELECT * FROM fish WHERE id = ?").get(id)) throw new AppError(404, "NOT_FOUND", `Fish ${id} introuvable`);
    db.prepare("DELETE FROM adoption_requests WHERE fish_id = ?").run(id);
    db.prepare("DELETE FROM fish WHERE id = ?").run(id);
    res.status(204).end();
  });

  // ---------------------------------------------------------------- ADOPTIONS

  app.post("/fish/:id/adoptions", (req, res) => {
    const id = parseId(req.params.id);
    const b = parse(adoptionSchema, req.body);
    const fish: any = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!fish) throw new AppError(404, "NOT_FOUND", `Fish ${id} introuvable`);
    if (fish.status !== "disponible") throw new AppError(409, "CONFLICT", "Ce poisson n'est plus disponible");
    const info = db
      .prepare(
        "INSERT INTO adoption_requests (fish_id, adopter_name, adopter_email, message, status, created_at) VALUES (?, ?, ?, ?, 'en_attente', ?)",
      )
      .run(id, b.adopterName, b.adopterEmail, b.message ?? "", new Date().toISOString());
    db.prepare("UPDATE fish SET status = 'reserve' WHERE id = ?").run(id);
    res.status(201).json(db.prepare("SELECT * FROM adoption_requests WHERE id = ?").get(info.lastInsertRowid));
  });

  app.get("/adoptions", requireApiKey, (req, res) => {
    const filters: any = {};
    if (req.query.status) filters.status = { op: "eq", value: req.query.status };
    res.json(db.prepare("SELECT * FROM adoption_requests " + buildWhere(filters) + " ORDER BY id").all());
  });

  // Accepter et refuser : une seule fonction, paramétrée par la décision
  function decide(decision: "acceptee" | "refusee"): express.RequestHandler {
    const fishStatus = decision === "acceptee" ? "adopte" : "disponible";
    return (req, res) => {
      const id = parseId(req.params.id);
      const request: any = db.prepare("SELECT * FROM adoption_requests WHERE id = ?").get(id);
      if (!request) throw new AppError(404, "NOT_FOUND", `Demande ${id} introuvable`);
      if (request.status !== "en_attente") throw new AppError(409, "CONFLICT", "Demande déjà traitée");
      db.prepare("UPDATE adoption_requests SET status = ?, decided_at = ? WHERE id = ?").run(decision, new Date().toISOString(), id);
      db.prepare("UPDATE fish SET status = ? WHERE id = ?").run(fishStatus, request.fish_id);
      res.json(db.prepare("SELECT * FROM adoption_requests WHERE id = ?").get(id));
    };
  }

  app.post("/adoptions/:id/accept", requireApiKey, decide("acceptee"));
  app.post("/adoptions/:id/refuse", requireApiKey, decide("refusee"));

  // Après toutes les routes : 404, puis le gestionnaire d'erreurs en tout dernier
  app.use(notFound);
  app.use(errorHandler);

  return app;
}