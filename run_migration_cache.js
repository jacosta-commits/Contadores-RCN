const { query } = require('./server/dal/db');
const logger = require('./server/lib/logger');

async function run() {
    try {
        logger.info('Adding hil_acum_offset column to RCN_CONT_CACHE...');
        await query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[RCN_CONT_CACHE]') AND name = 'hil_acum_offset')
      BEGIN
          ALTER TABLE [dbo].[RCN_CONT_CACHE] ADD [hil_acum_offset] INT DEFAULT 0 WITH VALUES;
          PRINT 'Column hil_acum_offset added to RCN_CONT_CACHE.';
      END
      ELSE
      BEGIN
          PRINT 'Column hil_acum_offset already exists in RCN_CONT_CACHE.';
      END
    `);
        logger.info('Migration completed.');
        process.exit(0);
    } catch (e) {
        logger.error(e, 'Migration failed');
        process.exit(1);
    }
}

run();
