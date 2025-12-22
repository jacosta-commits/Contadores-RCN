const { sql, query } = require('./server/dal/db');
const logger = require('./server/lib/logger');

async function check() {
    try {
        const res = await query(`
      SELECT * FROM dbo.RCN_CONT_CACHE WHERE telcod = '0064'
    `);
        console.log('CACHE CONTENT:', JSON.stringify(res.recordset[0], null, 2));
    } catch (e) {
        console.error(e);
    }
    process.exit();
}

check();
