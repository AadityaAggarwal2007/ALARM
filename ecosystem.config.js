// PM2 entries for the alarm app and its own Cloudflare tunnel.
//
// Kept in this repo, and started with `pm2 start ecosystem.config.js`, so the
// existing batchpro / wa-otp / cloudflared entries are never edited. The alarm
// only fires while these two are running: the server holds the schedule and
// sends the push, and the tunnel is what makes it reachable from the phone.
//
//   pm2 start ecosystem.config.js
//   pm2 save
//
// `pm2 save` is the part that matters — without it the processes do not come
// back after a reboot, and a reboot overnight means no alarm in the morning.

module.exports = {
  apps: [
    {
      name: "alarm",
      cwd: "C:\\Users\\Aaditya Aggarwal\\Desktop\\claude\\ALARM",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3002 -H 0.0.0.0",
      interpreter: "node",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 20,
    },
    {
      name: "alarm-tunnel",
      script: "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
      args:
        'tunnel --config "C:\\Users\\Aaditya Aggarwal\\.cloudflared\\alarm-config.yml" --no-autoupdate run',
      interpreter: "none",
      autorestart: true,
      max_restarts: 20,
    },
  ],
};
