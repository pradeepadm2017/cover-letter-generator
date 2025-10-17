# FastCoverLetters - Job Extraction Solution

## Simple, Two-Path Approach

Your users have **two simple options** for getting job information into FastCoverLetters:

### 1. 🔗 Paste URL (Automated Extraction)
**Works for:**
- ✅ LinkedIn (all views, including sidebar panels)
- ✅ Indeed
- ✅ Glassdoor
- ✅ Eluta.ca
- ✅ Workopolis (via paid ScraperAPI fallback)

**How it works:**
- User pastes the job URL
- AI-powered scraping extracts title, company, and description
- Uses FREE APIs (LinkedIn Guest API, Indeed JSON, Glassdoor GraphQL, Eluta JSON-LD)
- Falls back to ScraperAPI + GPT-4 extraction for protected sites

**Test at:** `http://localhost:3000/test-ai-scraping.html`

### 2. ✍️ Manual Paste (Direct Input)
**Use when:**
- Google Jobs
- Protected career portals (PeopleSoft, Workday, etc.)
- Any site where automated scraping fails

**How it works:**
- User opens job in browser
- Copies title, company name, and description
- Pastes directly into form

**Test at:** `http://localhost:3000/manual-paste.html`

---

## Coverage Summary

| Job Site | URL Method | Manual Paste |
|----------|-----------|--------------|
| LinkedIn | ✅ Auto (FREE) | ✅ Always works |
| Indeed | ✅ Auto (FREE) | ✅ Always works |
| Glassdoor | ⚠️ Auto (FREE, inconsistent) | ✅ Always works |
| Eluta.ca | ✅ Auto (FREE) | ✅ Always works |
| Workopolis | ⚠️ Auto (uses ScraperAPI) | ✅ Always works |
| Google Jobs | ❌ Blocked by CAPTCHA | ✅ Use this |
| PeopleSoft | ❌ Requires auth | ✅ Use this |
| Workday | ❌ Requires auth | ✅ Use this |
| Custom Career Sites | ⚠️ Mixed results | ✅ Always works |

---

## Key Files

### AI Scraping Service
- **`ai-scraping-service.js`** - Core scraping logic (Hybrid scrapers + GPT-4)
- **`scraping-service.js`** - LinkedIn Guest API, Indeed, Glassdoor implementations
- **`server.js`** - `/api/scrape-ai` endpoint

### Test Pages
- **`public/test-ai-scraping.html`** - Test URL extraction
- **`public/manual-paste.html`** - Manual paste interface

---

## Why This Approach?

**Simple & Reliable:**
- No browser extensions to install/maintain
- No complex setup
- Clear fallback path when automation fails

**Cost-Effective:**
- LinkedIn, Indeed, Eluta = FREE (using public APIs)
- Glassdoor = FREE but inconsistent (anti-bot protection)
- Workopolis = Uses ScraperAPI (paid fallback)
- Only uses OpenAI credits for GPT-4 extraction when needed

**Universal Coverage:**
- URL scraping handles 80% of cases automatically
- Manual paste handles 100% of cases (always works)

---

## User Flow

1. **User finds job** → Goes to LinkedIn/Indeed/Glassdoor
2. **User copies URL** → Pastes into FastCoverLetters
3. **If auto-extraction fails** → Error message says "Use Manual Paste instead"
4. **User switches to manual paste** → Copies job details, pastes directly
5. **Cover letter generated!** 🎉
