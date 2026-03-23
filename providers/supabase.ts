import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import logger from '../lib/logger';

const supabaseUrl = config.supabase.url;
const supabaseKey = config.supabase.serviceKey || config.supabase.publicKey;

if (!supabaseUrl || !supabaseKey) {
  const message = 'Supabase configuration missing. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.';
  logger.error(message);
  throw new Error(message);
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export const throwIfError = <T = any>(input: { data: T | null; error: any }) => {
  if (input.error) {
    throw input.error;
  }
  return input.data as T | null;
};

export const requireData = <T = any>(input: { data: T | null; error: any }) => {
  const data = throwIfError<T>(input);
  if (data === null || data === undefined) {
    throw new Error('Supabase query returned no data');
  }
  return data;
};

export default supabase;
