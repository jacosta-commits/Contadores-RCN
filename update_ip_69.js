const { sql, query } = require('./server/dal/db');
const logger = require('./server/lib/logger');

async function run() {
    try {
        logger.info('Updating Telar 69 IP to 192.168.1.122...');
        await query(`
      UPDATE dbo.RCN_CONT_TELAR
      SET modbus_ip = '192.168.1.122', activo = 1
      WHERE telcod = '0069'
    `);
        logger.info('Update successful!');
        process.exit(0);
    } catch (e) {
        logger.error('Update failed:', e);
        process.exit(1);
    }
}

run();
