# OAuth Setup Guide

This application uses Google and LinkedIn OAuth for user authentication. Follow these steps to set up OAuth credentials.

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services** > **Credentials**
4. Click **Create Credentials** > **OAuth client ID**
5. Configure the consent screen if prompted
6. Select **Web application** as the application type
7. Add authorized redirect URIs:
   - `http://localhost:3000/auth/google/callback` (for development)
   - `https://yourdomain.com/auth/google/callback` (for production)
8. Copy the **Client ID** and **Client Secret**
9. Add them to your `.env` file:
   ```
   GOOGLE_CLIENT_ID=your-google-client-id-here
   GOOGLE_CLIENT_SECRET=your-google-client-secret-here
   ```

## LinkedIn OAuth Setup

1. Go to [LinkedIn Developers](https://www.linkedin.com/developers/)
2. Click **Create app**
3. Fill in the required information:
   - App name: BatchApply Cover Letter Generator
   - LinkedIn Page: (Create or select a page)
   - App logo: Upload your logo
   - Legal agreement: Accept terms
4. Go to the **Auth** tab
5. Add redirect URLs:
   - `http://localhost:3000/auth/linkedin/callback` (for development)
   - `https://yourdomain.com/auth/linkedin/callback` (for production)
6. Request access to:
   - `r_emailaddress` (to get user email)
   - `r_liteprofile` (to get user profile)
7. Copy the **Client ID** and **Client Secret**
8. Add them to your `.env` file:
   ```
   LINKEDIN_CLIENT_ID=your-linkedin-client-id-here
   LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret-here
   ```

## Session Secret

Generate a random secret key for session management:

```bash
# On Linux/Mac
openssl rand -hex 32

# Or use any random string generator
```

Add it to your `.env` file:
```
SESSION_SECRET=your-generated-secret-key-here
```

## Testing Locally

1. Update `.env` with all credentials
2. Restart the server: `npm start`
3. Visit `http://localhost:3000`
4. Click "Get Started with Google" or "Continue with LinkedIn"
5. Complete the OAuth flow

## Production Deployment

When deploying to production:

1. Update `APP_URL` in `.env` to your production URL
2. Add production redirect URIs to Google and LinkedIn apps
3. Update the callback URLs in `.env`:
   ```
   GOOGLE_CALLBACK_URL=https://yourdomain.com/auth/google/callback
   LINKEDIN_CALLBACK_URL=https://yourdomain.com/auth/linkedin/callback
   APP_URL=https://yourdomain.com
   ```

## Troubleshooting

### "redirect_uri_mismatch" Error
- Ensure the redirect URI in your OAuth app matches exactly with the one in `.env`
- Check for trailing slashes and http vs https

### "Error: Failed to fetch user profile"
- Verify you have the correct scopes/permissions enabled
- For LinkedIn, ensure `r_emailaddress` and `r_liteprofile` are approved

### Session Issues
- Make sure `SESSION_SECRET` is set in `.env`
- Clear browser cookies and try again
