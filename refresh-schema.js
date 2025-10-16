require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials in .env file');
    process.exit(1);
}

// Create admin client
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function refreshSchema() {
    console.log('🔄 Refreshing Supabase schema cache...\n');

    try {
        // The PostgREST schema cache can be refreshed by making a request
        // to the special rpc endpoint or by simply querying the table
        // which forces Supabase to check the schema

        // Try to select from profiles with the new columns
        const { data, error } = await supabase
            .from('profiles')
            .select('id, email, promo_codes_used, custom_monthly_limit')
            .limit(1);

        if (error) {
            if (error.message.includes('schema cache')) {
                console.log('⚠️  Schema cache needs manual refresh');
                console.log('\n📋 Please refresh the schema cache manually:');
                console.log('\n1. Go to https://supabase.com/dashboard');
                console.log('2. Select your project');
                console.log('3. Go to Settings → API');
                console.log('4. Click "Reload schema cache" or restart the PostgREST server');
                console.log('\nAlternatively, wait 2-3 minutes for the cache to auto-refresh.');
                process.exit(1);
            } else {
                throw error;
            }
        }

        console.log('✅ Schema cache is up to date!');
        console.log('\nSample data:', data);
        console.log('\n✅ Promo code columns are accessible!');

    } catch (err) {
        console.error('❌ Error:', err.message);
        console.log('\n📋 Manual steps to refresh schema:');
        console.log('\n1. Go to https://supabase.com/dashboard');
        console.log('2. Select your project');
        console.log('3. Go to Settings → API');
        console.log('4. Click "Reload schema cache"');
        process.exit(1);
    }
}

refreshSchema();
