require('dotenv').config();
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { AssemblyAI } = require('assemblyai');
const mm = require('music-metadata');
const fsPromise = require('fs').promises;

const folderToMonitor = '../zoom-recording'; // Replace with your actual folder path
const databasePath = 'leads_and_recordings.db';

const db = new Database(databasePath);

const client = new AssemblyAI({
  apiKey: 'enter your API key here',
});

function extractLeadId(folderName) {
  const match = folderName.match(/Lead (\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

async function getAudioMetadata(filepath) {
  try {
    const stats = await fsPromise.stat(filepath);
    const modificationTime = stats.mtime;
    const fileSizeInBytes = stats.size;

    // Read the first 100 bytes of the file to check for M4A header
    const fileHandle = await fsPromise.open(filepath, 'r');
    const buffer = Buffer.alloc(100);
    await fileHandle.read(buffer, 0, 100, 0);
    await fileHandle.close();

    // Check for M4A header (ftyp)
    const isM4A = buffer.slice(4, 8).toString() === 'ftyp';

    if (!isM4A) {
      throw new Error('Not a valid M4A file');
    }

    // M4A files typically use AAC codec with a bitrate around 128 kbps
    // This is a rough estimate and may not be accurate for all M4A files
    const estimatedBitrateKbps = 128;
    const estimatedDurationInSeconds = (fileSizeInBytes * 8) / (estimatedBitrateKbps * 1000);

    return {
      callTime: modificationTime.toISOString(),
      callDuration: Math.round(estimatedDurationInSeconds),
      fileSize: fileSizeInBytes
    };
  } catch (error) {
    console.error('Error extracting audio metadata:', error);
    return null;
  }
}


async function transcribeAndAnalyze(filepath) {
  try {
    const transcript = await client.transcripts.transcribe({
      audio: filepath,
      sentiment_analysis: true,
      dual_channel: true
    });

    // Step 2: Define your prompt
    const prompt = `Analyze the following transcript of a sales call between a potential lead and a sales agent. The original motive is to convince the lead to invest in an edtech course.

    Transcript:
    ${transcript.text}

    Utterances:
    ${transcript.utterances.map(u => `Speaker ${u.speaker}: ${u.text}`).join('\n')}

    Sentiment Analysis:
    ${JSON.stringify(transcript.sentiment_analysis_results, null, 2)}

    Based on the above information, analyze the following aspects:
    1. The profession of the person being interviewed
    2. Their years of experience in that profession
    3. Their pros and cons as a potential customer
    4. How they should be approached in future calls to convert them into a customer
    5. Their lead score on a scale of 1-10 and the reasoning behind it
    6. Tips and suggestions for the sales agent to improve

    IMPORTANT: Your entire response must be a valid JSON object with the following structure. Do not include any text outside of this JSON object:

    {
      "profession": "string",
      "yearsOfExperience": number,
      "customerProfile": {
        "pros": ["string", "string", ...],
        "cons": ["string", "string", ...]
      },
      "approachStrategy": "string",
      "leadScore": number,
      "leadScoreReasoning": "string",
      "salesAgentTips": ["string", "string", ...]
    }

    Ensure that all string values are properly escaped if they contain quotes or special characters. The yearsOfExperience and leadScore must be numbers, not strings. Each array should contain at least one item.`;

    // Step 3: Apply LeMUR
    const { response } = await client.lemur.task({
      transcript_ids: [transcript.id],
      prompt,
      final_model: 'anthropic/claude-3-sonnet'
    });

    console.log('Raw LeMUR response:', response);

    try {
      const parsedResponse = JSON.parse(response);
      console.log('Parsed JSON response:', parsedResponse);
      return parsedResponse;
    } catch (jsonError) {
      console.error('Error parsing JSON response:', jsonError);
      console.error('Raw response:', response);
      throw new Error('Invalid JSON response from LeMUR API');
    }
  } catch (error) {
    console.error('Error in transcribeAndAnalyze:', error);
    if (error.response) {
      console.error('API response:', error.response.data);
    }
    throw error;
  }
}

async function uploadToDatabase(leadId, filename, filepath) {
  try {
    const fileContent = fs.readFileSync(filepath);
    
    const analysis = await transcribeAndAnalyze(filepath);
    const metadata = await getAudioMetadata(filepath);
    
    const insertRecording = db.prepare(`
      INSERT INTO recordings (
        lead_id, filename, file, profession, years_of_experience, customer_pros, customer_cons, 
        approach_strategy, lead_score, lead_score_reasoning, call_time, call_duration, sales_agent_tips
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    insertRecording.run(
      leadId,
      filename,
      fileContent,
      analysis.profession,
      analysis.yearsOfExperience,
      JSON.stringify(analysis.customerProfile.pros),
      JSON.stringify(analysis.customerProfile.cons),
      analysis.approachStrategy,
      analysis.leadScore,
      analysis.leadScoreReasoning,
      metadata.callTime,
      metadata.callDuration,
      JSON.stringify(analysis.salesAgentTips)
    );

    console.log(`File ${filename} uploaded to the database with AI analysis and metadata for lead ${leadId}`);
    console.log('AI Analysis:', JSON.stringify(analysis, null, 2));
    console.log('Metadata:', JSON.stringify(metadata, null, 2));
  } catch (error) {
    console.error(`Error processing file ${filename}:`, error);
  }
}

const watcher = chokidar.watch(folderToMonitor, {
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: true,
  depth: 1,
});

watcher
  .on('add', async (filepath) => {
    const filename = path.basename(filepath);
    const fileExt = path.extname(filepath).toLowerCase();
    
    if (fileExt === '.m4a') {
      const folderName = path.basename(path.dirname(filepath));
      const leadId = extractLeadId(folderName);
      
      if (leadId) {
        console.log(`New .m4a file detected: ${filename} for Lead ID: ${leadId}`);
        await uploadToDatabase(leadId, filename, filepath);
      } else {
        console.log(`Could not extract Lead ID from folder name: ${folderName}`);
      }
    }
  })
  .on('error', (error) => console.error(`Watcher error: ${error}`))
  .on('ready', () => console.log('Initial scan complete. Ready for changes'));

console.log(`Monitoring folder: ${folderToMonitor}`);

process.on('SIGINT', () => {
  console.log('Closing database connection...');
  db.close();
  process.exit(0);
});