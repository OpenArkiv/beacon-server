/**
 * PM2 dev runner: mirrors `pnpm run dev` (tsx watch).
 * Start:  pm2 start ecosystem.config.cjs
 * Logs:   pm2 logs beacon-server-dev
 * Stop:   pm2 stop beacon-server-dev
 */
module.exports = {
  apps: [
    {
      name: "beacon-server-dev",
      script: "pnpm",
      args: "run dev",
      cwd: __dirname,
      interpreter: "none",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
