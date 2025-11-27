/**
 * Migration Script
 * 
 * IMPORTANT: This script is DEPRECATED.
 * 
 * Migrations should be run using the Supabase CLI:
 *   npx supabase db push
 *   npx supabase migration up
 * 
 * This ensures migrations are tracked properly and avoids relying on
 * custom database RPC functions.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('⚠️  WARNING: This migration script is deprecated.');
console.log('');
console.log('Please use the Supabase CLI to run migrations:');
console.log('  npx supabase db push        - Push local schema to remote');
console.log('  npx supabase migration up   - Run pending migrations');
console.log('');
console.log('If you need to run migrations programmatically, use the Supabase CLI');
console.log('or connect directly to PostgreSQL using a database URL.');
console.log('');

// List available migrations for reference
const migrationsDir = path.join(__dirname, '../supabase/migrations');
if (fs.existsSync(migrationsDir)) {
  const migrations = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  if (migrations.length > 0) {
    console.log('Available migrations:');
    migrations.forEach(m => console.log(`  - ${m}`));
  }
}

console.log('');
console.log('To run migrations with Supabase CLI:');
console.log('  1. Install CLI: npm install -g supabase');
console.log('  2. Link project: npx supabase link --project-ref YOUR_PROJECT_REF');
console.log('  3. Push migrations: npx supabase db push');
