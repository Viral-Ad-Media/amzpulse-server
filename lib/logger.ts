import { config } from "../config";

type Level = "debug" | "info" | "warn" | "error";

const serializeError = (err: unknown) => {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      message: err.message,
      stack: config.nodeEnv === "production" ? undefined : err.stack,
    };
  }
  const value = err as Record<string, unknown>;
  return {
    name: value.name,
    code: value.code,
    status: value.status,
    type: value.type,
  };
};

const write = (level: Level, message: string, meta?: Record<string, any>) => {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    service: "amzpulse-api",
    env: config.nodeEnv,
    ...meta,
    ...(meta?.error ? { error: serializeError(meta.error) } : {}),
  };

  const out = JSON.stringify(payload);
  if (level === "error") {
    console.error(out);
  } else if (level === "warn") {
    console.warn(out);
  } else {
    console.log(out);
  }
};

export const logger = {
  debug: (message: string, meta?: Record<string, any>) =>
    write("debug", message, meta),
  info: (message: string, meta?: Record<string, any>) =>
    write("info", message, meta),
  warn: (message: string, meta?: Record<string, any>) =>
    write("warn", message, meta),
  error: (message: string, meta?: Record<string, any>) =>
    write("error", message, meta),
};

export default logger;
