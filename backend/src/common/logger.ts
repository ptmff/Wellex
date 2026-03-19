import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const devFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
  return `${timestamp} [${level}]: ${message}${metaStr}`;
});

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const devConsoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  devFormat
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: config.NODE_ENV === 'production' ? prodFormat : devConsoleFormat,
  }),
];

if (config.NODE_ENV === 'production') {
  transports.push(
    new DailyRotateFile({
      filename: `${config.LOG_DIR}/error-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
      format: prodFormat,
    }),
    new DailyRotateFile({
      filename: `${config.LOG_DIR}/combined-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '7d',
      format: prodFormat,
    })
  );
}

export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  transports,
  exitOnError: false,
});

// Request logger middleware
export function createRequestLogger() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    const { method, url, ip } = req;

    res.on('finish', () => {
      const duration = Date.now() - start;
      const { statusCode } = res;

      const logData = {
        method,
        url,
        statusCode,
        duration,
        ip,
        userId: req.user?.id,
      };

      if (statusCode >= 500) {
        logger.error('Request completed with server error', logData);
      } else if (statusCode >= 400) {
        logger.warn('Request completed with client error', logData);
      } else {
        logger.info('Request completed', logData);
      }
    });

    next();
  };
}
