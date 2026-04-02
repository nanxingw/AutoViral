module.exports = {
  apps: [{
    name: "autoviral",
    script: "dist/index.js",
    watch: false,
    max_restarts: 10,
    restart_delay: 3000,
    env: {
      NODE_ENV: "production",
    },
  }],
};
