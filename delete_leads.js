const Database = require('better-sqlite3');

const db = new Database('leads_and_recordings.db');

function deleteLeadById(id) {
  const deleteLead = db.prepare('DELETE FROM leads WHERE id = ?');
  const result = deleteLead.run(id);
  if (result.changes > 0) {
    console.log(`Lead with ID ${id} has been deleted.`);
  } else {
    console.log(`No lead found with ID ${id}.`);
  }
}

function deleteAllLeads() {
  const deleteAll = db.prepare('DELETE FROM leads');
  const result = deleteAll.run();
  console.log(`${result.changes} lead(s) have been deleted.`);
}

// Check command line arguments
if (process.argv[2] === 'all') {
  deleteAllLeads();
} else if (process.argv[2]) {
  deleteLeadById(process.argv[2]);
} else {
  console.log('Usage: node delete_leads.js [id|all]');
  console.log('  id: Delete a specific lead by ID');
  console.log('  all: Delete all leads');
}

// Close the database connection
db.close();