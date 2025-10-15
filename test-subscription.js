/**
 * Test Subscription Helper
 *
 * This script helps you manually set subscription tiers for testing
 * without going through payment flows.
 *
 * Usage:
 *   node test-subscription.js <email> <tier>
 *
 * Examples:
 *   node test-subscription.js user@example.com monthly
 *   node test-subscription.js user@example.com quarterly
 *   node test-subscription.js user@example.com lifetime
 *   node test-subscription.js user@example.com free
 */

require('dotenv').config();
const { userOps } = require('./supabase-db');
const supabase = require('./supabase-client');

const VALID_TIERS = ['free', 'monthly', 'quarterly', 'lifetime'];

async function setSubscription(email, tier) {
    try {
        // Validate tier
        if (!VALID_TIERS.includes(tier)) {
            console.error(`❌ Invalid tier: ${tier}`);
            console.log(`Valid tiers: ${VALID_TIERS.join(', ')}`);
            process.exit(1);
        }

        // Find user by email using Supabase Auth Admin API
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();

        if (listError) {
            console.error('❌ Error listing users:', listError);
            process.exit(1);
        }

        const user = users.find(u => u.email === email);

        if (!user) {
            console.error(`❌ User not found: ${email}`);
            console.log('Available users:');
            users.forEach(u => console.log(`  - ${u.email}`));
            process.exit(1);
        }

        console.log(`Found user: ${user.email} (ID: ${user.id})`);

        // Calculate expiry date
        let expiresAt = null;
        if (tier !== 'free') {
            const now = new Date();
            if (tier === 'monthly') {
                now.setMonth(now.getMonth() + 1);
                expiresAt = now.toISOString();
            } else if (tier === 'quarterly') {
                now.setMonth(now.getMonth() + 3);
                expiresAt = now.toISOString();
            } else if (tier === 'lifetime') {
                // Set to 100 years in the future for lifetime
                now.setFullYear(now.getFullYear() + 100);
                expiresAt = now.toISOString();
            }
        }

        // Update subscription
        await userOps.updateSubscription(user.id, tier, expiresAt);

        console.log(`✅ Successfully updated subscription!`);
        console.log(`   Email: ${email}`);
        console.log(`   Tier: ${tier}`);
        console.log(`   Expires: ${expiresAt ? new Date(expiresAt).toLocaleDateString() : 'N/A (Free tier)'}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Parse command line arguments
const email = process.argv[2];
const tier = process.argv[3];

if (!email || !tier) {
    console.log('Usage: node test-subscription.js <email> <tier>');
    console.log('');
    console.log('Examples:');
    console.log('  node test-subscription.js user@example.com monthly');
    console.log('  node test-subscription.js user@example.com quarterly');
    console.log('  node test-subscription.js user@example.com lifetime');
    console.log('  node test-subscription.js user@example.com free');
    console.log('');
    console.log('Valid tiers:', VALID_TIERS.join(', '));
    process.exit(1);
}

setSubscription(email, tier);
