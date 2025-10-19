// Initialize Supabase
const SUPABASE_URL = 'https://igliqzsokxeknkiozkrj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbGlxenNva3hla25raW96a3JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MjYzNjcsImV4cCI6MjA3NTQwMjM2N30.NasThZulDuYEbRZiVsIXTMt2dLWRwtveY6_GPVULv98';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global variables
let resumeText = '';
let currentSession = null;
let currentUser = null;
let isLoggingOut = false;

// Helper function to get auth headers
async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = '/';
        throw new Error('Not authenticated');
    }
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
    };
}

// Initialize auth on page load
async function initAuth() {
    if (isLoggingOut) {
        console.log('Logout in progress, skipping auth check');
        return false;
    }

    // Get session first (this processes any OAuth tokens in the URL hash)
    const { data: { session } } = await supabase.auth.getSession();

    // Now clean up the URL hash if there was one
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.has('access_token')) {
        console.log('OAuth redirect detected, cleaning up URL');
        // Clean up the URL by removing the hash AFTER Supabase has processed it
        window.history.replaceState(null, '', window.location.pathname);
    }

    if (!session) {
        console.log('No session found, redirecting to home');
        window.location.href = '/';
        return false;
    }

    currentSession = session;
    currentUser = session.user;

    console.log('Session found for user:', currentUser.email);

    // Update UI with user info
    await loadUserInfo();
    return true;
}

