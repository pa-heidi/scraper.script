/**
 * Winston logger configuration
 */

import * as winston from 'winston';

// Function to get log level dynamically
function getLogLevel(): string {
  return process.env.LOG_LEVEL || 'info';
}

// Create logger with dynamic level
export const logger = winston.createLogger({
  level: getLogLevel(),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ai-scraper-service' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

// If we're not in production, log to the console as well
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    level: getLogLevel(), // Set console level dynamically too
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        // Create a more concise format for development
        const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 0) : '';
        return `${timestamp} [${level}]: ${message} ${metaStr}`;
      })
    )
  }));
}

// Log the current log level for debugging
logger.info(`Logger initialized with level: ${getLogLevel()}`);