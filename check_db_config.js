const { query, sql } = require('./server/dal/db');

async function run() {
    try {
        const rs = await query(`
      SELECT telcod, telnom, grupo, modbus_ip, modbus_port, modbus_unit_id, modo, activo
      FROM dbo.RCN_CONT_TELAR
      WHERE telcod = '0069'
    `);
        const row = rs.recordset[0];
        if (row) {
            console.log(`IP: ${row.modbus_ip}`);
            console.log(`Port: ${row.modbus_port}`);
            console.log(`ID: ${row.modbus_unit_id}`);
        } else {
            console.log('Telar 0069 not found');
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
