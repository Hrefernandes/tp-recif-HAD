export type Rule = (value: unknown) => string | null;
export type Schema = Record<string, Rule>;
import { AppError } from "../errors/app-error.js";

export const text = (min: number, max: number): Rule => (value) =>
  typeof value === "string" && value.trim().length >= min && value.trim().length <= max
    ? null
    : `texte de ${min} à ${max} caractères attendu`;

export const oneOf = (values: readonly string[]): Rule => (value) =>
  typeof value === "string" && values.includes(value) ? null : "valeur inconnue";

export const optional = (rule: Rule): Rule => (value) =>
  value === undefined || value === null ? null : rule(value);

export const email: Rule = (value) =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "email invalide";

export const isoDate: Rule = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date AAAA-MM-JJ attendue";
  const date = new Date(`${value}T00:00:00Z`);
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? null : "date inexistante";
};

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: string[] };

export function validate<T = Record<string, any>>(
  schema: Schema,
  input: unknown,
  options: { partial?: boolean } = {},
): ValidationResult<T> {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [field, rule] of Object.entries(schema)) {
    const value = body[field];
    if (value === undefined && options.partial) continue;
    const error = rule(value);
    if (error) errors.push(`${field} : ${error}`);
    else if (value !== undefined) data[field] = typeof value === "string" ? value.trim() : value;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, data: data as T };
}

export function parse<T = Record<string, any>>(schema: Schema, input: unknown, options: { partial?: boolean } = {}): T {
  const result = validate<T>(schema, input, options);
  if (!result.ok) throw new AppError(400, "VALIDATION_ERROR", result.errors.join(" ; "));
  return result.data;
}