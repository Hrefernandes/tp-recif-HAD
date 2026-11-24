import { AppError } from "../errors/app-error.js";

export function parseId(raw: unknown): number {
  const id = Number(raw);
  if (typeof raw !== "string" || !/^\d+$/.test(raw) || id <= 0) {
    throw new AppError(400, "VALIDATION_ERROR", `Identifiant invalide : ${String(raw)}`);
  }
  return id;
}