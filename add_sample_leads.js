const Database = require('better-sqlite3'); 

const db = new Database('leads_and_recordings.db');

// Sample lead data
const sampleLeads = [
  { name: 'Arjun', email: 'arjunmadhan@live.com', phone: '+971523563372' },
  { name: 'vikas', email: 'purohitvikas12@gmail.com', phone: '+918127791117' },
  { name: 'Ayush', email: 'ayurs5695@gmail.com', phone: '+9154909748' },
  { name: 'Bob Brown', email: 'bob.brown@example.com', phone: '456-789-0123' },
  { name: 'Charlie Davis', email: 'charlie.davis@example.com', phone: '567-890-1234' }
];

// Prepare the SQL statement to insert leads
const insertLead = db.prepare('INSERT INTO leads (name, email, phone) VALUES (?, ?, ?)');

// Insert each sample lead
sampleLeads.forEach(lead => {
  try {
    insertLead.run(lead.name, lead.email, lead.phone);
    console.log(`Added lead: ${lead.name}`);
  } catch (error) {
    console.error(`Error adding lead ${lead.name}:`, error.message);
  }
});

console.log('Sample leads added successfully');
db.close();