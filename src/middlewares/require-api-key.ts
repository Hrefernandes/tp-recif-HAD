import type { RequestHandler } from "express";
import { config } from "../config.js";
import { AppError } from "../errors/app-error.js";

export const requireApiKey: RequestHandler = (req, _res, next) => {
  if (req.get("X-Api-Key") !== config.adminApiKey) {
    return next(new AppError(401, "UNAUTHORIZED", "Clé d'API manquante ou invalide"));
  }
  next();
};