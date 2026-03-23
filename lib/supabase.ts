import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import logger from './logger';

let cachedClient: SupabaseClient | null = null;

export const getSupabaseClient = (): SupabaseClient => {
  if (!config.supabase.url || !config.supabase.publicKey) {
    throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY.');
  }
  if (!cachedClient) {
    cachedClient = createClient(config.supabase.url, config.supabase.publicKey, {
      auth: { persistSession: false }
    });
    logger.info('Supabase client initialized');
  }
  return cachedClient;
};

export default getSupabaseClient;