// Load user information
async function loadUserInfo() {
    try {
        // Use current session instead of fetching again
        if (!currentSession) {
            console.error('No current session available');
            return;
        }

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentSession.access_token}`
        };

        const response = await fetch('/api/auth/status', {
            headers
        });

        const data = await response.json();

        if (data.authenticated) {
            const tierFormatted = data.user.tier.charAt(0).toUpperCase() + data.user.tier.slice(1);

            // Update dropdown email and tier (new header design)
            const dropdownEmail = document.getElementById('dropdown-email');
            const dropdownTier = document.getElementById('dropdown-tier');
            if (dropdownEmail) dropdownEmail.textContent = data.user.email;
            if (dropdownTier) dropdownTier.textContent = tierFormatted;

            // Update tier badge color in dropdown
            if (dropdownTier) {
                dropdownTier.className = 'tier-badge';
                if (data.user.tier !== 'free') {
                    dropdownTier.classList.add('tier-paid');
                }
            }

            // Keep old header elements for backwards compatibility (if they exist)
            const userEmail = document.getElementById('user-email');
            const userTier = document.getElementById('user-tier');
            if (userEmail) userEmail.textContent = data.user.email;
            if (userTier) {
                userTier.textContent = tierFormatted;
                userTier.className = 'tier-badge';
                if (data.user.tier !== 'free') {
                    userTier.classList.add('tier-paid');
                }
            }

            // Load and display usage counter for free tier users
            await loadUsageCounter();

            // Check if this is a new user with incomplete profile
            await checkAndPromptProfileCompletion();
        } else {
            console.error('User not authenticated on backend');
            // Don't redirect here - session exists on frontend
        }
    } catch (error) {
        console.error('Error loading user info:', error);
        // Don't redirect on error
    }
}

// Check if profile is incomplete and prompt user to complete it
async function checkAndPromptProfileCompletion() {
    try {
        const profileValidation = await validateMandatoryProfileFields();
        if (!profileValidation.isValid) {
            // Show profile settings modal automatically for new users
            console.log('New user detected - showing profile settings modal');
            setTimeout(() => {
                toggleProfileSettingsModal();
            }, 500); // Small delay to let the page load first
        }
    } catch (error) {
        console.error('Error checking profile completion:', error);
    }
}

// Load and display usage counter
async function loadUsageCounter() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/usage/check', { headers });
        const data = await response.json();

        const usageCounter = document.getElementById('usage-counter');

        if (data.tier === 'free') {
            const remaining = data.remaining;
            const limit = data.limit;

            usageCounter.textContent = `${remaining}/${limit} left`;
            usageCounter.classList.remove('hidden');

            // Add low-usage warning class if running low
            if (remaining <= 2) {
                usageCounter.classList.add('low-usage');
            } else {
                usageCounter.classList.remove('low-usage');
            }
        } else {
            // Hide counter for paid users (unlimited)
            usageCounter.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error loading usage counter:', error);
    }
}

// Logout function
async function logout() {
    try {
        console.log('=== LOGOUT CLICKED ===');
        console.log('Starting logout process...');
        isLoggingOut = true;

        // Sign out with scope: 'local' to clear all local session data
        console.log('Calling supabase.auth.signOut()...');
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) {
            console.error('Logout error:', error);
        } else {
            console.log('SignOut successful');
        }

        // Manually clear all Supabase storage keys
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('sb-')) {
                keysToRemove.push(key);
            }
        }
        console.log('Removing Supabase keys:', keysToRemove);
        keysToRemove.forEach(key => {
            localStorage.removeItem(key);
        });

        // Clear all storage
        console.log('Clearing all storage...');
        localStorage.clear();
        sessionStorage.clear();

        // Wait to ensure signOut fully completes
        console.log('Waiting 300ms...');
        await new Promise(resolve => setTimeout(resolve, 300));

        // Force redirect with logout parameter
        console.log('Redirecting to /?logout=true');
        window.location.replace('/?logout=true');
    } catch (error) {
        console.error('Logout failed:', error);
        window.location.replace('/?logout=true');
    }
}

// Tab switching function for resume
function switchResumeTab(tabType) {
    const savedTab = document.getElementById('saved-resume-tab');
    const textTab = document.getElementById('text-resume-tab');
    const fileTab = document.getElementById('file-resume-tab');
    const tabBtns = document.querySelectorAll('.resume-input-options .tab-btn');

    // Hide all tabs
    savedTab.classList.remove('active');
    savedTab.classList.add('hidden');
    textTab.classList.remove('active');
    textTab.classList.add('hidden');
    fileTab.classList.remove('active');
    fileTab.classList.add('hidden');

    // Remove active class from all buttons
    tabBtns.forEach(btn => btn.classList.remove('active'));

    // Show the selected tab
    if (tabType === 'saved') {
        savedTab.classList.add('active');
        savedTab.classList.remove('hidden');
        tabBtns[0].classList.add('active');
    } else if (tabType === 'text') {
        textTab.classList.add('active');
        textTab.classList.remove('hidden');
        tabBtns[1].classList.add('active');
    } else {
        fileTab.classList.add('active');
        fileTab.classList.remove('hidden');
        tabBtns[2].classList.add('active');
    }
    updateGenerateButtonState();
}

// Mode switching function (URL vs Manual)
function switchInputMode(mode) {
    const urlSection = document.getElementById('url-mode-section');
    const manualSection = document.getElementById('manual-mode-section');

    if (mode === 'url') {
        urlSection.classList.remove('hidden');
        manualSection.classList.add('hidden');
    } else {
        urlSection.classList.add('hidden');
        manualSection.classList.remove('hidden');
    }
    updateGenerateButtonState();
}

// Handle file upload
async function handleResumeFileUpload(input) {
    const file = input.files[0];
    const fileStatus = document.getElementById('file-status');
    const fileNameDisplay = document.getElementById('file-name');

    if (!file) {
        return;
    }

    // Check if file is PDF
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        fileStatus.classList.remove('hidden', 'success');
        fileStatus.classList.add('error');
        fileStatus.textContent = '✕ PDF files are not supported. Please upload DOC, DOCX, or TXT format.';
        fileNameDisplay.textContent = 'Click to upload or drag & drop';
        input.value = ''; // Clear the file input
        resumeText = '';
        updateGenerateButtonState();
        return;
    }

    fileNameDisplay.textContent = file.name;
    fileStatus.classList.remove('hidden', 'success', 'error');
    fileStatus.textContent = 'Processing file...';

    try {
        const formData = new FormData();
        formData.append('resume', file);

        const response = await fetch('/api/upload-resume', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to process file');
        }

        resumeText = result.text;
        fileStatus.classList.add('success');
        fileStatus.textContent = `✓ File uploaded successfully (${result.text.length} characters)`;
        updateGenerateButtonState();
    } catch (error) {
        fileStatus.classList.add('error');
        // Improve error message for common issues
        let errorMsg = error.message;
        if (errorMsg.includes('DOMMatrix') || errorMsg.includes('Failed to process file')) {
            errorMsg = 'Unable to process this file. Try a DOCX or TXT file, or copy-paste your resume text below instead.';
        } else if (errorMsg.includes('Could not extract text')) {
            errorMsg = 'Unable to read this file format. Try uploading a DOCX or TXT file, or copy-paste your resume text below.';
        } else if (errorMsg.includes('File size')) {
            errorMsg = 'File too large (max 10MB). Try compressing it or copy-paste your resume text below.';
        } else if (errorMsg.includes('Unsupported')) {
            errorMsg = 'File format not supported. Please use DOCX or TXT format, or copy-paste your resume text below.';
        }
        fileStatus.textContent = `✕ ${errorMsg}`;
        resumeText = '';
        updateGenerateButtonState();
    }
}

// Proxy utility function for web scraping
async function fetchWithProxy(url, options = {}) {
    try {
        const proxyUrl = '/api/proxy';
        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: url,
                method: options.method || 'GET',
                headers: options.headers || {}
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        return {
            ok: true,
            data: result.data,
            contentType: result.contentType,
            text: () => Promise.resolve(result.data),
            json: () => Promise.resolve(typeof result.data === 'string' ? JSON.parse(result.data) : result.data)
        };
    } catch (error) {
        console.error('Proxy fetch error:', error);
        throw error;
    }
}

function showLoading(message = 'Processing...', submessage = '') {
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('loading-message').textContent = message;
    document.getElementById('loading-submessage').textContent = submessage;
}

function updateLoadingMessage(message, submessage = '') {
    document.getElementById('loading-message').textContent = message;
    document.getElementById('loading-submessage').textContent = submessage;
}

function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('loading-message').textContent = 'Processing...';
    document.getElementById('loading-submessage').textContent = '';
    hideProgressIndicator();
}

// Progress Indicator Functions
function showProgressIndicator(jobCount = 0) {
    const progressIndicator = document.getElementById('progress-indicator');
    progressIndicator.classList.remove('hidden');

    // Initialize all steps as inactive
    const steps = document.querySelectorAll('.progress-step');
    steps.forEach(step => {
        step.classList.remove('active', 'completed');
    });

    // Reset progress bar
    document.getElementById('progress-bar-fill').style.width = '0%';

    // Initialize job status list if jobs provided
    if (jobCount > 0) {
        const jobStatusList = document.getElementById('job-status-list');
        jobStatusList.innerHTML = '';

        for (let i = 0; i < jobCount; i++) {
            const jobItem = document.createElement('div');
            jobItem.className = 'job-status-item pending';
            jobItem.id = `job-status-${i}`;
            jobItem.innerHTML = `
                <span class="job-status-icon">⏳</span>
                <span class="job-status-text">Job ${i + 1}: Waiting...</span>
            `;
            jobStatusList.appendChild(jobItem);
        }
    }

    // Show estimated time
    if (jobCount > 0) {
        const estimatedSeconds = Math.max(10, jobCount * 8);
        const minutes = Math.floor(estimatedSeconds / 60);
        const seconds = estimatedSeconds % 60;
        let timeText = 'Estimated time: ';
        if (minutes > 0) {
            timeText += `${minutes}m ${seconds}s`;
        } else {
            timeText += `${seconds}s`;
        }
        document.getElementById('progress-time-text').textContent = timeText;
    }
}

function hideProgressIndicator() {
    const progressIndicator = document.getElementById('progress-indicator');
    progressIndicator.classList.add('hidden');

    // Clear job status list
    document.getElementById('job-status-list').innerHTML = '';
    document.getElementById('progress-time-text').textContent = '';
}

function setProgressStep(stepNumber, status = 'active') {
    // stepNumber: 1 = Preparing, 2 = Analyzing, 3 = Generating, 4 = Formatting
    // status: 'active' or 'completed'

    const steps = document.querySelectorAll('.progress-step');

    if (status === 'active') {
        // Mark previous steps as completed
        for (let i = 0; i < stepNumber - 1; i++) {
            steps[i].classList.remove('active');
            steps[i].classList.add('completed');
        }

        // Mark current step as active
        steps[stepNumber - 1].classList.remove('completed');
        steps[stepNumber - 1].classList.add('active');

        // Update progress bar (each step is 25%)
        const progressPercent = ((stepNumber - 1) / 4) * 100;
        document.getElementById('progress-bar-fill').style.width = `${progressPercent}%`;
    } else if (status === 'completed') {
        // Mark all steps up to and including this one as completed
        for (let i = 0; i < stepNumber; i++) {
            steps[i].classList.remove('active');
            steps[i].classList.add('completed');
        }

        // Update progress bar
        const progressPercent = (stepNumber / 4) * 100;
        document.getElementById('progress-bar-fill').style.width = `${progressPercent}%`;
    }
}

function updateJobStatus(jobIndex, status, message = '') {
    // status: 'pending', 'processing', 'success', 'error'
    const jobItem = document.getElementById(`job-status-${jobIndex}`);
    if (!jobItem) return;

    // Remove all status classes
    jobItem.classList.remove('pending', 'processing', 'success', 'error');
    jobItem.classList.add(status);

    // Update icon and text based on status
    const iconSpan = jobItem.querySelector('.job-status-icon');
    const textSpan = jobItem.querySelector('.job-status-text');

    switch (status) {
        case 'pending':
            iconSpan.textContent = '⏳';
            textSpan.textContent = message || `Job ${jobIndex + 1}: Waiting...`;
            break;
        case 'processing':
            iconSpan.textContent = '🔄';
            textSpan.textContent = message || `Job ${jobIndex + 1}: Processing...`;
            break;
        case 'success':
            iconSpan.textContent = '✓';
            textSpan.textContent = message || `Job ${jobIndex + 1}: Complete!`;
            break;
        case 'error':
            iconSpan.textContent = '✗';
            textSpan.textContent = message || `Job ${jobIndex + 1}: Failed`;
            break;
    }
}

function completeAllProgress() {
    // Mark all steps as completed
    setProgressStep(4, 'completed');

    // Update progress bar to 100%
    document.getElementById('progress-bar-fill').style.width = '100%';
}

/**
 * Helper function to provide user-friendly, actionable error messages
 * @param {string} errorMessage - The error message from the server or client
 * @returns {object} - { message: string, actionText: string, actionCallback: function }
 */
function getActionableError(errorMessage) {
    const errors = {
        // Resume errors
        'Resume and job URLs are required': {
            message: 'Missing resume or job descriptions. Please make sure you\'ve uploaded your resume and added at least one job.',
            actionText: 'Check Resume',
            actionCallback: () => document.getElementById('resume-upload')?.scrollIntoView({ behavior: 'smooth' })
        },
        'Could not extract text from file': {
            message: 'Unable to read your resume file. Try uploading a DOCX or TXT file instead, or copy-paste your resume text directly.',
            actionText: 'Try Again',
            actionCallback: () => document.getElementById('resume-textarea')?.focus()
        },
        'File size exceeds 10MB limit': {
            message: 'Resume file is too large (max 10MB). Try compressing it or use copy-paste instead.',
            actionText: 'Use Text',
            actionCallback: () => document.getElementById('resume-textarea')?.focus()
        },

        // Profile errors
        'Complete Your Profile': {
            message: 'Required profile fields are missing. Add your name, email, and phone to continue.',
            actionText: 'Open Profile',
            actionCallback: toggleProfileSettingsModal
        },
        'Invalid email format': {
            message: 'Email format is incorrect. Example: john@example.com',
            actionText: 'Fix Email',
            actionCallback: () => {
                toggleProfileSettingsModal();
                setTimeout(() => document.getElementById('profile-email')?.focus(), 300);
            }
        },
        'Invalid phone number': {
            message: 'Phone number must be 10-15 digits. Examples: (555) 123-4567 or 555-123-4567',
            actionText: 'Fix Phone',
            actionCallback: () => {
                toggleProfileSettingsModal();
                setTimeout(() => document.getElementById('profile-phone')?.focus(), 300);
            }
        },

        // Usage limit errors
        'Usage limit reached': {
            message: 'Monthly limit reached. Use a promo code to continue generating cover letters.',
            actionText: 'Enter Code',
            actionCallback: togglePromoCodeModal
        },

        // Job description errors
        'Job description too short': {
            message: 'Job description is too brief (needs 100+ characters). Please paste the full job posting.',
            actionText: null,
            actionCallback: null
        },

        // Network errors
        'Failed to fetch': {
            message: 'Connection error. Check your internet and try again.',
            actionText: 'Retry',
            actionCallback: () => window.location.reload()
        },
        'NetworkError': {
            message: 'Connection error. Check your internet and try again.',
            actionText: 'Retry',
            actionCallback: () => window.location.reload()
        }
    };

    // Find matching error
    for (const [key, value] of Object.entries(errors)) {
        if (errorMessage && errorMessage.includes(key)) {
            return value;
        }
    }

    // Default fallback
    return {
        message: errorMessage || 'An unexpected error occurred. Please try again or contact support if the problem persists.',
        actionText: null,
        actionCallback: null
    };
}

function showError(message, actionText = null, actionCallback = null) {
    const errorDiv = document.getElementById('error-message');

    // If message is a raw error, try to make it actionable
    if (!actionText && !actionCallback) {
        const actionableError = getActionableError(message);
        message = actionableError.message;
        actionText = actionableError.actionText;
        actionCallback = actionableError.actionCallback;
    }

    // Clear any existing content
    errorDiv.innerHTML = '';

    // Create message text
    const messageText = document.createElement('span');
    messageText.textContent = message;
    errorDiv.appendChild(messageText);

    // Add action button if provided
    if (actionText && actionCallback) {
        const actionBtn = document.createElement('button');
        actionBtn.textContent = actionText;
        actionBtn.className = 'error-action-btn';
        actionBtn.style.cssText = 'margin-left: 12px; padding: 4px 12px; background: white; color: #dc2626; border: 1px solid white; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600;';
        actionBtn.onclick = () => {
            errorDiv.classList.add('hidden');
            actionCallback();
        };
        errorDiv.appendChild(actionBtn);
    }

    errorDiv.classList.remove('hidden');
    setTimeout(() => {
        errorDiv.classList.add('hidden');
    }, 8000); // Extended to 8 seconds for actionable errors
}

// Show alert modal popup
function showAlertModal(title, message, buttonText = 'OK', onButtonClick = null) {
    const modal = document.getElementById('alert-modal');
    const modalTitle = document.getElementById('alert-modal-title');
    const modalMessage = document.getElementById('alert-modal-message');
    const modalButton = document.getElementById('alert-modal-button');

    modalTitle.textContent = title;
    // Convert newlines to <br> tags for multiline messages
    modalMessage.innerHTML = message.replace(/\n/g, '<br>');
    modalButton.textContent = buttonText;

    // Set up button click handler
    const handleButtonClick = () => {
        modal.classList.add('hidden');
        if (onButtonClick) {
            onButtonClick();
        }
    };

    // Remove old event listener and add new one
    const newButton = modalButton.cloneNode(true);
    modalButton.parentNode.replaceChild(newButton, modalButton);
    newButton.addEventListener('click', handleButtonClick);

    modal.classList.remove('hidden');
}

function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.textContent = message;
    document.querySelector('.container').appendChild(successDiv);
    setTimeout(() => {
        successDiv.remove();
    }, 3000);
}

function addJobUrl() {
    const container = document.getElementById('job-urls-container');
    const currentCount = container.querySelectorAll('.job-url-input').length;
    const newInput = document.createElement('div');
    newInput.className = 'job-url-input';
    newInput.setAttribute('data-index', currentCount);
    newInput.innerHTML = `
        <div class="url-input-wrapper">
            <input
                type="url"
                placeholder="Enter job posting URL (Indeed, LinkedIn, etc.)..."
                class="job-url"
            >
            <span class="url-status"></span>
        </div>
        <button type="button" class="remove-btn" onclick="removeJobUrl(this)">
            ✕
        </button>
    `;
    container.appendChild(newInput);
    updateGenerateButtonState();
}

function removeJobUrl(button) {
    const jobUrlInput = button.closest('.job-url-input');
    jobUrlInput.remove();
    updateGenerateButtonState();
}

function getJobUrls() {
    // Check which mode is active
    const urlSection = document.getElementById('url-mode-section');
    if (!urlSection.classList.contains('hidden')) {
        // URL mode - get URLs
        const urlInputs = document.querySelectorAll('.job-url');
        const urls = [];
        urlInputs.forEach(input => {
            const url = input.value.trim();
            if (url) {
                urls.push({ url: url, isManual: false });
            }
        });
        return urls;
    } else {
        // Manual mode - get manual jobs
        return getManualJobs();
    }
}

function updateGenerateButtonState() {
    const generateBtn = document.getElementById('generate-all-btn');
    const generateBtnText = document.getElementById('generate-btn-text');

    // Count jobs
    let jobCount = 0;
    const urlSection = document.getElementById('url-mode-section');
    const isUrlMode = !urlSection.classList.contains('hidden');

    if (isUrlMode) {
        // Count URL inputs that have values
        const urlInputs = document.querySelectorAll('.job-url');
        jobCount = Array.from(urlInputs).filter(input => input.value.trim().length > 0).length;
    } else {
        // Count manual job cards that have descriptions
        const manualDescriptions = document.querySelectorAll('.manual-job-description');
        jobCount = Array.from(manualDescriptions).filter(textarea => textarea.value.trim().length > 0).length;
    }

    // Update button text dynamically
    if (jobCount === 0) {
        generateBtnText.textContent = 'Generate Cover Letters';
        generateBtn.classList.remove('ready');
    } else if (jobCount === 1) {
        generateBtnText.textContent = 'Generate 1 Cover Letter';
        generateBtn.classList.add('ready');
    } else {
        generateBtnText.textContent = `Generate ${jobCount} Cover Letters`;
        generateBtn.classList.add('ready');
    }

    // Button is always enabled - validation happens on click
    generateBtn.disabled = false;
}

async function getResumeText() {
    const savedTab = document.getElementById('saved-resume-tab');
    const textTab = document.getElementById('text-resume-tab');
    const fileTab = document.getElementById('file-resume-tab');

    if (savedTab.classList.contains('active')) {
        // Get resume from saved resumes
        const select = document.getElementById('saved-resume-select');
        const resumeId = select.value;

        if (!resumeId) {
            console.log('❌ No saved resume selected');
            return null; // No resume selected
        }

        try {
            const headers = await getAuthHeaders();
            const response = await fetch(`/api/user/resumes/${resumeId}/text`, { headers });

            if (response.ok) {
                const data = await response.json();
                return data.resume_text;
            } else {
                console.error('Failed to fetch resume text');
                return null;
            }
        } catch (error) {
            console.error('Error fetching resume text:', error);
            return null;
        }
    } else if (textTab.classList.contains('active')) {
        const text = document.getElementById('resume').value.trim();
        console.log('📝 Text tab resume length:', text.length);
        return text || null; // Return null if empty string
    } else if (fileTab.classList.contains('active')) {
        console.log('📁 File tab resume text:', resumeText ? resumeText.substring(0, 50) : 'null');
        return resumeText || null; // Return null if empty
    }

    return null;
}

// Mode switching removed - extension-only mode now

// Add a manual job input card
function addManualJob() {
    const container = document.getElementById('manual-jobs-container');
    const currentCount = container.querySelectorAll('.manual-job-card').length;

    const jobCard = document.createElement('div');
    jobCard.className = 'manual-job-card';
    jobCard.setAttribute('data-index', currentCount);
    jobCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h3 style="margin: 0; font-size: 16px; color: #111827;">Job #${currentCount + 1}</h3>
            <button type="button" class="remove-btn" onclick="removeManualJob(this)">✕</button>
        </div>
        <input
            type="text"
            placeholder="Job Title (optional - AI will extract if empty)"
            class="manual-job-title"
            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; margin-bottom: 10px; font-size: 14px;"
        >
        <input
            type="text"
            placeholder="Company Name (optional - AI will extract if empty)"
            class="manual-job-company"
            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; margin-bottom: 10px; font-size: 14px;"
        >
        <textarea
            placeholder="Paste the full job description here...

Example:
We are seeking an experienced Senior Software Engineer...

Responsibilities:
- Design and develop scalable applications
- Lead technical discussions...

Requirements:
- 5+ years of experience...
- Strong knowledge of..."
            class="manual-job-description"
            rows="12"
            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; font-family: inherit; resize: vertical;"
        ></textarea>
    `;

    container.appendChild(jobCard);

    // Update remove button visibility on first job
    updateRemoveButtonsVisibility();
    updateGenerateButtonState();
}

