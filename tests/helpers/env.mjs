import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const projectRoot = path.resolve(__dirname, '../../');

/**
 * Parses a simple .env file into key-value pairs without printing or logging values.
 */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const result = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        result[key] = val;
      }
    }
    return result;
  } catch {
    return {};
  }
}

// 1. Gather values preferring process.env, falling back to .env.local then .env
const localEnv = parseEnvFile(path.join(projectRoot, '.env.local'));
const defaultEnv = parseEnvFile(path.join(projectRoot, '.env'));

export const env = {
  ...defaultEnv,
  ...localEnv,
  ...process.env,
};

export const supabaseUrl = env.VITE_SUPABASE_URL;
export const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

// 2. Validate required variables without printing secret values
const missing = [];
if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
if (!supabaseKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');

if (missing.length > 0) {
  throw new Error(
    `[Quizzr Test Helper] Missing required environment variable(s): ${missing.join(', ')}. ` +
      `Please provide them in process.env or in .env.local at the project root.`
  );
}

// 3. Export shared Supabase client for test execution
export const supabase = createClient(supabaseUrl, supabaseKey);
