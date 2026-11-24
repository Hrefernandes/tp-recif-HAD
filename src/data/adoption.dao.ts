import type { Database } from "better-sqlite3";
import type { AdoptionFilters, AdoptionRequest, AdoptionStatus, NewAdoptionRequest } from "../models/adoption-request.js";

type AdoptionRow = {
  id: number;
  fish_id: number;
  adopter_name: string;
  adopter_email: string;
  message: string;
  status: AdoptionStatus;
  created_at: string;
  decided_at: string | null;
};

const toAdoption = (r: AdoptionRow): AdoptionRequest => ({
  id: r.id,
  fishId: r.fish_id,
  adopterName: r.adopter_name,
  adopterEmail: r.adopter_email,
  message: r.message,
  status: r.status,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

export interface AdoptionDao {
  findAll(filters?: AdoptionFilters): Promise<AdoptionRequest[]>;
  findById(id: number): Promise<AdoptionRequest | null>;
  findByFish(fishId: number): Promise<AdoptionRequest[]>;
  create(data: NewAdoptionRequest): Promise<AdoptionRequest>;
  setStatus(id: number, status: AdoptionStatus): Promise<AdoptionRequest>; // retiré à l'étape 6
  deleteByFish(fishId: number): Promise<void>; // retiré à l'étape 6
}

export class SqliteAdoptionDao implements AdoptionDao {
  constructor(private readonly db: Database) {}

  async findAll(filters: AdoptionFilters = {}): Promise<AdoptionRequest[]> {
    const rows = this.db
      .prepare("SELECT * FROM adoption_requests WHERE (@status IS NULL OR status = @status) ORDER BY id")
      .all({ status: filters.status ?? null }) as AdoptionRow[];
    return rows.map(toAdoption);
  }

  async findById(id: number): Promise<AdoptionRequest | null> {
    const row = this.db.prepare("SELECT * FROM adoption_requests WHERE id = ?").get(id) as AdoptionRow | undefined;
    return row ? toAdoption(row) : null;
  }

  async findByFish(fishId: number): Promise<AdoptionRequest[]> {
    const rows = this.db.prepare("SELECT * FROM adoption_requests WHERE fish_id = ? ORDER BY id").all(fishId) as AdoptionRow[];
    return rows.map(toAdoption);
  }

  async create(data: NewAdoptionRequest): Promise<AdoptionRequest> {
    const info = this.db
      .prepare(
        `INSERT INTO adoption_requests (fish_id, adopter_name, adopter_email, message, status, created_at)
         VALUES (?, ?, ?, ?, 'en_attente', ?)`,
      )
      .run(data.fishId, data.adopterName, data.adopterEmail, data.message ?? "", new Date().toISOString());
    return (await this.findById(Number(info.lastInsertRowid)))!;
  }

  async setStatus(id: number, status: AdoptionStatus): Promise<AdoptionRequest> {
    this.db.prepare("UPDATE adoption_requests SET status = ?, decided_at = ? WHERE id = ?").run(status, new Date().toISOString(), id);
    return (await this.findById(id))!;
  }

  async deleteByFish(fishId: number): Promise<void> {
    this.db.prepare("DELETE FROM adoption_requests WHERE fish_id = ?").run(fishId);
  }
}