// Remove a manual job input card
function removeManualJob(button) {
    const jobCard = button.closest('.manual-job-card');
    const container = document.getElementById('manual-jobs-container');

    if (container.querySelectorAll('.manual-job-card').length > 1) {
        jobCard.remove();

        // Renumber remaining jobs
        container.querySelectorAll('.manual-job-card').forEach((card, index) => {
            card.setAttribute('data-index', index);
            card.querySelector('h3').textContent = `Job #${index + 1}`;
        });

        updateRemoveButtonsVisibility();
        updateGenerateButtonState();
    }
}

// Update visibility of remove buttons on manual jobs
function updateRemoveButtonsVisibility() {
    const container = document.getElementById('manual-jobs-container');
    const jobCards = container.querySelectorAll('.manual-job-card');

    jobCards.forEach((card, index) => {
        const removeBtn = card.querySelector('.remove-btn');
        if (jobCards.length === 1) {
            removeBtn.style.display = 'none';
        } else {
            removeBtn.style.display = 'block';
        }
    });
}

// Get manual jobs from form
function getManualJobs() {
    const jobCards = document.querySelectorAll('.manual-job-card');
    const jobs = [];

    jobCards.forEach((card, index) => {
        const title = card.querySelector('.manual-job-title').value.trim();
        const company = card.querySelector('.manual-job-company').value.trim();
        const description = card.querySelector('.manual-job-description').value.trim();

        // Only description is required - title and company are optional (AI will extract if missing)
        if (description) {
            jobs.push({
                isManual: true,
                title,
                company,
                description
            });
        }
    });

    return jobs;
}

function updateUrlStatus(index, status, tooltip = '') {
    const urlInputs = document.querySelectorAll('.job-url-input');
    if (index < urlInputs.length) {
        const statusSpan = urlInputs[index].querySelector('.url-status');
        statusSpan.className = 'url-status ' + status;
        if (tooltip) {
            statusSpan.title = tooltip;
        }
    }
}

