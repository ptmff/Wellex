/**
 * Runs once before the integration project: recreates the public schema of the
 * TEST database and applies the real migration (src/database/migrations/001_initial_schema.ts).
 */
import './env';

export default async function globalSetup(): Promise<void> {
  // Imported lazily so env defaults are applied first.
  const { db } = await import('../../src/database/connection');
  const { runMigrations } = await import('../../src/database/migrations/001_initial_schema');
  await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
  await db.raw('CREATE SCHEMA public');
  await runMigrations();
  await db.destroy();
}
