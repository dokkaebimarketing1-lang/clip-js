import {Redis} from '@upstash/redis';

export const createServerRedis = (options: {automaticDeserialization?: boolean} = {}): Redis => {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Upstash Redis REST URL and write token are required.');
  return new Redis({url, token, automaticDeserialization: options.automaticDeserialization});
};
