declare module 'node-cron' {
  export interface ScheduledTask {
    start: () => void;
    stop: () => void;
  }

  export interface ScheduleOptions {
    timezone?: string;
  }

  export function schedule(
    expression: string,
    callback: () => void | Promise<void>,
    options?: ScheduleOptions
  ): ScheduledTask;

  const cron: {
    schedule: typeof schedule;
  };

  export default cron;
}

declare module 'rate-limit-redis' {
  import type { Store, ClientRateLimitInfo } from 'express-rate-limit';

  export interface RateLimitRedisStoreOptions {
    sendCommand?: (...args: any[]) => Promise<unknown>;
    prefix?: string;
  }

  class RateLimitRedisStore implements Store {
    constructor(options?: RateLimitRedisStoreOptions);
    increment(key: string): Promise<ClientRateLimitInfo> | ClientRateLimitInfo;
    decrement(key: string): Promise<void> | void;
    resetKey(key: string): Promise<void> | void;
    resetAll(): Promise<void> | void;
  }

  export = RateLimitRedisStore;
}