async function generateAllCoverLetters() {
    console.log('🎯 FRONTEND: generateAllCoverLetters() called');

    // Check if mandatory profile fields are filled FIRST
    const profileValidation = await validateMandatoryProfileFields();
    if (!profileValidation.isValid) {
        showAlertModal('Complete Your Profile', profileValidation.message, 'Open Profile Settings', () => {
            toggleProfileSettingsModal();
        });
        return;
    }

    const resume = await getResumeText();
    const jobUrls = getJobUrls();

    console.log('📝 FRONTEND: Resume retrieved:', resume);
    console.log('📝 FRONTEND: Resume length:', resume ? resume.length : 0);
    console.log('🔗 FRONTEND: Job URLs:', jobUrls);

    if (!resume || resume.trim().length === 0) {
        console.log('❌ FRONTEND: No resume provided');
        showAlertModal('Resume Required', 'Please upload or paste your resume before generating cover letters.', 'OK');
        return;
    }

    if (jobUrls.length === 0) {
        console.log('❌ FRONTEND: No job URLs provided');

        // Check which mode is active to show appropriate error message
        const urlSection = document.getElementById('url-mode-section');
        const isUrlMode = !urlSection.classList.contains('hidden');

        const errorTitle = 'Job Information Required';
        const errorMessage = isUrlMode
            ? 'Please enter at least one job URL before generating cover letters.'
            : 'Please enter at least one job description before generating cover letters.';

        showAlertModal(errorTitle, errorMessage, 'OK');
        return;
    }

    console.log('🚀 FRONTEND: About to make API call');
    const jobCount = jobUrls.length;
    showLoading('Preparing your request...', `Processing ${jobCount} job${jobCount > 1 ? 's' : ''}...`);

    // Show progress indicator with job count
    showProgressIndicator(jobCount);
    setProgressStep(1, 'active'); // Step 1: Preparing

    // Clear all URL statuses
    jobUrls.forEach((_, index) => {
        updateUrlStatus(index, '', '');
    });

    const coverLettersContainer = document.getElementById('cover-letters-container');
    coverLettersContainer.innerHTML = '';

    try {
        console.log('📡 FRONTEND: Sending fetch request to /api/generate-cover-letters');

        // Step 2: Analyzing Jobs
        setProgressStep(2, 'active');
        updateLoadingMessage('Extracting job information...', 'Analyzing job descriptions with AI...');

        // Mark all jobs as processing
        jobUrls.forEach((_, index) => {
            updateJobStatus(index, 'processing', `Job ${index + 1}: Extracting details...`);
        });

        const headers = await getAuthHeaders();
        const response = await fetch('/api/generate-cover-letters', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                resume: resume,
                jobUrls: jobUrls
            }),
        });
        console.log('📡 FRONTEND: Received response:', response.status);

        // Step 3: Generating Letters
        setProgressStep(3, 'active');
        updateLoadingMessage('Generating cover letters...', 'Creating personalized content for each job...');

        const data = await response.json();
        console.log('📦 FRONTEND: Response data:', data);

        if (!response.ok) {
            // Special handling for usage limit errors
            if (response.status === 403 && data.error === 'Usage limit reached') {
                console.log('🚫 Usage limit reached - processing partial results');
                hideLoading();

                // Process any successful results before showing the limit message
                if (data.results && data.results.length > 0) {
                    console.log(`📊 Processing ${data.results.length} partial results`);
                    // Display the partial results first
                    data.results.forEach((result, index) => {
                        if (result.success) {
                            updateUrlStatus(index, 'success', 'Cover letter generated successfully');
                            updateJobStatus(index, 'success', `Job ${index + 1}: Complete!`);
                            if (result.fileData) {
                                // Download immediately, no delay needed
                                downloadFile(result.fileName, result.fileData);
                            }
                        } else {
                            // Mark remaining jobs as not processed due to limit
                            updateJobStatus(index, 'error', `Job ${index + 1}: Limit reached`);
                        }
                    });

                    // Add summary for partial results
                    const successCount = data.results.filter(r => r.success).length;
                    const summaryDiv = document.createElement('div');
                    summaryDiv.className = 'generation-summary';
                    summaryDiv.innerHTML = `
                        <div class="summary-content">
                            <h3>Generation Summary</h3>
                            <div class="summary-stats">
                                <div class="stat-item success">
                                    <span class="stat-icon">✓</span>
                                    <span class="stat-text">${successCount} cover letter${successCount !== 1 ? 's' : ''} generated successfully</span>
                                </div>
                                <div class="stat-item warning">
                                    <span class="stat-icon">⚠</span>
                                    <span class="stat-text">Stopped: Monthly limit reached</span>
                                </div>
                            </div>
                        </div>
                    `;
                    coverLettersContainer.appendChild(summaryDiv);

                    if (successCount > 0) {
                        showSuccess(`${successCount} cover letter${successCount > 1 ? 's' : ''} generated successfully!`);
                    }
                }

                // Refresh usage counter
                await loadUsageCounter();

                // Show modal after a short delay to let downloads start
                console.log('⏰ Setting timeout to show limit reached modal');
                setTimeout(() => {
                    console.log('🎯 Showing limit reached modal');
                    showAlertModal(
                        'Free Tier Limit Reached',
                        'Use a promo code to extend your limit.\n\nIf you don\'t have a promo code, email pradeepadm2017@gmail.com to get one.',
                        'Use Promo Code',
                        () => {
                            togglePromoCodeModal();
                        }
                    );
                }, 500);

                return;
            }
            throw new Error(data.error || 'Failed to generate cover letters');
        }

        // Step 4: Formatting
        setProgressStep(4, 'active');
        updateLoadingMessage('Preparing downloads...', 'Formatting documents...');

        // Display results and update URL statuses
        data.results.forEach((result, index) => {
            console.log(`📋 FRONTEND: Processing result ${index + 1}:`, result);

            if (result.success) {
                // Update URL status to success
                updateUrlStatus(index, 'success', 'Cover letter generated successfully');
                // Update job status to success
                updateJobStatus(index, 'success', `Job ${index + 1}: Complete!`);

                // Auto-download the file
                if (result.fileData) {
                    setTimeout(() => {
                        downloadFile(result.fileName, result.fileData);
                    }, 300 * (index + 1));
                }
            } else {
                // Only show error/fallback messages in the container
                const coverLetterDiv = document.createElement('div');
                coverLetterDiv.className = 'cover-letter';

                // Check if this is a fallback case (failed to fetch job description)
                if (result.usedFallback) {
                    // Update URL status to fallback/warning
                    updateUrlStatus(index, 'fallback', result.fallbackReason);
                    // Update job status to error
                    updateJobStatus(index, 'error', `Job ${index + 1}: Failed to access`);

                    // Check if this is a login wall issue
                    const isLoginWall = result.fallbackReason &&
                        (result.fallbackReason.includes('login wall') ||
                         result.fallbackReason.includes('login page') ||
                         result.fallbackReason.includes('invalid page'));

                    let helpContent = `
                        <div style="background: #fef3c7; border-left: 3px solid #f59e0b; padding: 12px; margin-top: 15px; border-radius: 4px;">
                            <p style="font-size: 13px; color: #92400e; font-weight: 600; margin-bottom: 8px;">💡 Error Details</p>
                            <p style="font-size: 12px; color: #78350f; margin-bottom: 8px;">
                                ${result.fallbackReason || result.error || 'This URL cannot be accessed due to the website\'s policies (login requirements, access restrictions, etc.).'}
                            </p>
                        </div>
                    `;

                    coverLetterDiv.innerHTML = `
                        <h3 style="color: #f59e0b;">⚠️ Job ${index + 1} - Cover Letter Not Generated</h3>
                        <p style="color: #f59e0b; font-size: 14px; margin-bottom: 10px;">
                            We couldn't access this job posting.
                        </p>
                        ${helpContent}
                    `;
                } else {
                    // Update URL status to error
                    updateUrlStatus(index, 'error', result.error);
                    // Update job status to error
                    updateJobStatus(index, 'error', `Job ${index + 1}: Failed`);

                    coverLetterDiv.innerHTML = `
                        <h3 style="color: #dc2626;">Error for Job ${index + 1}</h3>
                        <p style="color: #dc2626;">${result.error}</p>
                    `;
                }

                coverLettersContainer.appendChild(coverLetterDiv);
            }
        });

        const successCount = data.results.filter(r => r.success).length;
        const fallbackCount = data.results.filter(r => r.usedFallback).length;
        const totalCount = data.results.length;

        // Update loading message for downloads
        if (successCount > 0) {
            updateLoadingMessage('Preparing downloads...', `${successCount} cover letter${successCount > 1 ? 's' : ''} ready!`);
        }

        // Add summary section at the bottom
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'generation-summary';
        summaryDiv.innerHTML = `
            <div class="summary-content">
                <h3>Generation Summary</h3>
                <div class="summary-stats">
                    ${successCount > 0 ? `
                    <div class="stat-item success">
                        <span class="stat-icon">✓</span>
                        <span class="stat-text">${successCount} cover letter${successCount !== 1 ? 's' : ''} generated successfully</span>
                    </div>
                    ` : ''}
                    ${fallbackCount > 0 ? `
                    <div class="stat-item warning">
                        <span class="stat-icon">⚠</span>
                        <span class="stat-text">${fallbackCount} URL${fallbackCount !== 1 ? 's' : ''} failed</span>
                    </div>
                    ` : ''}
                    <div class="stat-item total">
                        <span class="stat-icon">📊</span>
                        <span class="stat-text">Total: ${successCount} of ${totalCount} successful</span>
                    </div>
                </div>
            </div>
        `;
        coverLettersContainer.appendChild(summaryDiv);

        if (successCount > 0) {
            let successMsg = `${successCount} cover letter${successCount > 1 ? 's' : ''} generated successfully!`;
            showSuccess(successMsg);
        }

        if (fallbackCount > 0) {
            showError(`${fallbackCount} URL${fallbackCount > 1 ? 's' : ''} failed - could not extract job description`);
        }

        // Complete all progress steps
        completeAllProgress();

        // Hide loading after a short delay to show completed state
        setTimeout(() => {
            hideLoading();
        }, 1500);

    } catch (error) {
        console.error('Generation error:', error);
        hideLoading();

        // Provide specific error messages based on error type
        let errorMsg = 'Unable to generate cover letters.';

        if (error.message) {
            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                errorMsg = 'Connection error. Check your internet connection and try again.';
            } else if (error.message.includes('Not authenticated')) {
                errorMsg = 'Session expired. Please refresh the page and log in again.';
            } else if (error.message.includes('timeout')) {
                errorMsg = 'Request timed out. The job descriptions may be too long. Try with fewer jobs or shorter descriptions.';
            } else {
                errorMsg = error.message;
            }
        }

        showError(errorMsg);
    } finally {
        // Refresh usage counter after generation
        await loadUsageCounter();
    }
}


// User authentication and subscription management
let currentUserData = null;

async function loadUserData() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/auth/status', { headers });
        const data = await response.json();

        if (data.authenticated) {
            currentUserData = data;
            updateUserUI(data);
        } else {
            console.error('Not authenticated, staying on page');
            // Don't redirect - user has session, backend issue
        }
    } catch (error) {
        console.error('Error loading user data:', error);
        // Don't show error or redirect
    }
}

function updateUserUI(data) {
    document.getElementById('user-email').textContent = data.user.email;
    document.getElementById('user-tier').textContent = formatTierName(data.user.tier);
    document.getElementById('user-tier').className = 'tier-badge tier-' + data.user.tier;

    // Update plan buttons
    document.querySelectorAll('.plan-card').forEach(card => {
        const tier = card.getAttribute('data-tier');
        const button = card.querySelector('.btn-plan');

        if (tier === data.user.tier) {
            button.textContent = 'Current Plan';
            button.disabled = true;
        } else {
            button.textContent = tier === 'free' ? 'Downgrade' : 'Upgrade';
            button.disabled = false;
        }
    });

    // Show/hide cancel section
    const cancelSection = document.getElementById('cancel-section');
    if (data.user.tier !== 'free') {
        cancelSection.classList.remove('hidden');
    } else {
        cancelSection.classList.add('hidden');
    }
}

function formatTierName(tier) {
    const names = {
        'free': 'Free',
        'monthly': 'Monthly',
        'quarterly': 'Quarterly',
        'annual': 'Annual'
    };
    return names[tier] || tier;
}

// Logout function is defined earlier in the file (line 92)

function toggleSubscriptionModal() {
    const modal = document.getElementById('subscription-modal');
    modal.classList.toggle('hidden');
}

// Toggle User Dropdown Menu
function toggleUserDropdown() {
    const dropdown = document.getElementById('user-dropdown');
    const button = document.getElementById('user-menu-button');

    dropdown.classList.toggle('hidden');
    button.classList.toggle('active');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('user-dropdown');
    const button = document.getElementById('user-menu-button');

    if (dropdown && button && !dropdown.classList.contains('hidden')) {
        // Check if click is outside both dropdown and button
        if (!dropdown.contains(event.target) && !button.contains(event.target)) {
            dropdown.classList.add('hidden');
            button.classList.remove('active');
        }
    }
});

// Toggle Promo Code Modal
function togglePromoCodeModal() {
    const modal = document.getElementById('promo-code-modal');
    const isHidden = modal.classList.contains('hidden');

    if (isHidden) {
        // Clear input and message when opening
        document.getElementById('promo-code-modal-input').value = '';
        const messageDiv = document.getElementById('promo-modal-message');
        messageDiv.classList.add('hidden');
        messageDiv.textContent = '';
    }

    modal.classList.toggle('hidden');
}

