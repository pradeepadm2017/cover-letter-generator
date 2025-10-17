// AI-based web scraping service using existing scrapers + OpenAI GPT-4
// This service can extract job information from ANY job posting URL (LinkedIn, Indeed, Glassdoor, etc.)
// Works even with LinkedIn's sidebar panel view

const OpenAI = require('openai');
const scrapingService = require('./scraping-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Extract job information from a URL using AI
 * @param {string} jobUrl - The URL of the job posting
 * @returns {Promise<{title: string, company: string, description: string, url: string}>}
 */
async function extractJobWithAI(jobUrl) {
  console.log('AI Scraping: Starting extraction for:', jobUrl);

  let jobData = null;
  let contentSource = '';
  let scrapingMethod = '';

  let rawContent = '';

  try {
    // Strategy 1: Use existing hybrid scraping service (LinkedIn Guest API, Indeed, Glassdoor, etc.)
    console.log('AI Scraping: Using existing hybrid scraping service...');

    const hybridResult = await scrapingService.fetchJobDescriptionHybrid(jobUrl);

    // Handle new return format { content, method }
    if (typeof hybridResult === 'object' && hybridResult.content && hybridResult.method) {
      rawContent = hybridResult.content;
      scrapingMethod = hybridResult.method;
      contentSource = `Hybrid Scraper (${scrapingMethod})`;
    } else {
      // Backward compatibility - if service returns string instead of object
      rawContent = hybridResult;
      scrapingMethod = 'hybrid-unknown';
      contentSource = 'Hybrid Scraper (LinkedIn Guest API / Indeed / Glassdoor)';
    }

    console.log('AI Scraping: ✅ Hybrid scraper successful, method:', scrapingMethod, ', content length:', rawContent.length);

    // If we got good structured content from the hybrid scraper, use it directly
    if (rawContent && rawContent.length > 500) {
      console.log('AI Scraping: Good content from hybrid scraper, length:', rawContent.length);

      // Parse if it's already structured (has "Job Title:", "Company:", etc.)
      const titleMatch = rawContent.match(/Job Title:\s*(.+?)(?:\n\n|Company:)/i);
      const companyMatch = rawContent.match(/Company:\s*(.+?)(?:\n\n|Job Description:)/i);
      const descMatch = rawContent.match(/Job Description:\s*(.+)/is);

      if (titleMatch && companyMatch && descMatch && descMatch[1].length > 500) {
        // Perfect! Return structured data directly with scraping method
        return {
          title: titleMatch[1].trim(),
          company: companyMatch[1].trim(),
          description: descMatch[1].trim(),
          url: jobUrl,
          scrapingMethod: scrapingMethod
        };
      }
    }

  } catch (hybridError) {
    console.log('AI Scraping: ⚠️ Hybrid scraper failed:', hybridError.message);
    console.log('AI Scraping: Falling back to ScraperAPI + GPT-4...');

    // Fallback: Try ScraperAPI for custom career websites
    const scraperApiKey = process.env.SCRAPERAPI_KEY;
    if (!scraperApiKey) {
      throw new Error('Hybrid scraper failed and ScraperAPI not configured');
    }

    try {
      const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(jobUrl)}&render=true&premium=true`;
      console.log('AI Scraping: Trying ScraperAPI with JS rendering...');

      const scraperResponse = await fetch(scraperUrl, { timeout: 60000 });

      if (!scraperResponse.ok) {
        throw new Error(`ScraperAPI failed: ${scraperResponse.status} ${scraperResponse.statusText}`);
      }

      const html = await scraperResponse.text();
      console.log('AI Scraping: ✅ ScraperAPI successful, HTML length:', html.length);

      // Convert HTML to readable text by stripping tags
      rawContent = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      contentSource = 'ScraperAPI (JS-rendered)';
      scrapingMethod = 'scraperapi';
      console.log('AI Scraping: Cleaned content length:', rawContent.length);

    } catch (scraperError) {
      console.log('AI Scraping: ⚠️ ScraperAPI also failed:', scraperError.message);

      // Provide helpful error message for heavily protected sites
      const errorMsg = 'This website cannot be automatically accessed (likely protected by login requirements or security measures). ' +
        'Please use the "Manual Paste" feature instead: ' +
        '1) Open the job posting in your browser, ' +
        '2) Copy the job title, company name, and full description, ' +
        '3) Use the Manual Paste mode to enter the details directly.';

      throw new Error(errorMsg);
    }
  }

  // Step 2: Use GPT-4 to extract structured job information from raw content
  console.log('AI Scraping: Using GPT-4 to extract job information from content...');

  // Prepare content for GPT-4 - truncate if too long (GPT-4 context limit)
  const contentForAI = rawContent.substring(0, 50000);

  try {
    const extraction = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Fast and cost-effective for extraction
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a job posting extraction expert. Extract or enhance job information and return it as JSON.

IMPORTANT RULES:
1. Extract the MAIN job posting information
2. Extract the full, complete job description (not just a snippet)
3. Return ONLY valid JSON, no markdown formatting, no explanations
4. If you cannot find a field, use an empty string

Return format:
{
  "title": "exact job title",
  "company": "exact company name",
  "description": "complete full job description including all requirements, responsibilities, and details"
}`
        },
        {
          role: "user",
          content: `Extract the job posting information from this content:

${contentForAI}

Return ONLY the JSON object with title, company, and description fields.`
        }
      ],
      temperature: 0.1 // Low temperature for consistent extraction
    });

    const result = JSON.parse(extraction.choices[0].message.content);

    console.log('AI Scraping: Extraction successful:', {
      source: contentSource,
      title: result.title?.substring(0, 50) || 'NOT FOUND',
      company: result.company || 'NOT FOUND',
      descriptionLength: result.description?.length || 0
    });

    // Validate extraction
    if (!result.title || !result.company || !result.description) {
      throw new Error('AI extraction incomplete: Missing required fields');
    }

    if (result.description.length < 100) {
      throw new Error('AI extraction incomplete: Description too short (likely failed to extract full content)');
    }

    return {
      title: result.title.trim(),
      company: result.company.trim(),
      description: result.description.trim(),
      url: jobUrl,
      scrapingMethod: scrapingMethod || 'gpt-extraction'
    };

  } catch (gptError) {
    console.error('AI Scraping: GPT-4 extraction error:', gptError.message);

    // Provide helpful error message
    const errorMsg = 'Unable to extract job information from this website (content too limited or protected). ' +
      'Please use the "Manual Paste" feature instead: ' +
      '1) Open the job posting in your browser, ' +
      '2) Copy the job title, company name, and full description, ' +
      '3) Use the Manual Paste mode to enter the details directly.';

    throw new Error(errorMsg);
  }
}

/**
 * Fallback: Extract job info using GPT-4 from raw HTML (if Jina fails)
 * @param {string} html - Raw HTML content
 * @param {string} jobUrl - Original job URL
 * @returns {Promise<{title: string, company: string, description: string, url: string}>}
 */
async function extractJobFromHTML(html, jobUrl) {
  console.log('AI Scraping: Using fallback HTML extraction...');

  const extraction = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a job posting extraction expert. Extract job information from HTML and return it as JSON.

Extract the MAIN job posting (ignore navigation, sidebars, other job listings).
Return ONLY valid JSON: {"title": "...", "company": "...", "description": "..."}`
      },
      {
        role: "user",
        content: `Extract job info from this HTML (truncated to first 50000 chars):

${html.substring(0, 50000)}

Return ONLY the JSON object.`
      }
    ],
    temperature: 0.1
  });

  const result = JSON.parse(extraction.choices[0].message.content);

  return {
    title: result.title?.trim() || '',
    company: result.company?.trim() || '',
    description: result.description?.trim() || '',
    url: jobUrl
  };
}

module.exports = {
  extractJobWithAI,
  extractJobFromHTML
};
