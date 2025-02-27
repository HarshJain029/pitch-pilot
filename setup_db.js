const Database = require('better-sqlite3');

const db = new Database('leads_and_recordings.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    zoom_link TEXT
  );
  
    CREATE TABLE IF NOT EXISTS recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    file BLOB NOT NULL,
    profession TEXT,
    years_of_experience INTEGER,
    customer_pros TEXT,
    customer_cons TEXT,
    approach_strategy TEXT,
    lead_score INTEGER,
    lead_score_reasoning TEXT,
    call_time DATETIME,
    call_duration INTEGER,
    sales_agent_tips TEXT,
    upload_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );
`);

console.log('Database schema created');
db.close();