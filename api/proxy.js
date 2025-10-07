export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { url, method = 'GET', headers = {} } = req.method === 'GET' ? req.query : req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    // Validate URL
    try {
      new URL(url);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    // Prepare fetch options
    const fetchOptions = {
      method: method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        ...headers
      }
    };

    // Add body for POST requests
    if (req.method === 'POST' && req.body.body) {
      fetchOptions.body = req.body.body;
    }

    // Fetch the target URL
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      return res.status(response.status).json({
        error: `HTTP ${response.status}: ${response.statusText}`
      });
    }

    const contentType = response.headers.get('content-type');

    // Handle different content types
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      return res.json({ data, contentType });
    } else {
      const data = await response.text();
      return res.json({ data, contentType });
    }

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({
      error: 'Failed to fetch the requested URL',
      details: error.message
    });
  }
}