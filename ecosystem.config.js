module.exports = {
    apps: [
        {
            name: 'RCN-Contadores',
            script: 'server/server.js',
            cwd: 'C:/Users/Administrador/Downloads/Desarrollos_FISA/RCN/RCN-Contadores/contadores-web',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'production',
                PORT: 3020
            }
        }
    ]
};
