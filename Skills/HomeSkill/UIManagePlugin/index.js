// UIManagePlugin/index.js
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const https = require('https');
const http = require('http');
const { generateKeyPairSync, constants } = require('crypto');

module.exports.register = async (api) => {
  const pluginConfig = require('./config.json');
  const webRoot = path.join(__dirname, pluginConfig.webRoot);
  const devicesPath = path.join(__dirname, '../../devices.json');

  // Function to get or generate SSL credentials
  function getSSLOptions() {
    const { key, cert } = pluginConfig.ssl || {};
    if (!key || !cert) {
      return null;
    }
    const keyPath = path.join(__dirname, key);
    const certPath = path.join(__dirname, cert);
    // Check if files exist
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      try {
        return {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath)
        };
      } catch (e) {
        api.logger.error(`Failed to read SSL files: ${e.message}`);
        return null;
      }
    } else {
      // Files don't exist, generate a self-signed certificate for development
      api.logger.info('SSL files not found, generating self-signed certificate for development...');
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      // In a real implementation, we would create a certificate, but for simplicity we'll just use the key pair.
      // However, https.createServer expects a certificate, not just a public key.
      // We'll create a simple self-signed certificate using the generated key pair.
      // For brevity, we'll use a minimal certificate generation (not production ready).
      // Since generating a proper certificate is complex, we'll fallback to HTTP if we cannot generate a cert.
      // In a real setup, the user should provide proper certs.
      api.logger.warn('Self-signed certificate generation not fully implemented; falling back to HTTP.');
      return null;
    }
  }

  // 启动Web服务 (HTTP or HTTPS based on SSL config)
  api.startService('web-server', async () => {
    const sslOptions = getSSLOptions();
    let server;

    if (sslOptions) {
      server = https.createServer(sslOptions, (req, res) => {
        handleRequest(req, res);
      });
      server.listen(pluginConfig.httpsPort, () => {
        api.logger.info(`UI管理HTTPS服务已启动，监听端口：${pluginConfig.httpsPort}`);
      });
    } else {
      server = http.createServer((req, res) => {
        handleRequest(req, res);
      });
      server.listen(pluginConfig.httpPort, () => {
        api.logger.info(`UI管理HTTP服务已启动，监听端口：${pluginConfig.httpPort}`);
      });
    }

    // Request handler function
    function handleRequest(req, res) {
      const url = require('url');
      const querystring = require('querystring');

      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;

      // 设置CORS头（如果需要）
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Request-Method', '*');
      res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
      res.setHeader('Access-Control-Allow-Headers', '*');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // 读取设备列表
      const getDevices = () => {
        try {
          const data = fs.readFileSync(devicesPath, 'utf8');
          return JSON.parse(data);
        } catch (e) {
          return { devices: [] };
        }
      };

      // 写入设备列表
      const saveDevices = (data) => {
        fs.writeFileSync(devicesPath, JSON.stringify(data, null, 2));
      };

      // 主页：显示设备列表
      if (pathname === '/' || pathname === '/index.html') {
        const devicesData = getDevices();
        let html = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>智能家居管理</title>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; margin: 40px; }
              .device { border: 1px solid #ccc; padding: 20px; margin: 20px 0; border-radius: 5px; }
              .device h2 { margin-top: 0; }
              .status { font-weight: bold; }
              .status.online { color: green; }
              .status.offline { color: red; }
              .status.unauthorized { color: orange; }
              button { padding: 10px 15px; margin: 5px; cursor: pointer; }
              button.auth { background-color: #4CAF50; color: white; border: none; }
              button.unauth { background-color: #f44336; color: white; border: none; }
              button.control { background-color: #2196F3; color: white; border: none; }
              .form-group { margin: 15px 0; }
              label { display: block; margin-bottom: 5px; }
              input { padding: 8px; width: 250px; }
              .add-device { border: 1px dashed #ccc; padding: 20px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <h1>智能家居设备管理</h1>
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
              <button onclick="addDevice()">添加设备</button>
            </div>
            <div id="devicesList">
              <h2>设备列表</h2>
              ${devicesData.devices && devicesData.devices.length > 0 ? devicesData.devices.map(device => `
                <div class="device">
                  <h2>${device.name || '未命名设备'} (${device.deviceId})</h2>
                  <p>IP: ${device.ip || '未知'}</p>
                  <p>状态: 
                    <span class="status ${device.online ? 'online' : device.authorized ? 'unauthorized' : 'offline'}">
                      ${device.online ? '在线' : device.authorized ? '未授权' : '离线'}
                    </span>
                  </p>
                  <p>授权状态: ${device.authorized ? '已授权' : '未授权'}</p>
                  ${device.state ? `<p>当前状态: ${JSON.stringify(device.state)}</p>` : ''}
                  <div>
                    ${!device.authorized ? `
                      <button class="auth" onclick="authorizeDevice('${device.deviceId}')">授权</button>
                    ` : `
                      <button class="unauth" onclick="unauthorizeDevice('${device.deviceId}')">取消授权</button>
                    `}
                    ${device.authorized && device.online ? `
                      <button class="control" onclick="controlDevice('${device.deviceId}', 'on')">开灯</button>
                      <button class="control" onclick="controlDevice('${device.deviceId}', 'off')">关灯</button>
                      <button class="control" onclick="controlDevice('${device.deviceId}', 'query')">查询状态</button>
                    ` : ''}
                  </div>
                </div>
              `).join('') : '<p>暂无设备</p>'}
            </div>

            <script>
              function addDevice() {
                const name = document.getElementById('deviceName').value.trim();
                const ip = document.getElementById('deviceIp').value.trim();
                const mac = document.getElementById('deviceMac').value.trim();
                if (!name || !ip || !mac) {
                  alert('请填写所有字段');
                  return;
                }
                fetch('/api/devices', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name, ip, deviceId: mac })
                })
                .then(response => response.json())
                .then(result => {
                  if (result.success) {
                    alert('设备添加成功，请授权后使用');
                    location.reload();
                    // 清空输入框
                    document.getElementById('deviceName').value = '';
                    document.getElementById('deviceIp').value = '';
                    document.getElementById('deviceMac').value = '';
                  } else {
                    alert('添加失败: ' + result.error);
                  }
                })
                .catch(err => {
                  alert('网络错误: ' + err);
                });
              }

              function authorizeDevice(deviceId) {
                // 生成随机密钥（在实际系统中，应由设备和服务器协商生成）
                const sessionKey = Math.random().toString(36).substring(2, 18) + Math.random().toString(36).substring(2, 18);
                const signKey = Math.random().toString(36).substring(2, 18) + Math.random().toString(36).substring(2, 18);
                fetch('/api/device/authorize', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ deviceId, authorized: true, sessionKey, signKey })
                })
                .then(response => response.json())
                .then(result => {
                  if (result.success) {
                    alert('设备授权成功');
                    location.reload();
                  } else {
                    alert('授权失败: ' + result.error);
                  }
                })
                .catch(err => {
                  alert('网络错误: ' + err);
                });
              }

              function unauthorizeDevice(deviceId) {
                fetch('/api/device/unauthorize', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ deviceId })
                })
                .then(response => response.json())
                .then(result => {
                  if (result.success) {
                    alert('设备已取消授权');
                    location.reload();
                  } else {
                    alert('取消授权失败: ' + result.error);
                  }
                })
                .catch(err => {
                  alert('网络错误: ' + err);
                });
              }

              function controlDevice(deviceId, action) {
                let params = {};
                if (action === 'on' || action === 'off') {
                  // 可以添加参数，如延时等
                }
                fetch(`/api/device/control`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ deviceId, action, params })
                })
                .then(response => response.json())
                .then(result => {
                  if (result.success) {
                    alert('指令发送成功');
                    // 如果是查询，可以显示结果
                    if (action === 'query') {
                      alert('设备状态: ' + JSON.stringify(result.result));
                    }
                    location.reload();
                  } else {
                    alert('指令发送失败: ' + result.error);
                  }
                })
                .catch(err => {
                  alert('网络错误: ' + err);
                });
              }
            </script>
          </body>
          </html>
        `;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      // API：获取设备列表
      if (pathname === '/api/devices' && req.method === 'GET') {
        const devicesData = getDevices();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(devicesData));
        return;
      }

      // API：添加设备
      if (pathname === '/api/devices' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const { name, ip, deviceId } = data;
            if (!name || !ip || !deviceId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '缺少必要字段' }));
              return;
            }
            const devicesData = getDevices();
            // 检查是否已存在
            const exists = devicesData.devices.some(d => d.deviceId === deviceId);
            if (exists) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '设备已存在' }));
              return;
            }
            devicesData.devices.push({
              deviceId,
              name,
              ip,
              authorized: false,
              online: false,
              state: null
            });
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

      // API：设备授权
      if (pathname === '/api/device/authorize' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const { deviceId, authorized, sessionKey, signKey } = data;
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
              device.online = true; // 假设授权后设备上线
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

      // API：设备取消授权
      if (pathname === '/api/device/unauthorize' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const { deviceId } = data;
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

      // API：设备控制
      if (pathname === '/api/device/control' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const { deviceId, action, params } = data;
            if (!deviceId || !action) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '缺少必要字段' }));
              return;
            }
            // 调用device.control工具
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

      // 静态文件服务
      const filePath = path.join(webRoot, pathname === '/' ? 'index.html' : pathname);
      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        let contentType = 'text/plain';
        switch (ext) {
          case '.html': contentType = 'text/html'; break;
          case '.css': contentType = 'text/css'; break;
          case '.js': contentType = 'application/javascript'; break;
          case '.json': contentType = 'application/json'; break;
          case '.png': contentType = 'image/png'; break;
          case '.jpg':
          case '.jpeg': contentType = 'image/jpeg'; break;
          case '.svg': contentType = 'image/svg+xml'; break;
          default: contentType = 'text/plain';
        }

        res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
        const readStream = fs.createReadStream(filePath);
        readStream.pipe(res);
      });
    }
  });
};
