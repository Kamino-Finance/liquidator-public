import fs from 'fs';
import logger from 'services/logger';

export function readSecret(secretName) {
  const path = process.env.SECRET_PATH || `/run/secrets/${secretName}`;
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.error(
        `An error occurred while trying to read the secret path: ${path}. Err: ${err}`,
      );
    } else {
      logger.error(`Could not find the secret,: ${secretName}. Err: ${err}`);
    }
    return '';
  }
}
