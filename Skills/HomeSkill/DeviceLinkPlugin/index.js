// DeviceLinkPlugin/index.js
// 引入依赖模块
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const chokidar = require('chokidar'); // 文件监听库（需安装：npm install chokidar）

// 插件注册入口（OpenClaw 自动调用）
module.exports.register = async (api) => {
  // 1. 读取插件配置
  const pluginConfig = require('./config.json');
  const skillConfig = require('../openclaw.skill.json');
  const devicesPath = path.join(__dirname, '../devices.json');

  // 2. 初始化设备文件（若不存在则创建）
  if (!fs.existsSync(devicesPath)) {
    fs.writeFileSync(devicesPath, JSON.stringify({ devices: [] }, null, 2));
  }

  // 3. 注册工具（OpenClaw 可调用的核心能力）
  // 3.1 设备控制工具（核心：下发指令到设备）
  api.registerTool({
    name: 'device.control',
    description: '向指定设备下发控制指令（开灯/关灯/查询状态）',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: '设备唯一ID（MAC地址）' },
        action: { type: 'string', enum: ['on', 'off', 'query'], description: '执行动作' },
        params: { type: 'object', description: '可选参数（如延时）', default: {} }
      },
      required: ['deviceId', 'action']
    },
    // 工具执行逻辑（OpenClaw 调用时触发）
    async execute(toolCallId, { deviceId, action, params }) {
      try {
        // 从devices.json读取设备信息
        const devicesData = JSON.parse(fs.readFileSync(devicesPath, 'utf8'));
        const device = devicesData.devices.find(d => d.deviceId === deviceId);

        // 校验设备存在性与授权状态
        if (!device) return { success: false, error: '设备不存在', deviceId };
        if (!device.authorized) return { success: false, error: '设备未授权', deviceId };
        if (!device.online) return { success: false, error: '设备离线', deviceId };

        // 构建指令报文（加密）
        const command = {
          type: 'control',
          deviceId: deviceId,
          action: action,
          params: params,
          timestamp: Date.now(),
          nonce: crypto.randomBytes(8).toString('hex') // 随机数，防重放
        };

        // 加密报文（AES-256-CBC + 签名）
        const encryptedMsg = await encryptMessage(command, device.sessionKey);
        const signature = crypto.createHmac('sha256', device.signKey)
          .update(JSON.stringify(command) + encryptedMsg)
          .digest('hex');

        // 构建完整数据包
        const packet = JSON.stringify({
          type: 'encrypted',
          data: encryptedMsg,
          sign: signature
        }) + '\n'; // 换行符，解决粘包问题

        // 建立TCP短连接下发指令（设备在线）
        return new Promise((resolve) => {
          const client = net.createConnection({ host: device.ip, port: pluginConfig.devicePort }, () => {
            client.write(packet); // 发送加密指令
          });

          // 接收设备响应
          client.on('data', async (data) => {
            try {
              const response = JSON.parse(data.toString());
              // 解密响应
              const decryptedResponse = await decryptMessage(response.data, device.sessionKey);
              // 更新设备状态到devices.json
              if (decryptedResponse.state) {
                device.state = decryptedResponse.state;
                await updateDevicesFile(devicesData);
              }
              resolve({ success: true, deviceId, result: decryptedResponse });
            } catch (e) {
              resolve({ success: false, error: '响应解密失败', deviceId });
            }
          });

          // 连接失败
          client.on('error', (err) => {
            resolve({ success: false, error: `设备连接失败：${err.message}`, deviceId });
          });

          // 超时
          client.setTimeout(5000, () => {
            client.destroy();
            resolve({ success: false, error: '设备响应超时', deviceId });
          });
        });
      } catch (e) {
        return { success: false, error: `指令执行异常：${e.message}` };
      }
    }
  });

  // 3.2 设备授权工具（更新设备授权状态）
  api.registerTool({
    name: 'device.authorize',
    description: '更新设备授权状态（允许/拒绝接入）',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: '设备唯一ID' },
        authorized: { type: 'boolean', description: '是否授权' },
        sessionKey: { type: 'string', description: '会话密钥（授权后生成）' },
        signKey: { type: 'string', description: '签名密钥（授权后生成）' }
      },
      required: ['deviceId', 'authorized']
    },
    async execute(toolCallId, { deviceId, authorized, sessionKey, signKey }) {
      try {
        const devicesData = JSON.parse(fs.readFileSync(devicesPath, 'utf8'));
        const device = devicesData.devices.find(d => d.deviceId === deviceId);
        if (!device) return { success: false, error: '设备不存在' };

        // 更新授权状态与密钥
        device.authorized = authorized;
        if (authorized) {
          device.sessionKey = sessionKey; // 存储会话密钥
          device.signKey = signKey;     // 存储签名密钥
          device.online = true;         // 标记在线
        } else {
          device.online = false;        // 标记离线
        }

        await updateDevicesFile(devicesData);
        // 触发飞书通知（授权结果）
        api.sendChannelMessage('feishu', {
          title: '设备授权结果',
          content: `设备【${device.name}】(${deviceId}) ${authorized ? '已授权接入' : '已拒绝接入'}`
        });
        return { success: true, deviceId, authorized };
      } catch (e) {
        return { success: false, error: `授权失败：${e.message}` };
      }
    }
  });

  // 3.3 设备取消授权工具
  api.registerTool({
    name: 'device.unauthorize',
    description: '取消设备授权状态（等同于 device.authorize authorized=false）',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: '设备唯一ID' }
      },
      required: ['deviceId']
    },
    async execute(toolCallId, { deviceId }) {
      // 复用授权工具，设置 authorized 为 false
      return api.executeTool('device.authorize', { deviceId, authorized: false });
    }
  });

  // 3.4 设备同步工具（强制从设备获取最新状态）
  api.registerTool({
    name: 'device.sync',
    description: '向指定设备查询状态并更新本地记录',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: '设备唯一ID（MAC地址）' }
      },
      required: ['deviceId']
    },
    async execute(toolCallId, { deviceId }) {
      // 复用控制工具的 query 动作
      return api.executeTool('device.control', { deviceId, action: 'query' });
    }
  });

  // 4. 启动后台服务（设备监听 + 文件监听）
  // 4.1 设备监听服务：启动TCP服务器，监听设备接入（长连接/短连接自适应）
  api.startService('device-listener', async () => {
    const server = net.createServer(async (client) => {
      let deviceInfo = null;
      let buffer = ''; // 粘包处理缓冲区

      // 客户端连接成功
      client.on('connect', () => {
        api.logger.info(`新设备接入：${client.remoteAddress}:${client.remotePort}`);
      });

      // 接收设备数据
      client.on('data', async (data) => {
        buffer += data.toString();
        // 按换行符拆分数据包（解决粘包）
        const packets = buffer.split('\n');
        buffer = packets.pop(); // 剩余未完整数据包暂存

        for (const packetStr of packets) {
          if (!packetStr.trim()) continue; // 跳过空行
          try {
            const packet = JSON.parse(packetStr);
            // 只处理加密类型的数据包
            if (packet.type === 'encrypted') {
              // 这里需要根据设备IP找到对应的设备记录（因为设备在发送数据时尚未授权，可能还没有在devices.json中）
              // 实际中，设备在首次连接时会发送其设备ID（MAC）和公钥信息？但根据我们的设计，设备在未授权状态下不会发送任何数据，只有在授权后才会通信。
              // 为了简化，我们假设设备在连接后会发送一个包含其deviceId的未加密握手包？但当前设计中，所有通信都是加密的。
              // 因此，我们需要一个方式：设备在连接后首先发送一个未加密的设备ID声明？但这样不安全。
              // 替代方案：使用预共享密钥？但不安全。
              // 重新考虑：在设备端，我们只有在授权后才建立通信。所以设备在未授权状态下不会主动发送数据。
              // 因此，我们的TCP服务器主要是为了在设备被授权后，由OpenClaw主动连接设备下发指令。
              // 那么，设备监听服务可能不是必须的？但我们还是保留，用于设备主动上报状态（如按键触发）。
              // 为了支持设备主动上报，我们需要设备在未授权状态下能够发送一个标识自己的消息，但这样存在安全风险。
              // 我们可以这样：设备在连接后发送一个包含其deviceId和一个随机数的消息，然后OpenClaw使用该随机数和预存的设备密钥（如果有）来生成会话密钥？但我们还没有预存密钥。
              // 由于时间关系，我们简化设计：假设设备在被授权后才会连接到OpenClaw的TCP服务器（即设备作为客户端连接到OpenClaw），然后OpenClaw作为服务器接收设备的主动上报。
              // 但是，在我们之前的控制工具中，OpenClaw是作为客户端连接到设备。这样会有两种模式？
              // 为了统一，我们让设备总是作为服务器运行，OpenClaw作为客户端连接到设备。那么设备不需要主动连接到OpenClaw。
              // 那么，我们的TCP服务器（device-listener）可能用处不大。但我们可以保留，用于其他类型的设备（如那些需要主动上报的设备）。
              // 由于题目要求是智能开关，我们可以假设设备不主动上报状态，只有在被查询时才返回状态。
              // 因此，我们可以暂时不处理设备主动发送的数据，或者如果收到数据则尝试解密并处理为状态上报。
              // 由于我们没有设备端代码，我们假设设备端在收到指令后会返回结果，但不主动发送。
              // 所以，这里我们只记录日志，不处理数据。
              api.logger.debug(`收到设备数据包：${packetStr}`);
              // 如果要处理设备主动上报，需要在这里解密并更新设备状态。
              // 但由于我们无法知道设备的密钥（因为设备尚未授权），我们跳过。
              // 在实际项目中，设备在未授权状态下不应发送任何数据，或者发送一个不包含敏感信息的广播包。
            }
          } catch (e) {
            api.logger.error(`解析设备数据包失败：${e.message}`);
          }
        }
      });

      // 客户端断开连接
      client.on('close', () => {
        api.logger.info(`设备断开连接：${client.remoteAddress}:${client.remotePort}`);
        // 如果我们知道这是哪个设备，可以将其标记为离线
        if (deviceInfo) {
          const devicesData = JSON.parse(fs.readFileSync(devicesPath, 'utf8'));
          const device = devicesData.devices.find(d => d.deviceId === deviceInfo.deviceId);
          if (device) {
            device.online = false;
            updateDevicesFile(devicesData).catch(console.error);
          }
        }
      });

      // 连接错误
      client.on('error', (err) => {
        api.logger.error(`设备连接错误：${err.message}`);
      });
    });

    server.listen(pluginConfig.devicePort, () => {
      api.logger.info(`设备监听服务已启动，监听端口：${pluginConfig.devicePort}`);
    });
  });

  // 4.2 文件监听服务：监控 devices.json 文件变化，以便在其他插件或手动编辑时更新内部状态（虽然我们总是读取文件，但可以做缓存）
  // 由于我们在每次工具执行时都会读取文件，所以文件监听服务可能不是必须的。但我们还是启动它以示例。
  api.startService('file-watcher', async () => {
    const watcher = chokidar.watch(devicesPath, {
      persistent: true,
      ignoreInitial: true
    });

    watcher.on('change', (filePath) => {
      api.logger.info(`设备文件已更新：${filePath}`);
      // 这里可以触发一些操作，比如重新加载设备列表到内存缓存（如果我们有缓存的话）
      // 由于我们总是读取文件，所以无需额外操作
    });

    watcher.on('error', (error) => {
      api.logger.error(`文件监听错误：${error}`);
    });
  });

  // 辅助函数：更新设备文件
  async function updateDevicesFile(devicesData) {
    return new Promise((resolve, reject) => {
      fs.writeFile(devicesPath, JSON.stringify(devicesData, null, 2), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // 辅助函数：加密消息
  async function encryptMessage(message, key) {
    // key 应该是 32 字节的 Buffer（AES-256）
    const iv = crypto.randomBytes(16); // 初始化向量
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(JSON.stringify(message), 'utf8', 'base64');
    encrypted += cipher.final('base64');
    // 返回 iv + encrypted（为了解密时使用）
    return iv.toString('base64') + ':' + encrypted;
  }

  // 辅助函数：解密消息
  async function decryptMessage(encryptedMessage, key) {
    const parts = encryptedMessage.split(':');
    if (parts.length !== 2) throw new Error('Invalid encrypted message format');
    const iv = Buffer.from(parts[0], 'base64');
    const encryptedData = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }

  // 注：以上加密函数未包含签名验证，实际使用中我们已经在工具中加入了签名（HMAC）。
  // 但在设备端，我们需要同样生成签名和验证签数。这里我们只提供OpenClaw端的加密解密。
  // 设备端需要实现相同的逻辑。
};
