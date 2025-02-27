require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2');
const axios = require('axios');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const sheets = google.sheets('v4');

const app = express();
const port = 3000;

// Zoom API credentials (replace with your own)
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID || '';
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET || '';
const ZOOM_REDIRECT_URL = 'http://localhost:3000/auth/zoom/callback';

// Set up the database connection
const db = new Database('leads_and_recordings.db');

app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Set up session with secret from environment variable
app.use(session({
  secret: process.env.SESSION_SECRET || '',
  resave: false,
  saveUninitialized: false
}));

// Set up Passport
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Set up Zoom OAuth2 strategy
passport.use('zoom', new OAuth2Strategy({
  authorizationURL: 'https://zoom.us/oauth/authorize',
  tokenURL: 'https://zoom.us/oauth/token',
  clientID: ZOOM_CLIENT_ID,
  clientSecret: ZOOM_CLIENT_SECRET,
  callbackURL: ZOOM_REDIRECT_URL
},
  (accessToken, refreshToken, profile, done) => {
    // Store tokens in session
    return done(null, { accessToken, refreshToken });
  }));

// Middleware to make user available to EJS templates
app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

// Zoom auth routes
app.get('/auth/zoom', passport.authenticate('zoom'));

app.get('/auth/zoom/callback',
  passport.authenticate('zoom', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/?login=success');
  }
);

// Simplified logout route
app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

// Function to get Zoom access token
async function getZoomAccessToken(req) {
  if (req.user && req.user.accessToken) {
    return req.user.accessToken;
  } else {
    throw new Error('No Zoom access token available');
  }
}

// Route to display the list of leads
app.get('/', (req, res) => {
  const leads = db.prepare('SELECT * FROM leads').all();
  res.render('index', { leads, user: req.user });
});

// API to get all leads
app.get('/api/leads', (req, res) => {
  const leads = db.prepare('SELECT * FROM leads').all();
  res.json(leads);
});

// API to schedule a Zoom call
app.post('/api/schedule-call', async (req, res) => {
  const { leadId, scheduledTime } = req.body;

  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, error: 'Not authenticated', needsAuth: true });
  }

  try {
    const accessToken = await getZoomAccessToken(req);

    // Schedule Zoom meeting
    const response = await axios.post('https://api.zoom.us/v2/users/me/meetings', {
      topic: `Meeting with Lead ${leadId}`,
      type: 2, // Scheduled meeting
      start_time: scheduledTime,
      duration: 40, // 1 hour
      timezone: 'UTC',
      settings: {
        host_video: false,
        participant_video: false,
        join_before_host: true,
        mute_upon_entry: false,
        watermark: false,
        use_pmi: false,
        approval_type: 0,
        registration_type: 1,
        audio: 'both',
        waiting_room: false,
        invitees: [
          {
            email: "ayurs5695@gmail.com"
          }
        ]
      }
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const zoomLink = response.data.join_url;
    console.log(zoomLink);

    // Update lead with Zoom link
    db.prepare('UPDATE leads SET zoom_link = ? WHERE id = ?').run(zoomLink, leadId);

    res.json({ success: true, zoomLink });
  } catch (error) {
    console.error('Error scheduling Zoom call:', error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, error: 'Failed to schedule call', details: error.response ? error.response.data : error.message });
  }
});

// Route to serve the audio file
app.get('/audio/:id', (req, res) => {
  try {
    const file = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
    if (file) {
      const absolutePath = path.resolve(__dirname, file.filepath);

      if (fs.existsSync(absolutePath)) {
        res.sendFile(absolutePath);
      } else {
        res.status(404).send('File not found on server');
      }
    } else {
      res.status(404).send('Recording not found in database');
    }
  } catch (error) {
    console.error(`Unexpected error: ${error}`);
    res.status(500).send(`Unexpected error: ${error.message}`);
  }
});

// Route to display lead details
app.get('/lead/:id', (req, res) => {
  const leadId = req.params.id;
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  const recordings = db.prepare('SELECT * FROM recordings WHERE lead_id = ?').all(leadId);

  if (!lead) {
    return res.status(404).send('Lead not found');
  }

  res.render('lead-details', { lead, recordings });
});

// Function to convert nested JSON to a flat table
function jsonToFlatTable(jsonData) {
  const flattenObject = (obj, prefix = '') => {
    return Object.keys(obj).reduce((acc, k) => {
      const pre = prefix.length ? prefix + '.' : '';
      if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
        Object.assign(acc, flattenObject(obj[k], pre + k));
      } else {
        acc[pre + k] = obj[k];
      }
      return acc;
    }, {});
  };

  const flatData = Array.isArray(jsonData) ? jsonData.map(item => flattenObject(item)) : [flattenObject(jsonData)];
  return flatData;
}

