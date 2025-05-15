module.exports = {
  apps: [{
    name: "calendar-weather",
    script: "index.js",
    watch: true,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 4000,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    env: {
      NODE_ENV: "production"
    }
  }]
}; 