// Apply promo code from the modal
async function applyPromoCodeFromModal() {
    const promoCodeInput = document.getElementById('promo-code-modal-input');
    const messageDiv = document.getElementById('promo-modal-message');
    const promoCode = promoCodeInput.value.trim();

    if (!promoCode) {
        messageDiv.textContent = 'Please enter a promo code';
        messageDiv.style.backgroundColor = '#fee2e2';
        messageDiv.style.color = '#dc2626';
        messageDiv.classList.remove('hidden');
        return;
    }

    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/promo-code/apply', {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ promoCode })
        });

        const data = await response.json();

        if (response.ok) {
            messageDiv.textContent = data.message;
            messageDiv.style.backgroundColor = '#d1fae5';
            messageDiv.style.color = '#047857';
            messageDiv.classList.remove('hidden');

            // Refresh user data to show updated usage
            await loadUserData();

            // Refresh usage counter to show new limit
            await loadUsageCounter();

            // Clear input after success
            setTimeout(() => {
                promoCodeInput.value = '';
            }, 2000);
        } else {
            messageDiv.textContent = data.error || 'Invalid promo code';
            messageDiv.style.backgroundColor = '#fee2e2';
            messageDiv.style.color = '#dc2626';
            messageDiv.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error applying promo code:', error);
        messageDiv.textContent = 'An error occurred. Please try again.';
        messageDiv.style.backgroundColor = '#fee2e2';
        messageDiv.style.color = '#dc2626';
        messageDiv.classList.remove('hidden');
    }
}

async function changePlan(tier) {
    if (tier === currentUserData.user.tier) {
        return;
    }

    // For paid plans, show a message (in real app, this would integrate with Stripe)
    if (tier !== 'free') {
        alert(`Payment integration coming soon!\n\nThis would redirect you to checkout for the ${formatTierName(tier)} plan.`);
        // In production, you would:
        // 1. Create Stripe checkout session
        // 2. Redirect to Stripe checkout
        // 3. Handle webhook to update subscription
        return;
    }

    // For downgrading to free, just update directly
    if (confirm('Are you sure you want to downgrade to the Free plan? You will lose access to premium features.')) {
        try {
            showLoading();
            const headers = await getAuthHeaders();
            const response = await fetch('/api/subscription/change', {
                method: 'POST',
                headers,
                body: JSON.stringify({ tier })
            });

            const data = await response.json();

            if (data.success) {
                currentUserData = data;
                updateUserUI(data);
                showSuccess('Subscription updated successfully');
            } else {
                showError(data.error || 'Failed to update subscription');
            }
        } catch (error) {
            console.error('Error changing plan:', error);
            showError('Failed to update subscription');
        } finally {
            hideLoading();
        }
    }
}

async function cancelSubscription() {
    if (!confirm('Are you sure you want to cancel your subscription? You will lose access to premium features.')) {
        return;
    }

    try {
        showLoading();
        const response = await fetch('/api/subscription/cancel', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            currentUserData = data;
            updateUserUI(data);
            showSuccess('Subscription cancelled successfully');
            toggleSubscriptionModal();
        } else {
            showError(data.error || 'Failed to cancel subscription');
        }
    } catch (error) {
        console.error('Error canceling subscription:', error);
        showError('Failed to cancel subscription');
    } finally {
        hideLoading();
    }
}

async function applyPromoCode() {
    const promoCodeInput = document.getElementById('promo-code-input');
    const promoMessage = document.getElementById('promo-message');
    const promoCode = promoCodeInput.value.trim().toUpperCase();

    if (!promoCode) {
        promoMessage.textContent = 'Please enter a promo code';
        promoMessage.className = 'promo-message error';
        promoMessage.classList.remove('hidden');
        return;
    }

    try {
        showLoading();
        const headers = await getAuthHeaders();
        const response = await fetch('/api/promo-code/apply', {
            method: 'POST',
            headers,
            body: JSON.stringify({ promoCode })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            promoMessage.textContent = data.message;
            promoMessage.className = 'promo-message success';
            promoMessage.classList.remove('hidden');
            promoCodeInput.value = '';

            // Reload user data to update usage display
            await loadUserData();

            // Refresh usage counter to show new limit
            await loadUsageCounter();

            showSuccess('Promo code applied successfully!');
        } else {
            promoMessage.textContent = data.error || 'Failed to apply promo code';
            promoMessage.className = 'promo-message error';
            promoMessage.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error applying promo code:', error);
        promoMessage.textContent = 'Failed to apply promo code';
        promoMessage.className = 'promo-message error';
        promoMessage.classList.remove('hidden');
    } finally {
        hideLoading();
    }
}

// Function to download file from base64 data
function downloadFile(fileName, base64Data) {
    try {
        // Convert base64 to binary
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // Create blob and download
        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        console.log(`✅ Downloaded: ${fileName}`);
    } catch (error) {
        console.error('Error downloading file:', error);
        showError('Failed to download file: ' + fileName);
    }
}

// Validate mandatory profile fields before generating cover letters
async function validateMandatoryProfileFields() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/user/profile', { headers });

        if (!response.ok) {
            // Profile doesn't exist or error fetching - treat as missing profile
            return {
                isValid: false,
                message: 'Please set up your profile before generating cover letters. Click "Profile Settings" to add your Full Name, Email, and Phone Number.'
            };
        }

        const profile = await response.json();

        // Check if mandatory fields are filled
        const missingFields = [];
        if (!profile.full_name || profile.full_name.trim() === '') {
            missingFields.push('Full Name');
        }
        if (!profile.phone || profile.phone.trim() === '') {
            missingFields.push('Phone Number');
        }

        // Email is always filled from account, but let's check anyway
        const email = currentUser?.email || '';
        if (!email || email.trim() === '') {
            missingFields.push('Email');
        }

        if (missingFields.length > 0) {
            return {
                isValid: false,
                message: `Please complete your profile before generating cover letters. Missing required fields: ${missingFields.join(', ')}. Click "Profile Settings" to fill in these details.`
            };
        }

        return { isValid: true };
    } catch (error) {
        console.error('Error validating profile fields:', error);
        // Network error or other issue - be clear about what to do
        return {
            isValid: false,
            message: 'Please set up your profile before generating cover letters. Click "Profile Settings" to add your Full Name, Email, and Phone Number.'
        };
    }
}

// Profile Settings Modal Functions
function toggleProfileSettingsModal() {
    const modal = document.getElementById('profile-settings-modal');
    const isHidden = modal.classList.contains('hidden');

    if (isHidden) {
        // Opening modal - load current settings and reset button
        resetSaveButton();
        loadProfileSettings();
    }

    modal.classList.toggle('hidden');
}

function resetSaveButton() {
    const saveButton = document.querySelector('.btn-save-profile');
    if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = 'Save Settings';
        saveButton.classList.remove('has-changes');
    }
}

async function loadProfileSettings() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/user/profile', { headers });

        if (response.ok) {
            const profile = await response.json();

            // Populate form fields
            document.getElementById('profile-fullname').value = profile.full_name || '';
            document.getElementById('profile-credentials').value = profile.credentials || '';
            document.getElementById('profile-city').value = profile.city || '';
            document.getElementById('profile-email').value = profile.email || currentUser?.email || '';
            document.getElementById('profile-phone').value = profile.phone || '';
            document.getElementById('profile-linkedin').value = profile.linkedin_url || '';

            // Set header template
            const templateRadio = document.querySelector(`input[name="header-template"][value="${profile.header_template || 'center'}"]`);
            if (templateRadio) {
                templateRadio.checked = true;
            }

            // Set header color
            const colorRadio = document.querySelector(`input[name="header-color"][value="${profile.header_color || '#000000'}"]`);
            if (colorRadio) {
                colorRadio.checked = true;
            }

            // Set font settings
            console.log('📝 Loading font settings:', {
                header_font: profile.header_font,
                header_font_size: profile.header_font_size,
                body_font: profile.body_font,
                body_font_size: profile.body_font_size,
                page_border: profile.page_border
            });

            document.getElementById('header-font').value = profile.header_font || 'Calibri';
            document.getElementById('header-font-size').value = profile.header_font_size || 16;
            document.getElementById('body-font').value = profile.body_font || 'Calibri';
            document.getElementById('body-font-size').value = profile.body_font_size || 12;

            // Set page border
            const borderRadio = document.querySelector(`input[name="page-border"][value="${profile.page_border || 'narrow'}"]`);
            if (borderRadio) {
                borderRadio.checked = true;
            }

            console.log('✅ Font settings loaded - Header:', document.getElementById('header-font').value, document.getElementById('header-font-size').value, '| Body:', document.getElementById('body-font').value, document.getElementById('body-font-size').value);

            // Update preview
            updateHeaderPreview();

            // Store initial settings and reset save button
            storeInitialProfileSettings();
            updateSaveButtonState();
        } else {
            // Profile doesn't exist yet (first-time user) - set up defaults
            console.log('📝 First-time user - setting up default profile');

            // Populate with defaults
            document.getElementById('profile-fullname').value = '';
            document.getElementById('profile-credentials').value = '';
            document.getElementById('profile-city').value = '';
            document.getElementById('profile-email').value = currentUser?.email || '';
            document.getElementById('profile-phone').value = '';
            document.getElementById('profile-linkedin').value = '';

            // Set default template and color (already checked in HTML)
            // Update preview with defaults
            updateHeaderPreview();

            // Store initial settings as empty - any input will trigger save button
            storeInitialProfileSettings();
            updateSaveButtonState();
        }
    } catch (error) {
        console.error('Error loading profile settings:', error);
        // Still populate email and set up for first-time user
        document.getElementById('profile-email').value = currentUser?.email || '';
        // Store initial settings so button can be enabled
        storeInitialProfileSettings();
        updateSaveButtonState();
    }
}

