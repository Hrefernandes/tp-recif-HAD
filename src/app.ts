import express, { type Request, type Response } from "express";
import { buildWhere } from "./utils/query-helper.js";
import { db } from "./data/db.js";
import { config } from "./config.js";
import { validate } from "./schemas/validation.js";
import { fishSchema } from "./schemas/fish.schema.js";
import { adoptionSchema } from "./schemas/adoption.schema.js";
import { parseId } from "./schemas/common.js";

// DRY : la clé d'API est vérifiée à un seul endroit, à partir de la configuration
function isAdmin(req: Request): boolean {
  return req.get("X-Api-Key") === config.adminApiKey;
}

// DRY : la même réponse 400 pour tous les identifiants invalides
function badId(res: Response) {
  res.status(400).json({ message: "Identifiant invalide" });
}

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

  // ---------------------------------------------------------------- POISSONS

  app.get("/fish", (req, res) => {
    try {
      const filters: any = {};
      if (req.query.species) filters.species = { op: "eq", value: req.query.species };
      if (req.query.status) filters.status = { op: "eq", value: req.query.status };
      const rows = db.prepare("SELECT * FROM fish " + buildWhere(filters) + " ORDER BY id").all();
      res.json(rows);
    } catch (e) {
      console.log(e);
      res.status(500).send("Erreur");
    }
  });

  app.get("/fish/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return badId(res);
    const fish: any = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!fish) {
      res.status(404).send("Poisson introuvable");
      return;
    }
    fish.requests = db.prepare("SELECT * FROM adoption_requests WHERE fish_id = ?").all(id);
    res.json(fish);
  });

  app.post("/fish", express.json(), (req, res) => {
    if (!isAdmin(req)) {
      res.status(401).json({ message: "Non autorisé" });
      return;
    }
    const result = validate(fishSchema, req.body);
    if (!result.ok) {
      res.status(400).json({ message: "Poisson invalide", errors: result.errors });
      return;
    }
    const b = result.data;
    const info = db
      .prepare(
        "INSERT INTO fish (name, species, breed, birth_date, description, internal_notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'disponible', ?)",
      )
      .run(b.name, b.species, b.breed ?? null, b.birthDate ?? null, b.description ?? "", b.internalNotes ?? "", new Date().toISOString());
    const fish = db.prepare("SELECT * FROM fish WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(fish);
  });

  app.put("/fish/:id", express.json(), (req, res) => {
    if (!isAdmin(req)) {
      res.status(401).json({ error: "Clé API manquante" });
      return;
    }
    const id = parseId(req.params.id);
    if (id === null) return badId(res);
    // Le même schéma que la création, en mode « partiel »
    const result = validate(fishSchema, req.body, { partial: true });
    if (!result.ok) {
      res.status(400).json({ error: "Poisson invalide", errors: result.errors });
      return;
    }
    const existing = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "Poisson introuvable" });
      return;
    }
    // Les colonnes viennent des champs validés et de la liste blanche, jamais de req.body
    const fields = Object.keys(result.data);
    if (fields.length > 0) {
      const sets = fields.map((f) => `${FISH_COLUMNS[f]} = ?`).join(", ");
      db.prepare(`UPDATE fish SET ${sets} WHERE id = ?`).run(...fields.map((f) => result.data[f]), id);
    }
    const fish = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    res.json(fish);
  });

  app.delete("/fish/:id", (req, res) => {
    if (!isAdmin(req)) {
      res.status(401).send("Non autorisé");
      return;
    }
    const id = parseId(req.params.id);
    if (id === null) return badId(res);
    const fish = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!fish) {
      res.status(404).json({ message: "Poisson introuvable" });
      return;
    }
    db.prepare("DELETE FROM adoption_requests WHERE fish_id = ?").run(id);
    db.prepare("DELETE FROM fish WHERE id = ?").run(id);
    res.status(204).end();
  });

  // ---------------------------------------------------------------- ADOPTIONS

  app.post("/fish/:id/adoptions", express.json(), (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return badId(res);
    const result = validate(adoptionSchema, req.body);
    if (!result.ok) {
      res.status(400).json({ message: "Demande invalide", errors: result.errors });
      return;
    }
    const b = result.data;
    const fish: any = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!fish) {
      res.status(404).json({ message: "Poisson introuvable" });
      return;
    }
    if (fish.status !== "disponible") {
      res.status(409).json({ error: "Ce poisson n'est plus disponible" });
      return;
    }
    const info = db
      .prepare(
        "INSERT INTO adoption_requests (fish_id, adopter_name, adopter_email, message, status, created_at) VALUES (?, ?, ?, ?, 'en_attente', ?)",
      )
      .run(id, b.adopterName, b.adopterEmail, b.message ?? "", new Date().toISOString());
    db.prepare("UPDATE fish SET status = 'reserve' WHERE id = ?").run(id);
    const request = db.prepare("SELECT * FROM adoption_requests WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(request);
  });

  app.get("/adoptions", (req, res) => {
    if (!isAdmin(req)) {
      res.status(401).json({ message: "Non autorisé" });
      return;
    }
    const filters: any = {};
    if (req.query.status) filters.status = { op: "eq", value: req.query.status };
    const rows = db.prepare("SELECT * FROM adoption_requests " + buildWhere(filters) + " ORDER BY id").all();
    res.json(rows);
  });

  // DRY : accepter et refuser sont une seule fonction, paramétrée par la décision
  function decide(decision: "acceptee" | "refusee") {
    const fishStatus = decision === "acceptee" ? "adopte" : "disponible";
    const verb = decision === "acceptee" ? "acceptée" : "refusée";
    return (req: Request, res: Response) => {
      if (!isAdmin(req)) {
        res.status(401).json({ message: "Non autorisé" });
        return;
      }
      const id = parseId(req.params.id);
      if (id === null) return badId(res);
      const request: any = db.prepare("SELECT * FROM adoption_requests WHERE id = ?").get(id);
      if (!request) {
        res.status(404).json({ message: "Demande introuvable" });
        return;
      }
      if (request.status !== "en_attente") {
        res.status(409).json({ message: "Demande déjà traitée" });
        return;
      }
      db.prepare("UPDATE adoption_requests SET status = ?, decided_at = ? WHERE id = ?").run(decision, new Date().toISOString(), id);
      db.prepare("UPDATE fish SET status = ? WHERE id = ?").run(fishStatus, request.fish_id);
      const updated = db.prepare("SELECT * FROM adoption_requests WHERE id = ?").get(id);
      console.log(`Demande ${id} ${verb}, il faudrait prévenir ${request.adopter_email}`);
      res.json(updated);
    };
  }

  app.post("/adoptions/:id/accept", decide("acceptee"));
  app.post("/adoptions/:id/refuse", decide("refusee"));

  return app;
}