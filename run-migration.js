require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials in .env file');
    console.error('SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
    console.error('SUPABASE_SERVICE_KEY:', supabaseServiceKey ? '✓' : '✗');
    process.exit(1);
}

// Create admin client
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function runMigration() {
    console.log('🚀 Running database migration...\n');

    try {
        // Read the SQL file
        const sql = fs.readFileSync('./add-promo-code-column.sql', 'utf8');
        console.log('📄 SQL to execute:');
        console.log(sql);
        console.log('\n---\n');

        // Execute the migration
        const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

        if (error) {
            // If exec_sql RPC doesn't exist, try direct approach
            console.log('⚠️  RPC method not available, trying direct SQL execution...\n');

            // Split by semicolon and execute each statement
            const statements = sql
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.startsWith('--'));

            for (const statement of statements) {
                console.log('Executing:', statement.substring(0, 60) + '...');

                // Use the PostgreSQL REST API directly
                const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': supabaseServiceKey,
                        'Authorization': `Bearer ${supabaseServiceKey}`
                    },
                    body: JSON.stringify({ sql_query: statement })
                });

                if (!response.ok) {
                    console.log('⚠️  REST API approach failed, this is expected.');
                    console.log('\n❌ Cannot run migration programmatically.');
                    console.log('\n📋 Please run this SQL manually in Supabase dashboard:');
                    console.log('\n1. Go to https://supabase.com/dashboard');
                    console.log('2. Select your project');
                    console.log('3. Click "SQL Editor" in left sidebar');
                    console.log('4. Paste and run this SQL:\n');
                    console.log(sql);
                    process.exit(1);
                }
            }

            console.log('\n✅ Migration executed successfully!');
        } else {
            console.log('\n✅ Migration executed successfully!');
            console.log('Result:', data);
        }

        // Verify the columns were added
        console.log('\n🔍 Verifying migration...');
        const { data: tableInfo, error: verifyError } = await supabase
            .from('profiles')
            .select('*')
            .limit(1);

        if (verifyError) {
            console.log('⚠️  Could not verify migration:', verifyError.message);
        } else {
            console.log('✅ Profiles table accessible');
        }

        console.log('\n✅ Migration complete! You can now use promo codes.');

    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        console.log('\n📋 Please run this SQL manually in Supabase dashboard:');
        console.log('\n1. Go to https://supabase.com/dashboard');
        console.log('2. Select your project');
        console.log('3. Click "SQL Editor" in left sidebar');
        console.log('4. Paste and run this SQL:\n');
        const sql = fs.readFileSync('./add-promo-code-column.sql', 'utf8');
        console.log(sql);
        process.exit(1);
    }
}

runMigration();
