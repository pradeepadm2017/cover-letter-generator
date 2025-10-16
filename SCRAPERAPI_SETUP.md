# ScraperAPI Setup Guide

ScraperAPI has been integrated as the **recommended solution** for scraping Indeed job postings. It provides a 92.7% success rate and bypasses Indeed's anti-bot protection automatically.

## Why ScraperAPI?

- ✅ **92.7% success rate** with Indeed (proven and tested)
- ✅ **Handles anti-bot protection** automatically (Cloudflare, CAPTCHAs)
- ✅ **Premium proxy network** included
- ✅ **Simple integration** - just one API call
- ✅ **Pay-as-you-go** pricing - no monthly minimum
- ✅ **Cost-effective**: ~$2.90 per 1,000 requests

## Pricing

- **Cost**: $2.90 per 1,000 Indeed requests
- **For 20,000 requests**: ~$58 total
- **Free tier**: 5,000 API credits (test before buying)
- **No monthly commitment** required

## Setup Steps

### 1. Sign Up for ScraperAPI

1. Go to https://www.scraperapi.com
2. Click "Start Free Trial" (no credit card required for free tier)
3. Verify your email
4. Get your API key from the dashboard

### 2. Add API Key to Your Project

Open your `.env` file and replace `YOUR_SCRAPERAPI_KEY_HERE` with your actual API key:

```env
# ScraperAPI Configuration (Recommended for Indeed scraping)
ENABLE_SCRAPERAPI=true
SCRAPERAPI_KEY=your_actual_api_key_here
```

### 3. Test the Integration

Run the test script to verify it works:

```bash
node test-apify.js
```

You should see:
- ✅ ScraperAPI enabled for Indeed scraping
- Successful extraction of job title, company, and description

## How It Works

The scraping service now uses this hierarchy:

1. **Tier 1**: Basic fetch (FREE, ~30% success with Indeed)
2. **Tier 2a**: ScraperAPI (PRIMARY - 92.7% success with Indeed)
3. **Tier 2b**: Apify fallback (if ScraperAPI fails or disabled)
4. **Tier 3**: Puppeteer (future implementation)

## Testing Without API Key

If you want to test without a ScraperAPI key first:

```env
ENABLE_SCRAPERAPI=false
```

The system will fall back to Apify (which currently fails with Indeed due to 403 errors).

## Free Tier Limits

ScraperAPI's free tier includes:
- **5,000 API credits**
- ~1,700 Indeed requests (Indeed uses premium proxies = 3 credits/request)
- Sufficient for testing and small-scale usage

## API Parameters Used

The integration uses these ScraperAPI parameters:
- `render=true` - Renders JavaScript (required for Indeed)
- `premium=true` - Uses premium proxies (required for Indeed's anti-bot)
- `timeout=60000` - 60 second timeout for slow pages

## Monitoring Usage

Check your usage at: https://www.scraperapi.com/dashboard

## Support

- Documentation: https://docs.scraperapi.com
- Support: support@scraperapi.com
- Dashboard: https://www.scraperapi.com/dashboard

## Alternative: Continue with Apify

If you prefer to stick with Apify, you can:
1. Enable residential proxies in Apify (costs ~$12.50/GB)
2. Use Apify's dedicated Indeed scraper actors
3. Accept lower success rates with current setup

To disable ScraperAPI:
```env
ENABLE_SCRAPERAPI=false
```
