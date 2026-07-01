// https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Disable package exports resolution to prevent Metro from tripping over
// conditional exports fields in packages like @supabase/supabase-js that
// contain webpack-specific or Node-only entry points incompatible with Metro.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
