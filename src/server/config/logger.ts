import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { env } from './env';

const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const serverLogPath = path.join(logsDir, 'server.log');
const errorLogPath = path.join(logsDir, 'error.log');

const streams: pino.StreamEntry[] = [
  { stream: pino.destination({ dest: serverLogPath, sync: false }) },
  { level: 'error', stream: pino.destination({ dest: errorLogPath, sync: false }) },
];

if (env.NODE_ENV === 'development') {
  streams.push({
    stream: pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss' },
    }),
  });
} else {
  streams.push({ stream: process.stdout });
}

export const logger = pino(
  {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    base: { pid: process.pid },
  },
  pino.multistream(streams)
);

export const logPaths = {
  logsDir,
  serverLogPath,
  errorLogPath,
};
