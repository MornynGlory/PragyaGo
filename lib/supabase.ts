import { createClient } from '@supabase/supabase-js';

// Hardcoded placeholders - Replace with your actual Supabase credentials
const SUPABASE_URL = "https://yourproject.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-key";

// Fallback to environment variables if available
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  SUPABASE_URL;

const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  SUPABASE_ANON_KEY;

// Initialize Supabase client with error handling
let supabase: ReturnType<typeof createClient> | null = null;

try {
  if (!supabaseUrl || supabaseUrl === "https://yourproject.supabase.co") {
    console.warn(
      'Supabase URL not configured. Using placeholder. Please update /lib/supabase.ts with your actual URL.'
    );
  }

  if (!supabaseAnonKey || supabaseAnonKey === "your-anon-key") {
    console.warn(
      'Supabase anon key not configured. Using placeholder. Please update /lib/supabase.ts with your actual key.'
    );
  }

  supabase = createClient(supabaseUrl, supabaseAnonKey);
} catch (error) {
  console.error('Failed to initialize Supabase client:', error);
  // Create a dummy client that won't crash the app
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

export { supabase };

// Helper function to check if Supabase is properly configured
export const isSupabaseConfigured = (): boolean => {
  return (
    supabaseUrl !== "https://yourproject.supabase.co" &&
    supabaseAnonKey !== "your-anon-key"
  );
};

// Helper function to get Supabase status
export const getSupabaseStatus = () => {
  return {
    configured: isSupabaseConfigured(),
    url: supabaseUrl === "https://yourproject.supabase.co" ? "placeholder" : "configured",
    key: supabaseAnonKey === "your-anon-key" ? "placeholder" : "configured",
  };
};
