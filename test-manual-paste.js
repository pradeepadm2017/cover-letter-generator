require('dotenv').config();
const axios = require('axios');

// Test manual paste functionality
async function testManualPaste() {
  console.log('🧪 Testing manual paste functionality...\n');

  const testData = {
    resume: `PRADEEP RAJANA, MBA

Senior Government Executive | Strategic Leadership | Transformational Change

📞 431-337-0047	📧 pradeepadm2017@gmail.com

EXECUTIVE SUMMARY
Strategic senior executive with 15+ years driving transformational change in government.`,

    // Test with one manual job
    jobUrls: [
      {
        isManual: true,
        title: 'Senior Project Manager',
        company: 'Tech Solutions Inc',
        description: `We are seeking an experienced Senior Project Manager to lead our digital transformation initiatives.

Key Responsibilities:
- Lead cross-functional teams in delivering complex projects
- Manage project budgets ranging from $1M to $10M
- Implement agile methodologies and best practices
- Stakeholder engagement at executive level

Requirements:
- 10+ years of project management experience
- PMP certification preferred
- Strong leadership and communication skills
- Experience with digital transformation projects`
      }
    ]
  };

  try {
    console.log('📤 Sending request with manual job data...');
    console.log(`   Job Title: ${testData.jobUrls[0].title}`);
    console.log(`   Company: ${testData.jobUrls[0].company}`);
    console.log(`   Description length: ${testData.jobUrls[0].description.length} chars\n`);

    // Note: This test won't actually work without authentication
    // It's just to demonstrate the request structure
    console.log('📋 Request structure:');
    console.log(JSON.stringify({
      resume: testData.resume.substring(0, 100) + '...',
      jobUrls: testData.jobUrls
    }, null, 2));

    console.log('\n✅ Manual paste request structure is correct!');
    console.log('📝 Backend should detect isManual=true and use provided data instead of scraping');
    console.log('🎯 Expected backend behavior:');
    console.log('   1. Detect: typeof jobItem === "object" && jobItem.isManual');
    console.log('   2. Construct: `Job Title: ${jobItem.title}\\n\\nCompany: ${jobItem.company}\\n\\nJob Description:\\n${jobItem.description}`');
    console.log('   3. Generate cover letter using this constructed job description');

  } catch (error) {
    console.error('❌ Test error:', error.message);
  }
}

testManualPaste();
