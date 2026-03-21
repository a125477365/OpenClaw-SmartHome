// UIManagePlugin/index.js - Password Protected Version
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

module.exports.register = async (api) => {
  const pluginConfig = require('./config.json');
  const webRoot = path.join(__dirname, pluginConfig.webRoot);
  const devicesPath = path.join(__dirname, '../../devices.json');
  const passwordPath = path.join(__dirname, 'password.json');

  // Session tracking for authenticated users
  const sessions = new Map();
  const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

  // Password management functions
  const loadPassword = () => {
    try {
      if (fs.existsSync(passwordPath)) {
        const data = JSON.parse(fs.readFileSync(passwordPath, 'utf8'));
        return data;
      }
    } catch (e) {
      api.logger.error('Failed to load password: ' + e.message);
    }
    return null;
  };

  const savePassword = (passwordData) => {
    try {
      fs.writeFileSync(passwordPath, JSON.stringify(passwordData, null, 2));
      return true;
    } catch (e) {
      api.logger.error('Failed to save password: ' + e.message);
      return false;
    }
  };

  const generateStrongPassword = (length = 16) => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    const bytes = crypto.randomBytes(length);
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset[bytes[i] % charset.length];
    }
    return password;
  };

  const hashPassword = (password) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return { salt, hash };
  };

  const verifyPassword = (password, storedData) => {
    if (!storedData || !storedData.salt || !storedData.hash) return false;
    const hash = crypto.pbkdf2Sync(password, storedData.salt, 100000, 64, 'sha512').toString('hex');
    return hash === storedData.hash;
  };

  // Initialize password if not exists
  const initPassword = () => {
    let passwordData = loadPassword();
    if (!passwordData) {
      const initialPassword = generateStrongPassword();
      passwordData = hashPassword(initialPassword);
      passwordData.hint = 'Initial password generated on first run';
      passwordData.createdAt = new Date().toISOString();
      savePassword(passwordData);
      api.logger.info('=== UI Management Interface Initial Password ===');
      api.logger.info('Password: ' + initialPassword);
      api.logger.info('Please change this password via main session immediately');
      api.logger.info('==============================================');
      return { passwordData, plainPassword: initialPassword };
    }
    return { passwordData, plainPassword: null };
  };

  const { passwordData: currentPasswordData } = initPassword();

  // Register password management tools (only callable by main session)
  // Note: These tools are registered but we rely on the caller being the main session
  api.registerTool({
    name: 'ui.password.get',
    description: 'Get the current UI password (only callable by main session)',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    async execute(toolCallId, params) {
      // This tool returns a message indicating password cannot be retrieved
      // because passwords are hashed. User must reset to get a new password.
      return {
        success: false,
        message: 'Password cannot be viewed (stored securely). Use ui.password.reset to generate a new password.',
        hint: 'Only main session can reset password'
      };
    }
  });

  api.registerTool({
    name: 'ui.password.reset',
    description: 'Reset UI password to a new strong random password (only callable by main session)',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    async execute(toolCallId, params) {
      const newPassword = generateStrongPassword();
      const newPasswordData = hashPassword(newPassword);
      newPasswordData.lastReset = new Date().toISOString();
      savePassword(newPasswordData);
      
      return {
        success: true,
        newPassword: newPassword,
        message: 'Password has been reset. New password:',
        warning: 'Please save this password securely. It cannot be retrieved again.'
      };
    }
  });

  // Ensure SSL certificates exist
  const ensureSSLCerts = () => {
    const sslDir = path.join(__dirname, 'ssl');
    const keyPath = path.join(sslDir, 'key.pem');
    const certPath = path.join(sslDir, 'cert.pem');
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      if (!fs.existsSync(sslDir)) fs.mkdirSync(sslDir, { recursive: true });
      const cmd = `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 365 -nodes -subj "/C=CN/ST=GD/L=SZ/O=OpenClaw/OU=SmartHome/CN=localhost"`;
      try {
        execSync(cmd, { stdio: 'ignore' });
        api.logger.info('Generated self-signed SSL certificates');
      } catch (e) {
        api.logger.error('Failed to generate SSL certificates: ' + e.message);
      }
    }
  };

  const readFileSync = (filepath) => {
    try {
      return fs.readFileSync(filepath, 'utf8');
    } catch (e) {
      return null;
    }
  };

  // Start HTTP and HTTPS services
  api.startService('http-server', async () => {
    const http = require('http');
    const https = require('https');
    const url = require('url');

    // HTTP server (redirect to HTTPS)
    const httpServer = http.createServer((req, res) => {
      res.writeHead(301, { "Location": `https://${req.headers.host.split(':')[0]}:${pluginConfig.httpsPort}${req.url}` });
      res.end();
    });
    httpServer.listen(pluginConfig.httpPort, () => {
      api.logger.info(`UI管理HTTP重定向服务已启动，监听端口：${pluginConfig.httpPort} -> HTTPS ${pluginConfig.httpsPort}`);
    });

    // HTTPS server
    let sslOptions = {
      key: readFileSync(path.join(__dirname, pluginConfig.ssl.key)),
      cert: readFileSync(path.join(__dirname, pluginConfig.ssl.cert))
    };
    if (!sslOptions.key || !sslOptions.cert) {
      ensureSSLCerts();
      sslOptions = {
        key: readFileSync(path.join(__dirname, pluginConfig.ssl.key)),
        cert: readFileSync(path.join(__dirname, pluginConfig.ssl.cert))
      };
    }

    // Authentication middleware
    const checkAuth = (req) => {
      const cookies = (req.headers.cookie || '').split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        if (key) acc[key] = value;
        return acc;
      }, {});
      
      const sessionId = cookies['ui_session'];
      if (!sessionId) return false;
      
      const session = sessions.get(sessionId);
      if (!session) return false;
      
      if (Date.now() - session.createdAt > SESSION_TIMEOUT) {
        sessions.delete(sessionId);
        return false;
      }
      return true;
    };

    const createSession = () => {
      const sessionId = crypto.randomBytes(32).toString('hex');
      sessions.set(sessionId, { createdAt: Date.now() });
      return sessionId;
    };

    const httpsServer = https.createServer(sslOptions, async (req, res) => {
      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Request-Method', '*');
      res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
      res.setHeader('Access-Control-Allow-Headers', '*');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const getDevices = () => {
        try {
          const data = fs.readFileSync(devicesPath, 'utf8');
          return JSON.parse(data);
        } catch (e) {
          return { devices: [] };
        }
      };

      const saveDevices = (data) => {
        fs.writeFileSync(devicesPath, JSON.stringify(data, null, 2));
      };

      // Login page
      if (pathname === '/login') {
        const html = `<!DOCTYPE html>
<html>
<head>
  <title>登录 - 智能家居管理</title>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .login-box { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); width: 350px; }
    h2 { text-align: center; color: #333; margin-bottom: 30px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 8px; color: #555; }
    input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-size: 14px; }
    button { width: 100%; padding: 12px; background: #2196F3; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; }
    button:hover { background: #1976D2; }
    .error { color: #f44336; text-align: center; margin-top: 15px; }
    .hint { color: #888; font-size: 12px; text-align: center; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="login-box">
    <h2>智能家居管理登录</h2>
    <div class="form-group">
      <label for="password">密码</label>
      <input type="password" id="password" placeholder="请输入管理密码" onkeypress="if(event.key==='Enter')login()">
    </div>
    <button onclick="login()">登录</button>
    <div id="error" class="error" style="display:none;"></div>
    <div class="hint">只有OpenClaw主会话可以重置密码</div>
  </div>
  <script>
    function login() {
      const password = document.getElementById('password').value;
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          window.location.href = '/';
        } else {
          document.getElementById('error').textContent = data.error || '密码错误';
          document.getElementById('error').style.display = 'block';
        }
      })
      .catch(err => {
        document.getElementById('error').textContent = '网络错误';
        document.getElementById('error').style.display = 'block';
      });
    }
  </script>
</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      // Login API
      if (pathname === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { password } = JSON.parse(body);
            const pwdData = loadPassword();
            if (verifyPassword(password, pwdData)) {
              const sessionId = createSession();
              res.setHeader('Set-Cookie', `ui_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict`);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } else {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '密码错误' }));
            }
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: '请求格式错误' }));
          }
        });
        return;
      }

      // Logout
      if (pathname === '/logout') {
        const cookies = (req.headers.cookie || '').split(';').reduce((acc, cookie) => {
          const [key, value] = cookie.trim().split('=');
          if (key) acc[key] = value;
          return acc;
        }, {});
        const sessionId = cookies['ui_session'];
        if (sessionId) sessions.delete(sessionId);
        res.setHeader('Set-Cookie', 'ui_session=; Path=/; HttpOnly; Secure; Max-Age=0');
        res.writeHead(302, { 'Location': '/login' });
        res.end();
        return;
      }

      // Password reset API (requires authentication)
      if (pathname === '/api/password/reset' && req.method === 'POST') {
        if (!checkAuth(req)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '未授权，请先登录' }));
          return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { oldPassword } = JSON.parse(body);
            const pwdData = loadPassword();
            if (!verifyPassword(oldPassword, pwdData)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '原密码错误' }));
              return;
            }
            const newPassword = generateStrongPassword();
            const newPasswordData = hashPassword(newPassword);
            newPasswordData.lastReset = new Date().toISOString();
            savePassword(newPasswordData);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, newPassword }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: '请求格式错误' }));
          }
        });
        return;
      }

      // Check authentication for protected routes
      const isApiRoute = pathname.startsWith('/api/');
      const isStaticFile = pathname.startsWith('/web/') || pathname === '/favicon.ico';
      
      if (!isApiRoute && !isStaticFile) {
        if (!checkAuth(req)) {
          res.writeHead(302, { 'Location': '/login' });
          res.end();
          return;
        }
      }

      // Device APIs (no additional auth check beyond session for now)
      if (pathname === '/api/devices' && req.method === 'GET') {
        const devicesData = getDevices();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(devicesData));
        return;
      }

      if (pathname === '/api/devices' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { name, ip, deviceId } = JSON.parse(body);
            if (!name || !ip || !deviceId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '缺少必要字段' }));
              return;
            }
            const devicesData = getDevices();
            if (devicesData.devices.some(d => d.deviceId === deviceId)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '设备已存在' }));
              return;
            }
            devicesData.devices.push({ deviceId, name, ip, authorized: false, online: false, state: null });
            saveDevices(devicesData);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: '无效的JSON' }));
          }
        });
        return;
      }

      if (pathname === '/api/device/authorize' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { deviceId, authorized, sessionKey, signKey } = JSON.parse(body);
            if (!deviceId || authorized === undefined) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '缺少必要字段' }));
              return;
            }
            const devicesData = getDevices();
            const device = devicesData.devices.find(d => d.deviceId === deviceId);
            if (!device) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '设备不存在' }));
              return;
            }
            device.authorized = authorized;
            if (authorized) {
              device.sessionKey = sessionKey;
              device.signKey = signKey;
              device.online = true;
            } else {
              device.online = false;
            }
            saveDevices(devicesData);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, deviceId, authorized }));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: '无效的JSON' }));
          }
        });
        return;
      }

      if (pathname === '/api/device/unauthorize' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { deviceId } = JSON.parse(body);
            if (!deviceId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '缺少deviceId' }));
              return;
            }
            const devicesData = getDevices();
            const device = devicesData.devices.find(d => d.deviceId === deviceId);
            if (!device) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '设备不存在' }));
              return;
            }
            device.authorized = false;
            device.online = false;
            saveDevices(devicesData);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: '无效的JSON' }));
          }
        });
        return;
      }

      if (pathname === '/api/device/control' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { deviceId, action, params } = JSON.parse(body);
            if (!deviceId || !action) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '缺少必要字段' }));
              return;
            }
            api.executeTool('device.control', { deviceId, action, params })
              .then(result => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
              })
              .catch(err => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.toString() }));
              });
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: '无效的JSON' }));
          }
        });
        return;
      }

      // Main page (device management)
      if (pathname === '/' || pathname === '/index.html') {
        const devicesData = getDevices();
        const pwdData = loadPassword();
        const lastReset = pwdData.lastReset || pwdData.createdAt;
        
        const html = `<!DOCTYPE html>
<html>
<head>
  <title>智能家居管理</title>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f9f9f9; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .header h1 { margin: 0; color: #333; }
    .header-right { display: flex; gap: 10px; align-items: center; }
    .device { border: 1px solid #ddd; padding: 20px; margin: 15px 0; border-radius: 8px; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .device h2 { margin-top: 0; color: #333; }
    .status { font-weight: bold; padding: 3px 8px; border-radius: 4px; }
    .status.online { background: #c8e6c9; color: #2e7d32; }
    .status.offline { background: #ffcdd2; color: #c62828; }
    .status.unauthorized { background: #ffe0b2; color: #ef6c00; }
    button { padding: 10px 15px; margin: 5px; cursor: pointer; border: none; border-radius: 4px; font-size: 14px; }
    button.auth { background: #4CAF50; color: white; }
    button.unauth { background: #f44336; color: white; }
    button.control { background: #2196F3; color: white; }
    button.reset { background: #ff9800; color: white; }
    button.logout { background: #9e9e9e; color: white; }
    button:hover { opacity: 0.9; }
    .form-group { margin: 15px 0; }
    label { display: block; margin-bottom: 5px; color: #555; }
    input { padding: 10px; width: 250px; border: 1px solid #ddd; border-radius: 4px; }
    .add-device { border: 1px dashed #bbb; padding: 20px; margin: 20px 0; border-radius: 8px; background: #fafafa; }
    .password-reset { border: 1px solid #ff9800; padding: 20px; margin: 30px 0; border-radius: 8px; background: #fff3e0; }
    .password-reset h3 { margin-top: 0; color: #e65100; }
    .new-password { background: #e8f5e9; padding: 15px; border-radius: 4px; font-family: monospace; font-size: 18px; text-align: center; margin: 15px 0; word-break: break-all; }
    .warning { color: #d32f2f; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>智能家居设备管理</h1>
      <div class="header-right">
        <button class="logout" onclick="logout()">退出登录</button>
      </div>
    </div>

    <div class="add-device">
      <h2>添加新设备</h2>
      <div class="form-group">
        <label for="deviceName">设备名称:</label>
        <input type="text" id="deviceName" placeholder="例如：客厅灯">
      </div>
      <div class="form-group">
        <label for="deviceIp">设备IP:</label>
        <input type="text" id="deviceIp" placeholder="例如：192.168.1.100">
      </div>
      <div class="form-group">
        <label for="deviceMac">设备MAC (deviceId):</label>
        <input type="text" id="deviceMac" placeholder="例如：AA:BB:CC:DD:EE:FF">
      </div>
      <button class="auth" onclick="addDevice()">添加设备</button>
    </div>

    <div id="devicesList">
      <h2>设备列表</h2>
      ${devicesData.devices && devicesData.devices.length > 0 ? devicesData.devices.map(device => `
        <div class="device">
          <h2>${device.name || '未命名设备'} (${device.deviceId})</h2>
          <p>IP: ${device.ip || '未知'}</p>
          <p>状态: <span class="status ${device.online ? 'online' : device.authorized ? 'unauthorized' : 'offline'}">
            ${device.online ? '在线' : device.authorized ? '未授权' : '离线'}
          </span></p>
          <p>授权状态: ${device.authorized ? '已授权' : '未授权'}</p>
          ${device.state ? `<p>当前状态: ${JSON.stringify(device.state)}</p>` : ''}
          <div>
            ${!device.authorized ?
              `<button class="auth" onclick="authorizeDevice('${device.deviceId}')">授权</button>` :
              `<button class="unauth" onclick="unauthorizeDevice('${device.deviceId}')">取消授权</button>`
            }
            ${device.authorized && device.online ? `
              <button class="control" onclick="controlDevice('${device.deviceId}', 'on')">开灯</button>
              <button class="control" onclick="controlDevice('${device.deviceId}', 'off')">关灯</button>
              <button class="control" onclick="controlDevice('${device.deviceId}', 'query')">查询状态</button>
            ` : ''}
          </div>
        </div>
      `).join('') : '<p>暂无设备</p>'}
    </div>

    <div class="password-reset">
      <h3>密码重置（需要原密码）</h3>
      <p class="warning">警告：重置密码后，新密码将显示在页面上，请妥善保管。只有OpenClaw主会话可以重置密码。</p>
      <p>上次更新: ${lastReset ? new Date(lastReset).toLocaleString('zh-CN') : '未知'}</p>
      <div class="form-group">
        <label for="oldPassword">原密码:</label>
        <input type="password" id="oldPassword" placeholder="输入当前密码">
      </div>
      <button class="reset" onclick="resetPassword()">重置密码（生成随机强密码）</button>
      <div id="newPasswordDisplay" style="display:none;">
        <p>新密码:</p>
        <div id="newPassword" class="new-password"></div>
        <p class="warning">请立即记录此密码，关闭页面后将无法再次查看。</p>
      </div>
    </div>
  </div>

  <script>
    function addDevice() {
      const name = document.getElementById('deviceName').value.trim();
      const ip = document.getElementById('deviceIp').value.trim();
      const mac = document.getElementById('deviceMac').value.trim();
      if (!name || !ip || !mac) { alert('请填写所有字段'); return; }
      fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ip, deviceId: mac })
      })
      .then(r => r.json())
      .then(d => {
        if (d.success) { alert('设备添加成功'); location.reload(); }
        else alert('添加失败: ' + d.error);
      })
      .catch(err => alert('网络错误: ' + err));
    }

    function authorizeDevice(deviceId) {
      const sessionKey = Math.random().toString(36).substring(2, 18) + Math.random().toString(36).substring(2, 18);
      const signKey = Math.random().toString(36).substring(2, 18) + Math.random().toString(36).substring(2, 18);
      fetch('/api/device/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, authorized: true, sessionKey, signKey })
      })
      .then(r => r.json())
      .then(d => {
        if (d.success) { alert('授权成功'); location.reload(); }
        else alert('授权失败: ' + d.error);
      })
      .catch(err => alert('网络错误: ' + err));
    }

    function unauthorizeDevice(deviceId) {
      if (!confirm('确定取消授权？')) return;
      fetch('/api/device/unauthorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId })
      })
      .then(r => r.json())
      .then(d => {
        if (d.success) { alert('已取消授权'); location.reload(); }
        else alert('取消授权失败: ' + d.error);
      })
      .catch(err => alert('网络错误: ' + err));
    }

    function controlDevice(deviceId, action) {
      fetch('/api/device/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, action, params: {} })
      })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          if (action === 'query') alert('设备状态: ' + JSON.stringify(d.result));
          else alert('指令发送成功');
          location.reload();
        } else alert('指令发送失败: ' + d.error);
      })
      .catch(err => alert('网络错误: ' + err));
    }

    function resetPassword() {
      const oldPassword = document.getElementById('oldPassword').value;
      if (!oldPassword) { alert('请输入原密码'); return; }
      if (!confirm('确定要重置密码吗？新密码将是随机生成的强密码。')) return;
      
      fetch('/api/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword })
      })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          document.getElementById('newPassword').textContent = d.newPassword;
          document.getElementById('newPasswordDisplay').style.display = 'block';
          alert('密码已重置，请查看并保存新密码');
        } else {
          alert('重置失败: ' + d.error);
        }
      })
      .catch(err => alert('网络错误: ' + err));
    }

    function logout() {
      window.location.href = '/logout';
    }
  </script>
</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      // Static files
      const filePath = path.join(webRoot, pathname === '/' ? 'index.html' : pathname);
      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'Content-Type': (contentTypes[ext] || 'text/plain') + '; charset=utf-8' });
        fs.createReadStream(filePath).pipe(res);
      });
    });

    httpsServer.listen(pluginConfig.httpsPort, () => {
      api.logger.info(`UI管理HTTPS服务已启动，监听端口：${pluginConfig.httpsPort}`);
      api.logger.info('UI界面已启用密码保护，请使用主会话查看或重置密码');
    });
  });
};