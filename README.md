# Cover Letter Generator

A web application that generates personalized cover letters using your resume and job descriptions from URLs.

## Features

- **Resume Input**: Paste your resume in a text area
- **Multiple Job URLs**: Add multiple job posting URLs
- **Job Description Fetching**: Automatically fetch job descriptions from URLs
- **AI-Powered Generation**: Uses ChatGPT 4o mini to generate personalized cover letters
- **Download to Downloads Folder**: Generated cover letters are saved to your Downloads folder

## Setup

1. **Install Dependencies**
   ```bash
   cd cover-letter-generator
   npm install
   ```

2. **Set Up OpenAI API Key**
   - Copy `.env.example` to `.env`
   - Add your OpenAI API key to the `.env` file:
     ```
     OPENAI_API_KEY=your_actual_api_key_here
     ```

3. **Run the Application**
   ```bash
   npm start
   ```
   Or for development with auto-restart:
   ```bash
   npm run dev
   ```

4. **Open in Browser**
   Navigate to `http://localhost:3000`

## Usage

1. **Enter Your Resume**: Paste your complete resume in the text area
2. **Add Job URLs**: Enter URLs of job postings you're interested in
3. **Fetch Job Descriptions**: Click "Fetch Job" for each URL to extract the job description
4. **Generate Cover Letters**: Click "Generate All Cover Letters" to create personalized cover letters
5. **Download**: Each generated cover letter can be downloaded to your Downloads folder

## API Endpoints

- `GET /` - Main application page
- `POST /api/fetch-job` - Fetch job description from URL
- `POST /api/generate-cover-letter` - Generate cover letter using AI
- `POST /api/download-cover-letter` - Save cover letter to Downloads folder

## Technologies Used

- **Backend**: Node.js, Express.js
- **AI**: OpenAI GPT-4o mini
- **Web Scraping**: Axios, Cheerio
- **Frontend**: HTML, CSS, JavaScript
- **File Handling**: Native Node.js fs module

## Requirements

- Node.js 14+
- OpenAI API key
- Internet connection for fetching job descriptions and AI generation