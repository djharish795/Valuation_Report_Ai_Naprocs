import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use /tmp in serverless/Vercel environments, or local .cache during development
const CACHE_DIR = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
  ? path.join(os.tmpdir(), '.cache')
  : path.join(process.cwd(), '.cache');

export function ensureCacheDir() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  } catch (e) {
    console.warn('[cache-utils] Could not create cache directory:', e);
  }
}

export function generateHash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function getCachedResult(hash: string): any | null {
  try {
    ensureCacheDir();
    const cachePath = path.join(CACHE_DIR, `${hash}.json`);
    
    if (fs.existsSync(cachePath)) {
      const data = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('[cache-utils] Failed to read cache:', e);
  }
  return null;
}

export function setCachedResult(hash: string, data: any): void {
  try {
    ensureCacheDir();
    const cachePath = path.join(CACHE_DIR, `${hash}.json`);
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[cache-utils] Failed to write cache:', e);
  }
}