// Function to authenticate Google Sheets
async function authenticateGoogleSheets(credsFile) {
  const auth = new google.auth.GoogleAuth({
    keyFile: credsFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

// Function to write data to Google Sheet
async function writeDataToGoogleSheet(sheetId, sheetName, data, uniqueIdColumn, credsFile) {
  const auth = await authenticateGoogleSheets(credsFile);

  // Get existing data from the sheet
  const response = await sheets.spreadsheets.values.get({
    auth,
    spreadsheetId: sheetId,
    range: sheetName,
  });
  const existingData = response.data.values || [];

  // Convert existing data to an array of objects
  const headers = existingData[0];
  const existingRows = existingData.slice(1).map(row => {
    return headers.reduce((obj, header, index) => {
      obj[header] = row[index];
      return obj;
    }, {});
  });

  // Merge incoming data with existing data
  data.forEach(incomingRow => {
    const existingRowIndex = existingRows.findIndex(row => row[uniqueIdColumn] === incomingRow[uniqueIdColumn]);
    if (existingRowIndex !== -1) {
      // Update existing row
      Object.keys(incomingRow).forEach(key => {
        if (!existingRows[existingRowIndex][key] || existingRows[existingRowIndex][key] === '') {
          existingRows[existingRowIndex][key] = incomingRow[key];
        }
      });
    } else {
      // Add new row
      existingRows.push(incomingRow);
    }
  });

  // Prepare data for writing back to the sheet
  const updatedData = [headers, ...existingRows.map(row => headers.map(header => row[header] || ''))];

  // Write updated data back to the sheet
  await sheets.spreadsheets.values.update({
    auth,
    spreadsheetId: sheetId,
    range: sheetName,
    valueInputOption: 'RAW',
    resource: { values: updatedData },
  });

  return "Data written successfully to Google Sheets.";
}

// API endpoint
app.post('/api/update-sheet', async (req, res) => {
  try {
    const jsonData = req.body;

    const sheetId = '1RYJCc-cJL7QVrgE9XfnTUgWgUZCTfH25Me7FtJ1Ttb8';
    const sheetName = 'Sheet1';
    const uniqueIdColumn = 'email';
    const credsFile = {
      "type": "service_account",
      "project_id": "Pitch-Pilot-436321",
      "private_key_id": "enter your private keyId here",
      "private_key": "'Enter your private key here'",
      "client_email": "Pitch-Pilot-29@Pitch-Pilot-436321.iam.gserviceaccount.com",
      "client_id": "109983819254874664988",
      "auth_uri": "https://accounts.google.com/o/oauth2/auth",
      "token_uri": "https://oauth2.googleapis.com/token",
      "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
      "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/Pitch-Pilot-29%40Pitch-Pilot-436321.iam.gserviceaccount.com",
      "universe_domain": "googleapis.com"
    }
      ;
    if (!jsonData || !sheetId || !sheetName || !uniqueIdColumn || !credsFile) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const flatTable = jsonToFlatTable(jsonData);
    const result = await writeDataToGoogleSheet(sheetId, sheetName, flatTable, uniqueIdColumn, credsFile);

    res.json({ message: result });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while processing the request' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});


app.get('/', (req, res) => {
  const leads = db.prepare(`
    SELECT leads.*, recordings.lead_score 
    FROM leads 
    LEFT JOIN recordings ON leads.id = recordings.lead_id
  `).all();

  const hasLeadScores = leads.some(lead => lead.lead_score !== null);

  res.render('index', { leads, user: req.user, hasLeadScores });
});

// New API endpoint for sorting leads
app.get('/api/sorted-leads', (req, res) => {
  const sortBy = req.query.sortBy;
  let leads;

  if (sortBy === 'score') {
    leads = db.prepare(`
      SELECT leads.*, recordings.lead_score 
      FROM leads 
      LEFT JOIN recordings ON leads.id = recordings.lead_id
      ORDER BY CASE WHEN recordings.lead_score IS NULL THEN 1 ELSE 0 END, 
               recordings.lead_score DESC, 
               leads.id ASC
    `).all();
  } else {
    leads = db.prepare(`
      SELECT leads.*, recordings.lead_score 
      FROM leads 
      LEFT JOIN recordings ON leads.id = recordings.lead_id
      ORDER BY leads.id ASC
    `).all();
  }

  res.json(leads);
});

// API to update lead details
app.post('/api/lead/:id', (req, res) => {
  const leadId = req.params.id;
  const { name, email, phone, profession, yearsOfExperience, customerPros, customerCons, approachStrategy, leadScore, leadScoreReasoning } = req.body;

  const updateLead = db.prepare(`
    UPDATE leads 
    SET name = ?, email = ?, phone = ? 
    WHERE id = ?
  `);

  const updateRecording = db.prepare(`
    UPDATE recordings 
    SET profession = ?, years_of_experience = ?, customer_pros = ?, customer_cons = ?, 
        approach_strategy = ?, lead_score = ?, lead_score_reasoning = ?
    WHERE lead_id = ?
  `);

  db.transaction(() => {
    updateLead.run(name, email, phone, leadId);
    updateRecording.run(profession, yearsOfExperience, JSON.stringify(customerPros), JSON.stringify(customerCons),
      approachStrategy, leadScore, leadScoreReasoning, leadId);
  })();

  res.json({ success: true });
});
