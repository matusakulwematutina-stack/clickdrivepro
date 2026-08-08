import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ngcjwhmjontbytzlzzlh.supabase.co';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nY2p3aG1qb250Ynl0emx6emxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1ODk5MjAsImV4cCI6MjA5OTE2NTkyMH0.ZtsH9d5B1dpRe1HIhyE7qjPh6XqH8TWaW5gLvc2qgoc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