async function saveProfileSettings() {
    const saveButton = document.querySelector('.btn-save-profile');
    const originalButtonText = saveButton.textContent;

    try {
        const saveMessage = document.getElementById('profile-save-message');
        saveMessage.classList.add('hidden');

        // Disable button and show loading state
        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';

        // Get form values
        const profileData = {
            email: document.getElementById('profile-email').value.trim(),
            full_name: document.getElementById('profile-fullname').value.trim(),
            credentials: document.getElementById('profile-credentials').value.trim(),
            city: document.getElementById('profile-city').value.trim(),
            phone: document.getElementById('profile-phone').value.trim(),
            linkedin_url: document.getElementById('profile-linkedin').value.trim(),
            header_template: document.querySelector('input[name="header-template"]:checked').value,
            header_color: document.querySelector('input[name="header-color"]:checked').value,
            header_font: document.getElementById('header-font').value,
            header_font_size: parseInt(document.getElementById('header-font-size').value) || 16,
            body_font: document.getElementById('body-font').value,
            body_font_size: parseInt(document.getElementById('body-font-size').value) || 12,
            page_border: document.querySelector('input[name="page-border"]:checked').value
        };

        // Client-side validation
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (profileData.email && !emailPattern.test(profileData.email)) {
            saveButton.disabled = false;
            saveButton.textContent = originalButtonText;
            showAlertModal('Invalid Email', 'Please enter a valid email address (e.g., john@example.com)');
            return;
        }

        const phonePattern = /^[\d\s\-\(\)\+\.]+$/;
        if (profileData.phone) {
            const cleanPhone = profileData.phone.replace(/[\s\-\(\)\.]/g, '');
            if (!phonePattern.test(profileData.phone) || cleanPhone.length < 10 || cleanPhone.length > 15) {
                saveButton.disabled = false;
                saveButton.textContent = originalButtonText;
                showAlertModal('Invalid Phone Number', 'Phone number must be 10-15 digits and can contain spaces, dashes, or parentheses.\n\nExamples:\n• (555) 123-4567\n• 555-123-4567\n• +1 555 123 4567');
                return;
            }
        }

        const linkedinPattern = /^(https?:\/\/)?(www\.)?linkedin\.com\/(in|pub|profile)\/[\w\-]+\/?$/i;
        if (profileData.linkedin_url && !linkedinPattern.test(profileData.linkedin_url)) {
            saveButton.disabled = false;
            saveButton.textContent = originalButtonText;
            showAlertModal('Invalid LinkedIn URL', 'LinkedIn URL must be in the format:\nhttps://www.linkedin.com/in/your-profile\n\nExample:\nhttps://www.linkedin.com/in/john-doe');
            return;
        }

        const headers = await getAuthHeaders();
        const response = await fetch('/api/user/profile', {
            method: 'POST',
            headers,
            body: JSON.stringify(profileData)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Update initial settings to current settings (reset change tracking)
            storeInitialProfileSettings();

            // Reset button before closing
            saveButton.disabled = false;
            saveButton.textContent = 'Save Settings';

            // Show success message briefly
            showSuccess('Profile settings saved!');

            // Close modal immediately
            toggleProfileSettingsModal();
        } else {
            console.error('Profile save failed:', response.status, data);
            const errorMessage = data.error || 'Failed to save profile settings. Please try again.';

            // Re-enable button on error
            saveButton.disabled = false;
            saveButton.textContent = originalButtonText;
            updateSaveButtonState(); // Restore proper button state

            // Show error in alert modal
            showAlertModal('Validation Error', errorMessage);
        }
    } catch (error) {
        console.error('Error saving profile settings:', error);

        // Re-enable button on error
        saveButton.disabled = false;
        saveButton.textContent = originalButtonText;
        updateSaveButtonState(); // Restore proper button state

        // Show error in alert modal
        showAlertModal('Network Error', 'Unable to save profile settings. Please check your connection and try again.');
    }
}

// Track profile settings changes
let initialProfileSettings = null;

function getCurrentProfileSettings() {
    const settings = {
        email: document.getElementById('profile-email')?.value.trim() || '',
        full_name: document.getElementById('profile-fullname')?.value.trim() || '',
        credentials: document.getElementById('profile-credentials')?.value.trim() || '',
        city: document.getElementById('profile-city')?.value.trim() || '',
        phone: document.getElementById('profile-phone')?.value.trim() || '',
        linkedin_url: document.getElementById('profile-linkedin')?.value.trim() || '',
        header_template: document.querySelector('input[name="header-template"]:checked')?.value || 'center',
        header_color: document.querySelector('input[name="header-color"]:checked')?.value || '#000000',
        header_font: document.getElementById('header-font')?.value || 'Calibri',
        header_font_size: document.getElementById('header-font-size')?.value || '16',
        body_font: document.getElementById('body-font')?.value || 'Calibri',
        body_font_size: document.getElementById('body-font-size')?.value || '12',
        page_border: document.querySelector('input[name="page-border"]:checked')?.value || 'narrow'
    };
    return settings;
}

function storeInitialProfileSettings() {
    initialProfileSettings = getCurrentProfileSettings();
}

function updateSaveButtonState() {
    const saveButton = document.querySelector('.btn-save-profile');
    if (!saveButton) return;

    if (!initialProfileSettings) {
        // If we don't have initial settings yet, button should be grey and disabled
        saveButton.classList.remove('has-changes');
        saveButton.disabled = true;
        return;
    }

    const currentSettings = getCurrentProfileSettings();
    const hasChanges = JSON.stringify(currentSettings) !== JSON.stringify(initialProfileSettings);

    console.log('🔄 Checking for changes:', hasChanges);
    console.log('Initial:', initialProfileSettings);
    console.log('Current:', currentSettings);

    if (hasChanges) {
        saveButton.classList.add('has-changes');
        saveButton.disabled = false;
    } else {
        saveButton.classList.remove('has-changes');
        saveButton.disabled = true;
    }
}

function updateHeaderPreview() {
    const preview = document.getElementById('header-preview');
    const template = document.querySelector('input[name="header-template"]:checked').value;
    const color = document.querySelector('input[name="header-color"]:checked').value;

    const fullName = document.getElementById('profile-fullname').value.trim();
    const credentials = document.getElementById('profile-credentials').value.trim();
    const city = document.getElementById('profile-city').value.trim();
    const email = document.getElementById('profile-email').value.trim();
    const phone = document.getElementById('profile-phone').value.trim();
    const linkedin = document.getElementById('profile-linkedin').value.trim();

    if (template === 'none') {
        preview.innerHTML = '<p class="preview-message">No header will be added to your cover letters</p>';
        return;
    }

    // Build header lines
    let line1 = fullName || 'Your Name';
    if (credentials) {
        line1 += ', ' + credentials;
    }

    // Build line 2 with smart separators
    const line2Parts = [];
    if (city) line2Parts.push(city);
    if (email) line2Parts.push(email);
    if (phone) line2Parts.push(phone);
    if (linkedin) {
        // Show shortened LinkedIn URL in preview
        const linkedinDisplay = linkedin.replace(/^(https?:\/\/)?(www\.)?/, '');
        line2Parts.push(linkedinDisplay);
    }

    const line2 = line2Parts.length > 0 ? line2Parts.join(' | ') : 'Contact info will appear here';

    const alignment = template === 'center' ? 'center' : 'left';

    preview.innerHTML = `
        <div style="text-align: ${alignment}; color: ${color}; font-family: Calibri, sans-serif;">
            <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">${line1}</div>
            <div style="font-size: 12px; margin-bottom: 8px;">${line2}</div>
            <hr style="border: none; border-top: 1px solid ${color}; opacity: 0.5;">
        </div>
    `;
}

// ===== RESUME MANAGEMENT FUNCTIONS =====

// Global variable to store resumes
let userResumes = [];

// Toggle Manage Resumes Modal
function toggleManageResumesModal() {
    const modal = document.getElementById('manage-resumes-modal');
    const isHidden = modal.classList.contains('hidden');

    if (isHidden) {
        // Opening modal - load resumes and clear any messages
        loadResumesForModal();
        clearUploadError();
        clearUploadSuccess();
        clearResumeActionMessage();
    }

    modal.classList.toggle('hidden');
}

// Helper function to show upload success
function showUploadSuccess(message) {
    const successDiv = document.getElementById('upload-success-message');
    if (successDiv) {
        successDiv.textContent = message;
        successDiv.classList.remove('hidden');
        // Auto-hide after 5 seconds
        setTimeout(() => {
            successDiv.classList.add('hidden');
        }, 5000);
    }
}

// Helper function to show upload error
function showUploadError(message) {
    const errorDiv = document.getElementById('upload-error-message');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
    }
}

// Helper function to clear upload error
function clearUploadError() {
    const errorDiv = document.getElementById('upload-error-message');
    if (errorDiv) {
        errorDiv.textContent = '';
        errorDiv.classList.add('hidden');
    }
}

// Helper function to clear upload success
function clearUploadSuccess() {
    const successDiv = document.getElementById('upload-success-message');
    if (successDiv) {
        successDiv.textContent = '';
        successDiv.classList.add('hidden');
    }
}

// Helper function to show resume action message (for deletes, renames, set default, etc.)
function showResumeActionMessage(message, isSuccess = true) {
    const messageDiv = document.getElementById('resume-action-message');
    if (messageDiv) {
        // Clear previous states
        messageDiv.classList.remove('success', 'error');

        messageDiv.textContent = message;
        messageDiv.classList.remove('hidden');

        if (isSuccess) {
            messageDiv.classList.add('success');
        } else {
            messageDiv.classList.add('error');
        }

        // Auto-hide after 5 seconds
        setTimeout(() => {
            messageDiv.classList.add('hidden');
            messageDiv.classList.remove('success', 'error');
        }, 5000);
    }
}

// Helper function to clear resume action message
function clearResumeActionMessage() {
    const messageDiv = document.getElementById('resume-action-message');
    if (messageDiv) {
        messageDiv.textContent = '';
        messageDiv.classList.add('hidden');
        messageDiv.classList.remove('success', 'error');
    }
}

