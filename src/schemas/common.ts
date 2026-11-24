export function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return typeof raw === "string" && /^\d+$/.test(raw) && Number.isInteger(id) && id > 0 ? id : null;
}