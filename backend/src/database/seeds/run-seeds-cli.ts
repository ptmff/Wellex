import { logger } from '../../common/logger';
import { runSeeds } from './run-seeds';

runSeeds()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Seeds failed', { error: err.message, stack: err.stack });
    process.exit(1);
  });