// Load saved resumes for the dropdown
async function loadSavedResumes() {
    console.log('🔄 loadSavedResumes: Starting...');
    try {
        const headers = await getAuthHeaders();
        console.log('🔄 loadSavedResumes: Got auth headers');
        const response = await fetch('/api/user/resumes', { headers });
        console.log('🔄 loadSavedResumes: Received response:', response.status);

        if (response.ok) {
            userResumes = await response.json();
            console.log('🔄 loadSavedResumes: Loaded', userResumes.length, 'resumes');
            const select = document.getElementById('saved-resume-select');

            if (!select) {
                console.error('❌ saved-resume-select element not found!');
                return;
            }

            if (userResumes.length === 0) {
                select.innerHTML = '<option value="">No saved resumes. Upload one using Manage Resumes.</option>';
            } else {
                // Sort resumes: default first, then by created_at descending
                const sortedResumes = [...userResumes].sort((a, b) => {
                    if (a.is_default && !b.is_default) return -1;
                    if (!a.is_default && b.is_default) return 1;
                    return new Date(b.created_at) - new Date(a.created_at);
                });

                select.innerHTML = '<option value="">Select a resume...</option>';
                sortedResumes.forEach(resume => {
                    const option = document.createElement('option');
                    option.value = resume.id;
                    option.textContent = resume.nickname + (resume.is_default ? ' (Default)' : '');
                    if (resume.is_default) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                });
                console.log('✅ loadSavedResumes: Successfully populated dropdown');

                // Update resume count status
                updateResumeCountStatus(userResumes.length);

                // Show preview for default resume if exists
                const defaultResume = userResumes.find(r => r.is_default);
                if (defaultResume) {
                    showResumePreview(defaultResume.id);
                }
            }
        } else {
            console.error('❌ loadSavedResumes: Failed to load saved resumes - status:', response.status);
            const select = document.getElementById('saved-resume-select');
            if (select) {
                select.innerHTML = '<option value="">Error loading resumes</option>';
            }
            updateResumeCountStatus(0);
        }
    } catch (error) {
        console.error('❌ loadSavedResumes: Error:', error);
        const select = document.getElementById('saved-resume-select');
        if (select) {
            select.innerHTML = '<option value="">Error loading resumes</option>';
        }
        updateResumeCountStatus(0);
    }
}

// Update resume count status message
function updateResumeCountStatus(count) {
    const statusEl = document.getElementById('resume-count-status');
    if (!statusEl) return;

    if (count === 0) {
        statusEl.textContent = 'No saved resumes.';
    } else if (count === 1) {
        statusEl.textContent = 'You have 1 saved resume.';
    } else {
        statusEl.textContent = `You have ${count} saved resumes.`;
    }
}

// Show preview of selected resume
async function showResumePreview(resumeId) {
    if (!resumeId) {
        // Hide preview if no resume selected
        document.getElementById('resume-preview').classList.add('hidden');
        return;
    }

    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/user/resumes/${resumeId}/text`, { headers });

        if (response.ok) {
            const data = await response.json();
            const resumeText = data.resume_text;

            // Show preview
            const previewEl = document.getElementById('resume-preview');
            const previewTextEl = document.getElementById('resume-preview-text');
            const wordCountEl = document.getElementById('resume-word-count');

            // Calculate word count
            const wordCount = resumeText.trim().split(/\s+/).length;
            wordCountEl.textContent = `${wordCount} words`;

            // Show first 500 characters (approximately 80-100 words)
            const previewText = resumeText.substring(0, 500);
            previewTextEl.textContent = previewText + (resumeText.length > 500 ? '...' : '');

            previewEl.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error loading resume preview:', error);
    }
}

// Load resumes for the modal list
async function loadResumesForModal() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/user/resumes', { headers });

        if (response.ok) {
            userResumes = await response.json();
            displayResumesList(userResumes);
        } else {
            console.error('Failed to load resumes for modal');
        }
    } catch (error) {
        console.error('Error loading resumes for modal:', error);
    }
}

// Display resumes list in modal
function displayResumesList(resumes) {
    const listContainer = document.getElementById('resumes-list');

    if (resumes.length === 0) {
        listContainer.innerHTML = '<p class="no-resumes-text">No resumes yet. Upload your first resume above!</p>';
        return;
    }

    listContainer.innerHTML = resumes.map(resume => `
        <div class="resume-item" data-resume-id="${resume.id}">
            <div class="resume-info">
                <div class="resume-nickname">${resume.nickname}${resume.is_default ? ' <span class="default-badge">Default</span>' : ''}</div>
                <div class="resume-details">
                    ${resume.file_name} • ${(resume.file_size / 1024).toFixed(1)} KB • ${new Date(resume.created_at).toLocaleDateString()}
                </div>
            </div>
            <div class="resume-actions">
                ${!resume.is_default ? `<button class="btn-icon" onclick="setDefaultResume('${resume.id}')" title="Set as default">⭐</button>` : ''}
                <button class="btn-icon" onclick="renameResume('${resume.id}', '${resume.nickname.replace(/'/g, "\\'")}')" title="Rename">✏️</button>
                <button class="btn-icon btn-delete" onclick="deleteResume('${resume.id}')" title="Delete">🗑️</button>
            </div>
        </div>
    `).join('');
}

// Upload new resume
async function uploadNewResume() {
    const nicknameInput = document.getElementById('new-resume-nickname');
    const fileInput = document.getElementById('new-resume-file');
    const fileNameDisplay = document.getElementById('new-resume-file-name');
    const uploadButton = document.querySelector('.upload-form .btn-primary');

    const nickname = nicknameInput.value.trim();
    const file = fileInput.files[0];

    // Clear any previous errors
    clearUploadError();

    if (!nickname) {
        showUploadError('Please enter a nickname for your resume (e.g., "Software Engineer Resume" or "Marketing Resume").');
        return;
    }

    if (!file) {
        showUploadError('Please select a file to upload. Click "Choose File" or drag and drop a resume file.');
        return;
    }

    // Validate file type
    const allowedTypes = ['.doc', '.docx', '.txt'];
    const fileExt = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowedTypes.includes(fileExt)) {
        showUploadError(`File type "${fileExt}" is not supported. Please use DOC, DOCX, or TXT format.`);
        return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
        showUploadError(`File is too large (${fileSizeMB}MB). Maximum size is 10MB. Try compressing the file or remove images.`);
        return;
    }

    try {
        const formData = new FormData();
        formData.append('nickname', nickname);
        formData.append('resume', file);

        const headers = await getAuthHeaders();
        // Remove Content-Type header to let browser set it with boundary for multipart
        delete headers['Content-Type'];

        const response = await fetch('/api/user/resumes', {
            method: 'POST',
            headers: headers,
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            // Clear form
            nicknameInput.value = '';
            fileInput.value = '';
            fileNameDisplay.textContent = 'No file chosen';
            if (uploadButton) {
                uploadButton.classList.remove('file-selected');
            }

            // Clear any errors
            clearUploadError();

            // Show success message in the modal
            showUploadSuccess('Resume uploaded successfully!');

            // Reload resumes
            await loadResumesForModal();
            await loadSavedResumes();
        } else {
            showUploadError(data.error || 'Failed to upload resume.');
        }
    } catch (error) {
        console.error('Error uploading resume:', error);
        showUploadError('An error occurred while uploading the resume.');
    }
}

// Set default resume
async function setDefaultResume(resumeId) {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/user/resumes/${resumeId}`, {
            method: 'PUT',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ is_default: true })
        });

        if (response.ok) {
            // Show success message in the modal
            showResumeActionMessage('Default resume updated successfully!');

            // Reload resumes
            await loadResumesForModal();
            await loadSavedResumes();
        } else {
            const data = await response.json();
            showResumeActionMessage(data.error || 'Failed to set default resume.', false);
        }
    } catch (error) {
        console.error('Error setting default resume:', error);
        showResumeActionMessage('An error occurred while setting default resume.', false);
    }
}

// Rename resume
async function renameResume(resumeId, currentNickname) {
    const newNickname = prompt('Enter new nickname:', currentNickname);

    if (!newNickname || newNickname.trim() === currentNickname) {
        return; // User cancelled or didn't change
    }

    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/user/resumes/${resumeId}`, {
            method: 'PUT',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ nickname: newNickname.trim() })
        });

        if (response.ok) {
            // Show success message in the modal
            showResumeActionMessage('Resume renamed successfully!');

            // Reload resumes
            await loadResumesForModal();
            await loadSavedResumes();
        } else {
            const data = await response.json();
            showResumeActionMessage(data.error || 'Failed to rename resume.', false);
        }
    } catch (error) {
        console.error('Error renaming resume:', error);
        showResumeActionMessage('An error occurred while renaming the resume.', false);
    }
}

// Delete resume
async function deleteResume(resumeId) {
    if (!confirm('Are you sure you want to delete this resume? This action cannot be undone.')) {
        return;
    }

    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/user/resumes/${resumeId}`, {
            method: 'DELETE',
            headers: headers
        });

        if (response.ok) {
            // Show success message in the modal
            showResumeActionMessage('Resume deleted successfully!');

            // Reload resumes
            await loadResumesForModal();
            await loadSavedResumes();
        } else {
            const data = await response.json();
            showResumeActionMessage(data.error || 'Failed to delete resume.', false);
        }
    } catch (error) {
        console.error('Error deleting resume:', error);
        showResumeActionMessage('An error occurred while deleting the resume.', false);
    }
}

// Event listener for new resume file input
document.addEventListener('DOMContentLoaded', function() {
    const newResumeFileInput = document.getElementById('new-resume-file');
    if (newResumeFileInput) {
        newResumeFileInput.addEventListener('change', function() {
            const fileNameDisplay = document.getElementById('new-resume-file-name');
            const uploadButton = document.querySelector('.upload-form .btn-primary');

            if (this.files.length > 0) {
                fileNameDisplay.textContent = this.files[0].name;
                // Enable and highlight the upload button
                if (uploadButton) {
                    uploadButton.classList.add('file-selected');
                }
            } else {
                fileNameDisplay.textContent = 'No file chosen';
                // Remove highlight from upload button
                if (uploadButton) {
                    uploadButton.classList.remove('file-selected');
                }
            }
        });
    }
});

// Close modals when clicking outside
window.onclick = function(event) {
    const subscriptionModal = document.getElementById('subscription-modal');
    const profileModal = document.getElementById('profile-settings-modal');
    const manageResumesModal = document.getElementById('manage-resumes-modal');
    const promoCodeModal = document.getElementById('promo-code-modal');

    if (event.target === subscriptionModal) {
        toggleSubscriptionModal();
    }
    if (event.target === profileModal) {
        toggleProfileSettingsModal();
    }
    if (event.target === manageResumesModal) {
        toggleManageResumesModal();
    }
    if (event.target === promoCodeModal) {
        togglePromoCodeModal();
    }
}

