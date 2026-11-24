import express from "express";
import { db } from "./data/db.js";
import { SqliteFishDao } from "./data/fish.dao.js";
import { SqliteAdoptionDao } from "./data/adoption.dao.js";
import type { FishFilters, NewFish } from "./models/fish.js";
import type { AdoptionFilters } from "./models/adoption-request.js";
import { parse } from "./schemas/validation.js";
import { fishSchema } from "./schemas/fish.schema.js";
import { adoptionSchema } from "./schemas/adoption.schema.js";
import { parseId } from "./schemas/common.js";
import { AppError } from "./errors/app-error.js";
import { requireApiKey } from "./middlewares/require-api-key.js";
import { notFound } from "./middlewares/not-found.js";
import { errorHandler } from "./middlewares/error-handler.js";

export function createApp() {
  const app = express();
  app.use(express.json());

  // Les DAO : plus aucune requête SQL dans les routes
  const fishDao = new SqliteFishDao(db);
  const adoptionDao = new SqliteAdoptionDao(db);

  // ---------------------------------------------------------------- POISSONS

  app.get("/fish", async (req, res) => {
    res.json(await fishDao.findAll(req.query as FishFilters));
  });

  app.get("/fish/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const fish = await fishDao.findById(id);
    if (!fish) throw new AppError(404, "NOT_FOUND", `Fish ${id} introuvable`);
    res.json({ ...fish, requests: await adoptionDao.findByFish(id) });
  });

  app.post("/fish", requireApiKey, async (req, res) => {
    res.status(201).json(await fishDao.create(parse<NewFish>(fishSchema, req.body)));
  });

  app.put("/fish/:id", requireApiKey, async (req, res) => {
    const id = parseId(req.params.id);
    const changes = parse(fishSchema, req.body, { partial: true });
    const fish = await fishDao.update(id, changes);
    if (!fish) throw new AppError(404, "NOT_FOUND", `Fish ${id} introuvable`);
    res.json(fish);
  });

  app.delete("/fish/:id", requireApiKey, async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await fishDao.findById(id))) throw new AppError(404, "NOT_FOUND", `Fish ${id} introuvable`);
    await adoptionDao.deleteByFish(id);
    await fishDao.delete(id);
    res.status(204).end();
  });

  // ---------------------------------------------------------------- ADOPTIONS

  app.post("/fish/:id/adoptions", async (req, res) => {
    const id = parseId(req.params.id);
    const b = parse(adoptionSchema, req.body);
    const fish = await fishDao.findById(id);
    if (!fish) throw new AppError(404, "NOT_FOUND", `Fish ${id} introuvable`);
    if (fish.status !== "disponible") throw new AppError(409, "CONFLICT", "Ce poisson n'est plus disponible");
    // Deux DAO à la suite : c'est normal à ce stade (corrigé à l'étape 6)
    const request = await adoptionDao.create({ fishId: id, adopterName: b.adopterName, adopterEmail: b.adopterEmail, message: b.message });
    await fishDao.updateStatus(id, "reserve");
    res.status(201).json(request);
  });

  app.get("/adoptions", requireApiKey, async (req, res) => {
    res.json(await adoptionDao.findAll(req.query as AdoptionFilters));
  });

  function decide(decision: "acceptee" | "refusee"): express.RequestHandler {
    const fishStatus = decision === "acceptee" ? "adopte" : "disponible";
    return async (req, res) => {
      const id = parseId(req.params.id);
      const request = await adoptionDao.findById(id);
      if (!request) throw new AppError(404, "NOT_FOUND", `Demande ${id} introuvable`);
      if (request.status !== "en_attente") throw new AppError(409, "CONFLICT", "Demande déjà traitée");
      const updated = await adoptionDao.setStatus(id, decision);
      await fishDao.updateStatus(request.fishId, fishStatus);
      res.json(updated);
    };
  }

  app.post("/adoptions/:id/accept", requireApiKey, decide("acceptee"));
  app.post("/adoptions/:id/refuse", requireApiKey, decide("refusee"));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}