import { createLogger, format, transports } from 'winston';
import { randomUUID } from 'crypto';

const sessionId = randomUUID();
const logger = createLogger({
  level: 'info',
  format: format.combine(format.errors({ stack: true }), format.splat(), format.json()),
  defaultMeta: { service: 'kamino-lending-liquidations-bot', session: sessionId },
  transports: [
    process.env.NODE_ENV !== 'production'
      ? new transports.Console({
        format: format.combine(
          format.colorize(),
          format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          format.simple(),
        ),
      })
      : new transports.Console(),
  ],
});

export const logObject = (obj: Object) => {
  logger.info('%O', obj);
};

export default logger;
