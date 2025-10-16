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

async function resetUsage() {
    console.log('🔄 Resetting usage counts for all users...\n');

    try {
        // Get current month
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        console.log(`📅 Current month: ${currentMonth}\n`);

        // Get all usage records for current month
        const { data: usageRecords, error: fetchError } = await supabase
            .from('usage')
            .select('*')
            .eq('month', currentMonth);

        if (fetchError) {
            console.error('❌ Error fetching usage records:', fetchError);
            process.exit(1);
        }

        console.log(`📊 Found ${usageRecords?.length || 0} usage records for current month\n`);

        if (!usageRecords || usageRecords.length === 0) {
            console.log('✅ No usage records to reset');
            return;
        }

        // Reset all counts to 0
        const { data: updateData, error: updateError } = await supabase
            .from('usage')
            .update({ count: 0 })
            .eq('month', currentMonth);

        if (updateError) {
            console.error('❌ Error resetting usage counts:', updateError);
            process.exit(1);
        }

        console.log(`✅ Successfully reset ${usageRecords.length} usage records to 0`);

        // Show updated records
        const { data: verifyData, error: verifyError } = await supabase
            .from('usage')
            .select('user_id, count, month')
            .eq('month', currentMonth);

        if (!verifyError && verifyData) {
            console.log('\n📋 Updated usage records:');
            verifyData.forEach((record, index) => {
                console.log(`   ${index + 1}. User: ${record.user_id.substring(0, 8)}... - Count: ${record.count}`);
            });
        }

        console.log('\n✅ All usage counts have been reset to 0!');

    } catch (err) {
        console.error('❌ Reset failed:', err.message);
        process.exit(1);
    }
}

resetUsage();
