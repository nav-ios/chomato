/**
 * PM2 ecosystem: run multiple monitor instances.
 * Copy this file and fill in ZOMATO_PHONE and NTFY_TOPIC per user.
 *
 * First-time setup per user (interactive OTP + address selection):
 *   ZOMATO_PHONE=9999999999 NTFY_TOPIC=your-topic STATE_DIR=state node index.js
 * Then restart under PM2:
 *   pm2 restart ecosystem.config.js
 */
module.exports = {
  apps: [
    {
      name: 'chomato-monitor',
      script: 'index.js',
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        ZOMATO_PHONE: 'YOUR_PHONE_NUMBER',
        NTFY_TOPIC: 'your-ntfy-topic',
        STATE_DIR: 'state',
      },
    },
    // Uncomment and duplicate for additional users:
    // {
    //   name: 'chomato-monitor-friend',
    //   script: 'index.js',
    //   cwd: __dirname,
    //   autorestart: true,
    //   restart_delay: 5000,
    //   env: {
    //     ZOMATO_PHONE: 'FRIEND_PHONE_NUMBER',
    //     NTFY_TOPIC: 'friend-ntfy-topic',
    //     STATE_DIR: 'state-friend',
    //   },
    // },
  ],
};