// Event listeners
document.getElementById('resume').addEventListener('input', updateGenerateButtonState);

// Add event listener for URL inputs and manual job inputs
document.addEventListener('input', function(e) {
    if (e.target.classList.contains('job-url') ||
        e.target.classList.contains('manual-job-title') ||
        e.target.classList.contains('manual-job-company') ||
        e.target.classList.contains('manual-job-description')) {
        updateGenerateButtonState();
    }

    // Update profile header preview when profile inputs change
    if (e.target.classList.contains('profile-input')) {
        updateHeaderPreview();
        updateSaveButtonState();
    }
});

// Add event listener for template, color, and border radio buttons
document.addEventListener('change', function(e) {
    if (e.target.name === 'header-template' || e.target.name === 'header-color') {
        updateHeaderPreview();
        updateSaveButtonState();
    }
    // Also update preview when page margins change
    if (e.target.name === 'page-border') {
        console.log('📐 Page margins changed to:', e.target.value);
        updateSaveButtonState();
    }
    // Update preview when font settings change
    if (e.target.id === 'header-font' || e.target.id === 'body-font' ||
        e.target.id === 'header-font-size' || e.target.id === 'body-font-size') {
        console.log('🔤 Font setting changed:', e.target.id, '=', e.target.value);
        updateHeaderPreview();
    }
});

// Initialize the page
document.addEventListener('DOMContentLoaded', async function() {
    try {
        await initAuth(); // Initialize Supabase auth first
        updateGenerateButtonState();
        loadUserData();
        await loadSavedResumes(); // Load saved resumes for the dropdown
        initFormInputUX(); // Initialize form input UX improvements
        initResumeTabEnhancements(); // Initialize resume tab enhancements
    } catch (error) {
        console.error('Error initializing app:', error);
        // Show a fallback option if resumes fail to load
        const select = document.getElementById('saved-resume-select');
        if (select && select.value === '') {
            select.innerHTML = '<option value="">No saved resumes</option>';
        }
    }
});

// Initialize resume tab enhancements
function initResumeTabEnhancements() {
    // Add event listener for resume selection change
    const resumeSelect = document.getElementById('saved-resume-select');
    if (resumeSelect) {
        resumeSelect.addEventListener('change', function() {
            showResumePreview(this.value);
        });
    }

    // Add drag & drop handlers for file upload
    const dropZone = document.getElementById('file-drop-zone');
    if (dropZone) {
        dropZone.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', function(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.remove('drag-over');

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const resumeFileInput = document.getElementById('resume-file');
                resumeFileInput.files = files;
                handleResumeFileUpload(resumeFileInput);
            }
        });
    }
}

// ====================================
// FORM INPUT UX IMPROVEMENTS
// ====================================

/**
 * Initialize all form input UX improvements:
 * - Character counters for textareas
 * - Real-time validation feedback
 * - Enhanced focus states
 */
function initFormInputUX() {
    console.log('Initializing form input UX improvements...');

    // Initialize character counter for resume textarea
    const resumeTextarea = document.getElementById('resume');
    if (resumeTextarea) {
        setupCharacterCounter(
            resumeTextarea,
            'resume-char-count',
            50000
        );
    }

    // Initialize character counters for manual job descriptions
    updateManualJobCounters();

    // Add validation for profile inputs
    initProfileInputValidation();

    console.log('Form input UX improvements initialized');
}

/**
 * Setup character counter for a textarea
 * @param {HTMLElement} textarea - The textarea element
 * @param {string} counterId - ID of the counter display element
 * @param {number} maxLength - Maximum character length
 */
function setupCharacterCounter(textarea, counterId, maxLength) {
    const counter = document.getElementById(counterId);
    if (!counter) return;

    const updateCounter = () => {
        const currentLength = textarea.value.length;
        counter.textContent = currentLength.toLocaleString();

        // Update counter color based on usage
        const counterWrapper = counter.parentElement;
        counterWrapper.classList.remove('warning', 'error');

        const percentUsed = (currentLength / maxLength) * 100;
        if (percentUsed >= 95) {
            counterWrapper.classList.add('error');
        } else if (percentUsed >= 80) {
            counterWrapper.classList.add('warning');
        }
    };

    // Update on input
    textarea.addEventListener('input', updateCounter);

    // Initial update
    updateCounter();
}

/**
 * Update character counters for all manual job description textareas
 */
function updateManualJobCounters() {
    const jobDescriptions = document.querySelectorAll('.manual-job-description');
    jobDescriptions.forEach((textarea, index) => {
        const wrapper = textarea.closest('.field-wrapper');
        if (!wrapper) return;

        const counter = wrapper.querySelector('.manual-job-char-count');
        if (!counter) return;

        const updateCounter = () => {
            const currentLength = textarea.value.length;
            counter.textContent = currentLength.toLocaleString();

            // Update counter color based on usage
            const counterWrapper = counter.parentElement;
            counterWrapper.classList.remove('warning', 'error');

            const percentUsed = (currentLength / 30000) * 100;
            if (percentUsed >= 95) {
                counterWrapper.classList.add('error');
            } else if (percentUsed >= 80) {
                counterWrapper.classList.add('warning');
            }
        };

        // Remove existing listeners by cloning
        const newTextarea = textarea.cloneNode(true);
        textarea.parentNode.replaceChild(newTextarea, textarea);

        // Add new listener
        newTextarea.addEventListener('input', updateCounter);

        // Initial update
        updateCounter();
    });
}

/**
 * Show validation message for a field
 * @param {string} validationId - ID of the validation message element
 * @param {string} message - Message to display
 * @param {string} type - Type of message: 'error', 'success', or 'warning'
 */
function showValidationMessage(validationId, message, type = 'error') {
    const validationEl = document.getElementById(validationId);
    if (!validationEl) return;

    // Clear existing classes and add new type
    validationEl.classList.remove('error', 'success', 'warning', 'hidden');
    validationEl.classList.add(type);

    // Set icon based on type
    let icon = '❌';
    if (type === 'success') icon = '✅';
    if (type === 'warning') icon = '⚠️';

    // Set content
    validationEl.innerHTML = `
        <span class="validation-icon">${icon}</span>
        <span>${message}</span>
    `;
}

/**
 * Hide validation message
 * @param {string} validationId - ID of the validation message element
 */
function hideValidationMessage(validationId) {
    const validationEl = document.getElementById(validationId);
    if (!validationEl) return;

    validationEl.classList.add('hidden');
}

/**
 * Validate a textarea field
 * @param {HTMLElement} textarea - The textarea to validate
 * @param {number} minLength - Minimum required length
 * @param {string} fieldName - Name of the field for error messages
 * @returns {Object} Validation result with isValid and message
 */
function validateTextarea(textarea, minLength, fieldName) {
    const value = textarea.value.trim();

    if (value.length === 0) {
        return {
            isValid: false,
            message: `${fieldName} is required. Please fill in this field.`,
            type: 'error'
        };
    }

    if (value.length < minLength) {
        return {
            isValid: false,
            message: `${fieldName} is too short (${value.length} characters). Please provide at least ${minLength} characters for better results.`,
            type: 'warning'
        };
    }

    return {
        isValid: true,
        message: `${fieldName} looks good!`,
        type: 'success'
    };
}

/**
 * Add real-time validation to a textarea
 * @param {HTMLElement} textarea - The textarea element
 * @param {string} validationId - ID of the validation message element
 * @param {number} minLength - Minimum required length
 * @param {string} fieldName - Name of the field
 */
function addTextareaValidation(textarea, validationId, minLength, fieldName) {
    if (!textarea) return;

    let validationTimeout;

    const validate = () => {
        clearTimeout(validationTimeout);

        // Only show validation after user has started typing
        if (textarea.value.length === 0) {
            hideValidationMessage(validationId);
            textarea.classList.remove('error', 'success');
            return;
        }

        // Debounce validation by 500ms
        validationTimeout = setTimeout(() => {
            const result = validateTextarea(textarea, minLength, fieldName);

            // Update textarea styling
            textarea.classList.remove('error', 'success');
            if (!result.isValid) {
                textarea.classList.add('error');
            } else {
                textarea.classList.add('success');
            }

            // Show validation message
            showValidationMessage(validationId, result.message, result.type);
        }, 500);
    };

    textarea.addEventListener('input', validate);
    textarea.addEventListener('blur', validate);
}

/**
 * Initialize profile input validation with better feedback
 */
function initProfileInputValidation() {
    // Add validation to email input in profile settings
    const profileEmail = document.getElementById('profile-email');
    if (profileEmail) {
        profileEmail.addEventListener('blur', function() {
            const email = this.value.trim();
            if (email && !isValidEmail(email)) {
                this.classList.add('error');
                this.classList.remove('success');
            } else if (email) {
                this.classList.add('success');
                this.classList.remove('error');
            } else {
                this.classList.remove('error', 'success');
            }
        });

        profileEmail.addEventListener('input', function() {
            // Clear error state while typing
            if (this.classList.contains('error')) {
                this.classList.remove('error');
            }
        });
    }

    // Add validation to phone input
    const profilePhone = document.getElementById('profile-phone');
    if (profilePhone) {
        profilePhone.addEventListener('blur', function() {
            const phone = this.value.trim();
            if (phone && phone.length < 10) {
                this.classList.add('error');
                this.classList.remove('success');
            } else if (phone) {
                this.classList.add('success');
                this.classList.remove('error');
            } else {
                this.classList.remove('error', 'success');
            }
        });

        profilePhone.addEventListener('input', function() {
            if (this.classList.contains('error')) {
                this.classList.remove('error');
            }
        });
    }
}

/**
 * Simple email validation
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Update addManualJob function to reinitialize counters
const originalAddManualJob = window.addManualJob;
if (typeof originalAddManualJob === 'function') {
    window.addManualJob = function() {
        originalAddManualJob();
        // Reinitialize character counters after adding a new job
        setTimeout(() => {
            updateManualJobCounters();
        }, 100);
    };
}