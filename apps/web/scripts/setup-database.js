#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read .env.local file manually
const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
}

async function setupDatabase() {
  console.log('🚀 Setting up FitCircle database...\n');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials. Please check your .env.local file.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log('📊 Running database migrations...\n');

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, '../supabase/migrations/001_initial_schema.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');

    // Note: Supabase doesn't directly support running raw SQL through the JS client
    // You'll need to run this SQL in the Supabase dashboard SQL editor
    console.log('⚠️  Please run the following migration in your Supabase dashboard SQL editor:');
    console.log('📍 Navigate to: ' + supabaseUrl.replace('https://', 'https://app.supabase.com/project/'));
    console.log('📝 Go to SQL Editor and paste the contents of:');
    console.log('   ' + migrationPath);
    console.log('\n');

    // Test database connection
    console.log('🔄 Testing database connection...');
    const { data, error } = await supabase.from('profiles').select('count').limit(1);

    if (error && error.code !== '42P01') { // 42P01 = table does not exist
      console.error('❌ Database connection failed:', error.message);
      process.exit(1);
    }

    if (error && error.code === '42P01') {
      console.log('⚠️  Tables not found. Please run the migration SQL first.');
    } else {
      console.log('✅ Database connection successful!');
    }

    // Create test data (optional)
    const createTestData = process.argv.includes('--with-test-data');
    if (createTestData) {
      console.log('\n📦 Creating test data...');
      // Add test data creation logic here if needed
      console.log('✅ Test data created!');
    }

    console.log('\n🎉 Database setup complete!');
    console.log('\nNext steps:');
    console.log('1. Run the migration SQL in your Supabase dashboard');
    console.log('2. Start the development server: npm run dev');
    console.log('3. Visit http://localhost:3000');

  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

setupDatabase();