import { runMigrations } from './migrations/001_initial_schema';
import { checkDatabaseConnection } from './connection';
import { logger } from '../common/logger';

async function main() {
  await checkDatabaseConnection();
  await runMigrations();
  logger.info('All migrations completed successfully');
  process.exit(0);
}

main().catch((err) => {
  logger.error('Migration failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
