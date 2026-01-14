const { sql, query } = require('./server/dal/db');
const logger = require('./server/lib/logger');

async function fixSessions() {
    try {
        console.log('Fixing sessions...');
        const res = await query(`
      UPDATE dbo.RCN_CONT_CACHE
      SET session_active = 1, updated_at = GETDATE()
      WHERE sescod IS NOT NULL AND session_active = 0
    `);
        console.log(`Fixed ${res.rowsAffected[0]} rows.`);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

fixSessions();
