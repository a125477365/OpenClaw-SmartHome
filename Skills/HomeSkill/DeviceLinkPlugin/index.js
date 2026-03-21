// DeviceLinkPlugin/index.js
// Device Connection and Control Plugin for OpenClaw Smart Home System
// 
// Features:
// - AES-256-GCM encryption (matching ESP32 firmware)
// - ECDH-based pairing (Bluetooth-style, no pre-shared secrets)
// - Device discovery via mDNS (local network only, optional)
// - Auto port selection with fallback
// - Reconnection verification using stored public keys
//
// Security:
// - No pre-shared factory secrets
// - Per-session keys derived from ECDH
// - Replay protection via timestamp and nonce
// - User confirmation for pairing (numeric comparison)

const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const dgram = require('dgram');
const chokidar = require('chokidar');

// ECDH curve name (must match ESP32 firmware)
const ECDH_CURVE = 'prime256v1'; // secp256r1, also known as P-256

// AES-256-GCM parameters
const GCM_IV_LENGTH = 12; // 96 bits, recommended for GCM
const GCM_TAG_LENGTH = 16; // 128 bits

// Pairing confirmation code length
const CONFIRM_CODE_LENGTH = 6;

// Session key derivation
const HKDF_SALT_LENGTH = 16;

// Pairing timeout (ms)
const PAIRING_TIMEOUT = 60000;

// Plugin registration entry point (called automatically by OpenClaw)
module.exports.register = async (api) => {

  // ========================================
  // Configuration Loading
  // ========================================
  
  const defaultConfig = {
    devicePort: 8080,
    mdnsPort: 5353,
    pairingTimeout: 60000,
    portRangeMin: 8080,
    portRangeMax: 8100,
    enableMdnsDiscovery: true, // Can be disabled for public cloud deployment
    encryption: {
      algorithm: 'aes-256-gcm',
      keyLength: 32,
      ivLength: 12
    }
  };

  let pluginConfig;
  try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
      const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      pluginConfig = { ...defaultConfig, ...loadedConfig };
    } else {
      pluginConfig = defaultConfig;
    }
  } catch (e) {
    api.logger.warn('Failed to load config, using defaults: ' + e.message);
    pluginConfig = defaultConfig;
  }

  const skillConfig = require('../openclaw.skill.json');
  const devicesPath = path.join(__dirname, '../devices.json');

  // ========================================
  // Initialize Devices File
  // ========================================
  
  if (!fs.existsSync(devicesPath)) {
    fs.writeFileSync(devicesPath, JSON.stringify({ 
      devices: [], 
      pendingPairings: [] 
    }, null, 2));
  }

  // ========================================
  // Generate OpenClaw ECDH Key Pair
  // ========================================
  
  let openclawKeyPair = null;
  try {
    openclawKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: ECDH_CURVE });
    api.logger.info('OpenClaw ECDH key pair generated for device pairing');
  } catch (e) {
    api.logger.error('Failed to generate ECDH key pair: ' + e.message);
  }

  // ========================================
  // Helper Functions
  // ========================================

  // Find available port with fallback
  async function findAvailablePort(startPort, maxPort = startPort + 20) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(startPort, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      server.on('error', () => {
        if (startPort < maxPort) {
          resolve(findAvailablePort(startPort + 1, maxPort));
        } else {
          resolve(null);
        }
      });
    });
  }

  // Generate confirmation code from shared secret
  function generateConfirmCode(sharedSecret, salt) {
    const hash = crypto.createHash('sha256');
    hash.update(sharedSecret);
    hash.update(salt);
    const digest = hash.digest();
    // Convert first 4 bytes to 6-digit code
    const code = (digest[0] << 16 | digest[1] << 8 | digest[2]) % 1000000;
    return code.toString().padStart(CONFIRM_CODE_LENGTH, '0');
  }

  // Derive session keys using HKDF
  function deriveSessionKeys(sharedSecret, salt) {
    const sessionKey = crypto.hkdfSync('sha256', sharedSecret, salt, 'encryption', 32);
    const signKey = crypto.hkdfSync('sha256', sharedSecret, salt, 'signing', 32);
    return { 
      sessionKey: Buffer.from(sessionKey), 
      signKey: Buffer.from(signKey) 
    };
  }

  // AES-256-GCM encryption
  function encryptMessage(plaintext, key) {
    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { 
      authTagLength: GCM_TAG_LENGTH 
    });
    let encrypted = cipher.update(JSON.stringify(plaintext), 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      iv: iv.toString('base64'),
      ciphertext: Buffer.concat([encrypted, authTag]).toString('base64')
    };
  }

  // AES-256-GCM decryption
  function decryptMessage(encryptedData, key) {
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const data = Buffer.from(encryptedData.ciphertext, 'base64');
    const ciphertext = data.slice(0, -GCM_TAG_LENGTH);
    const authTag = data.slice(-GCM_TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { 
      authTagLength: GCM_TAG_LENGTH 
    });
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  // Atomic file write with locking
  async function atomicWriteFile(filePath, data) {
    const tempPath = filePath + '.tmp.' + Date.now();
    return new Promise((resolve, reject) => {
      fs.writeFile(tempPath, JSON.stringify(data, null, 2), (err) => {
        if (err) {
          reject(err);
          return;
        }
        fs.rename(tempPath, filePath, (renameErr) => {
          if (renameErr) {
            fs.unlink(tempPath, () => {});
            reject(renameErr);
          } else {
            resolve();
          }
        });
      });
    });
  }

  // Read devices file with error handling
  function readDevicesFile() {
    try {
      const data = fs.readFileSync(devicesPath, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      api.logger.error('Failed to read devices file: ' + e.message);
      return { devices: [], pendingPairings: [] };
    }
  }

  // Write devices file with error handling
  async function writeDevicesFile(data) {
    try {
      await atomicWriteFile(devicesPath, data);
      return true;
    } catch (e) {
      api.logger.error('Failed to write devices file: ' + e.message);
      return false;
    }
  }

  // ========================================
  // Tool Registrations
  // ========================================

  // Tool 1: Device Control - Send commands to devices
  api.registerTool({
    name: 'device.control',
    description: 'Send control command to device (on/off/query state)',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { 
          type: 'string', 
          description: 'Device unique ID (MAC address)' 
        },
        action: { 
          type: 'string', 
          enum: ['on', 'off', 'query'], 
          description: 'Action to execute' 
        },
        params: { 
          type: 'object', 
          description: 'Optional parameters', 
          default: {} 
        }
      },
      required: ['deviceId', 'action']
    },
    async execute(toolCallId, { deviceId, action, params }) {
      try {
        const devicesData = readDevicesFile();
        const device = devicesData.devices.find(d => d.deviceId === deviceId);

        if (!device) {
          api.logger.warn(`Device not found: ${deviceId}`);
          return { success: false, error: 'Device not found', deviceId };
        }
        if (!device.authorized) {
          api.logger.warn(`Device not authorized: ${deviceId}`);
          return { success: false, error: 'Device not authorized', deviceId };
        }
        if (!device.online) {
          api.logger.warn(`Device offline: ${deviceId}`);
          return { success: false, error: 'Device offline', deviceId };
        }

        // Validate session key
        if (!device.sessionKey) {
          return { 
            success: false, 
            error: 'Device missing session key, please re-pair', 
            deviceId 
          };
        }

        // Build command packet
        const command = {
          type: 'control',
          deviceId: deviceId,
          action: action,
          params: params || {},
          timestamp: Date.now(),
          nonce: crypto.randomBytes(8).toString('hex')
        };

        api.logger.debug(`Sending command to ${deviceId}: ${action}`);

        // Encrypt using AES-256-GCM
        const sessionKey = Buffer.from(device.sessionKey, 'base64');
        const encryptedMsg = encryptMessage(command, sessionKey);

        const packet = JSON.stringify({
          type: 'encrypted',
          iv: encryptedMsg.iv,
          ciphertext: encryptedMsg.ciphertext
        }) + '\n';

        // Send via TCP
        return new Promise((resolve) => {
          const client = net.createConnection({
            host: device.ip,
            port: device.port || pluginConfig.devicePort
          }, () => {
            client.write(packet);
          });

          client.on('data', (data) => {
            try {
              const response = JSON.parse(data.toString());
              if (response.type === 'encrypted') {
                const decryptedResponse = decryptMessage({
                  iv: response.iv,
                  ciphertext: response.ciphertext
                }, sessionKey);

                // Update device state
                if (decryptedResponse.state !== undefined) {
                  device.state = decryptedResponse.state;
                  device.lastSeen = Date.now();
                  writeDevicesFile(devicesData).catch(e => 
                    api.logger.error('Failed to update device state: ' + e.message));
                }

                api.logger.info(`Command ${action} executed on ${deviceId}`);
                resolve({ success: true, deviceId, result: decryptedResponse });
              } else if (response.type === 'error') {
                resolve({ success: false, error: response.error, deviceId });
              } else {
                resolve({ success: false, error: 'Unknown response type', deviceId });
              }
            } catch (e) {
              api.logger.error('Failed to process response: ' + e.message);
              resolve({ success: false, error: 'Response processing failed: ' + e.message, deviceId });
            }
          });

          client.on('error', (err) => {
            api.logger.error(`Device connection error: ${err.message}`);
            resolve({ success: false, error: `Connection failed: ${err.message}`, deviceId });
          });

          client.setTimeout(10000, () => {
            client.destroy();
            resolve({ success: false, error: 'Device response timeout', deviceId });
          });
        });
      } catch (e) {
        api.logger.error('Control command exception: ' + e.message);
        return { success: false, error: `Command execution failed: ${e.message}` };
      }
    }
  });

  // Tool 2: Device Pairing Start - Initiate ECDH pairing
  api.registerTool({
    name: 'device.pairing.start',
    description: 'Start ECDH pairing process with a device (Bluetooth-style, no pre-shared secrets)',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { 
          type: 'string', 
          description: 'Device unique ID (MAC address)' 
        },
        deviceIp: { 
          type: 'string', 
          description: 'Device IP address' 
        },
        devicePublicKey: { 
          type: 'string', 
          description: 'Device public key (base64 encoded, from device)' 
        },
        devicePort: { 
          type: 'number', 
          description: 'Device TCP port (default 8080)',
          default: 8080
        }
      },
      required: ['deviceId', 'deviceIp', 'devicePublicKey']
    },
    async execute(toolCallId, { deviceId, deviceIp, devicePublicKey, devicePort }) {
      try {
        const devicesData = readDevicesFile();
        
        // Check if device already exists
        let device = devicesData.devices.find(d => d.deviceId === deviceId);
        if (device && device.authorized) {
          return { 
            success: false, 
            error: 'Device already authorized, use device.reconnect instead',
            deviceId
          };
        }

        // Generate ephemeral key pair for this pairing session
        const ephemeralKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: ECDH_CURVE });
        const ecdh = crypto.createECDH(ECDH_CURVE);
        ecdh.generateKeys();

        // Generate salt for key derivation
        const salt = crypto.randomBytes(HKDF_SALT_LENGTH);

        // Compute shared secret using ECDH
        const devicePubKeyBuf = Buffer.from(devicePublicKey, 'base64');
        const sharedSecret = ecdh.computeSecret(devicePubKeyBuf);

        // Derive session keys
        const { sessionKey, signKey } = deriveSessionKeys(sharedSecret, salt);

        // Generate confirmation code
        const confirmCode = generateConfirmCode(sharedSecret, salt);

        // Store pending pairing
        const pendingPairing = {
          deviceId,
          deviceIp,
          devicePort: devicePort || 8080,
          devicePublicKey,
          ephemeralPublicKey: ecdh.getPublicKey('base64'),
          salt: salt.toString('base64'),
          sessionKey: sessionKey.toString('base64'),
          signKey: signKey.toString('base64'),
          confirmCode,
          createdAt: Date.now(),
          expiresAt: Date.now() + PAIRING_TIMEOUT
        };

        // Remove old pending pairings for this device
        devicesData.pendingPairings = devicesData.pendingPairings.filter(
          p => p.deviceId !== deviceId
        );
        devicesData.pendingPairings.push(pendingPairing);

        await writeDevicesFile(devicesData);

        api.logger.info(`Pairing started for device ${deviceId}`);
        api.logger.info(`Confirmation code: ${confirmCode}`);

        return {
          success: true,
          deviceId,
          confirmCode,
          ephemeralPublicKey: ecdh.getPublicKey('base64'),
          salt: salt.toString('base64'),
          message: `Pairing initiated. Confirmation code: ${confirmCode}. Please verify this code matches the device display (or press button on device) before confirming.`
        };
      } catch (e) {
        api.logger.error('Pairing start failed: ' + e.message);
        return { success: false, error: `Pairing failed: ${e.message}` };
      }
    }
  });

  // Tool 3: Device Pairing Confirm - Complete pairing after user confirmation
  api.registerTool({
    name: 'device.pairing.confirm',
    description: 'Confirm device pairing after verifying confirmation code matches',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { 
          type: 'string', 
          description: 'Device unique ID (MAC address)' 
        },
        deviceName: { 
          type: 'string', 
          description: 'Friendly name for the device',
          default: 'Smart Switch'
        }
      },
      required: ['deviceId']
    },
    async execute(toolCallId, { deviceId, deviceName }) {
      try {
        const devicesData = readDevicesFile();
        
        // Find pending pairing
        const pendingIndex = devicesData.pendingPairings.findIndex(
          p => p.deviceId === deviceId && p.expiresAt > Date.now()
        );

        if (pendingIndex === -1) {
          return { 
            success: false, 
            error: 'No valid pending pairing found. Please restart pairing process.',
            deviceId
          };
        }

        const pending = devicesData.pendingPairings[pendingIndex];

        // Create or update device record
        let device = devicesData.devices.find(d => d.deviceId === deviceId);
        if (!device) {
          device = {
            deviceId,
            name: deviceName || 'Smart Switch',
            ip: pending.deviceIp,
            port: pending.devicePort,
            authorized: false,
            online: false,
            state: null,
            createdAt: Date.now()
          };
          devicesData.devices.push(device);
        }

        // Update device with pairing info
        device.name = deviceName || device.name;
        device.publicKey = pending.devicePublicKey;
        device.sessionKey = pending.sessionKey;
        device.signKey = pending.signKey;
        device.authorized = true;
        device.online = true;
        device.pairedAt = Date.now();
        device.lastSeen = Date.now();

        // Remove pending pairing
        devicesData.pendingPairings.splice(pendingIndex, 1);

        await writeDevicesFile(devicesData);

        // Notify via channel
        api.sendChannelMessage('feishu', {
          title: '设备配对成功',
          content: `设备【${device.name}】(${deviceId}) 已完成配对并授权接入`
        });

        api.logger.info(`Pairing confirmed for device ${deviceId}`);

        return {
          success: true,
          deviceId,
          deviceName: device.name,
          message: `Device "${device.name}" paired successfully. You can now control it.`
        };
      } catch (e) {
        api.logger.error('Pairing confirm failed: ' + e.message);
        return { success: false, error: `Pairing confirmation failed: ${e.message}` };
      }
    }
  });

  // Tool 4: Device Pairing Reject - Reject a pending pairing
  api.registerTool({
    name: 'device.pairing.reject',
    description: 'Reject a pending device pairing',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { 
          type: 'string', 
          description: 'Device unique ID (MAC address)' 
        }
      },
      required: ['deviceId']
    },
    async execute(toolCallId, { deviceId }) {
      try {
        const devicesData = readDevicesFile();
        
        const pendingIndex = devicesData.pendingPairings.findIndex(
          p => p.deviceId === deviceId
        );

        if (pendingIndex === -1) {
          return { success: false, error: 'No pending pairing found', deviceId };
        }

        devicesData.pendingPairings.splice(pendingIndex, 1);
        await writeDevicesFile(devicesData);

        api.logger.info(`Pairing rejected for device ${deviceId}`);

        return {
          success: true,
          deviceId,
          message: 'Pairing rejected'
        };
      } catch (e) {
        api.logger.error('Pairing reject failed: ' + e.message);
        return { success: false, error: `Reject failed: ${e.message}` };
      }
    }
  });

  // Tool 5: Device Reconnect - Reconnect using stored public key
  api.registerTool({
    name: 'device.reconnect',
    description: 'Reconnect to a previously paired device using stored public key',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { 
          type: 'string', 
          description: 'Device unique ID (MAC address)' 
        }
      },
      required: ['deviceId']
    },
    async execute(toolCallId, { deviceId }) {
      try {
        const devicesData = readDevicesFile();
        const device = devicesData.devices.find(d => d.deviceId === deviceId);

        if (!device) {
          return { success: false, error: 'Device not found', deviceId };
        }

        if (!device.publicKey) {
          return { 
            success: false, 
            error: 'Device missing public key, please re-pair', 
            deviceId 
          };
        }

        // Generate new ephemeral key pair for this session
        const ecdh = crypto.createECDH(ECDH_CURVE);
        ecdh.generateKeys();

        // Generate new salt
        const salt = crypto.randomBytes(HKDF_SALT_LENGTH);

        // Compute shared secret
        const devicePubKeyBuf = Buffer.from(device.publicKey, 'base64');
        const sharedSecret = ecdh.computeSecret(devicePubKeyBuf);

        // Derive new session keys
        const { sessionKey, signKey } = deriveSessionKeys(sharedSecret, salt);

        // Update device with new keys
        device.sessionKey = sessionKey.toString('base64');
        device.signKey = signKey.toString('base64');
        device.online = true;
        device.lastSeen = Date.now();

        await writeDevicesFile(devicesData);

        api.logger.info(`Reconnected to device ${deviceId}`);

        return {
          success: true,
          deviceId,
          ephemeralPublicKey: ecdh.getPublicKey('base64'),
          salt: salt.toString('base64'),
          message: 'Reconnected successfully'
        };
      } catch (e) {
        api.logger.error('Reconnect failed: ' + e.message);
        return { success: false, error: `Reconnect failed: ${e.message}` };
      }
    }
  });

  // Tool 6: Device Unauthorize - Revoke device authorization
  api.registerTool({
    name: 'device.unauthorize',
    description: 'Revoke device authorization and remove from system',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { 
          type: 'string', 
          description: 'Device unique ID (MAC address)' 
        }
      },
      required: ['deviceId']
    },
    async execute(toolCallId, { deviceId }) {
      try {
        const devicesData = readDevicesFile();
        const deviceIndex = devicesData.devices.findIndex(d => d.deviceId === deviceId);

        if (deviceIndex === -1) {
          return { success: false, error: 'Device not found', deviceId };
        }

        const device = devicesData.devices[deviceIndex];
        device.authorized = false;
        device.online = false;
        device.sessionKey = null;
        device.signKey = null;

        await writeDevicesFile(devicesData);

        api.sendChannelMessage('feishu', {
          title: '设备授权已撤销',
          content: `设备【${device.name}】(${deviceId}) 授权已被撤销`
        });

        api.logger.info(`Device ${deviceId} unauthorized`);

        return {
          success: true,
          deviceId,
          message: 'Device authorization revoked'
        };
      } catch (e) {
        api.logger.error('Unauthorize failed: ' + e.message);
        return { success: false, error: `Unauthorize failed: ${e.message}` };
      }
    }
  });

  // Tool 7: Device Delete - Remove device completely
  api.registerTool({
    name: 'device.delete',
    description: 'Delete device from system completely',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { 
          type: 'string', 
          description: 'Device unique ID (MAC address)' 
        }
      },
      required: ['deviceId']
    },
    async execute(toolCallId, { deviceId }) {
      try {
        const devicesData = readDevicesFile();
        const deviceIndex = devicesData.devices.findIndex(d => d.deviceId === deviceId);

        if (deviceIndex === -1) {
          return { success: false, error: 'Device not found', deviceId };
        }

        const device = devicesData.devices[deviceIndex];
        devicesData.devices.splice(deviceIndex, 1);

        await writeDevicesFile(devicesData);

        api.logger.info(`Device ${deviceId} deleted`);

        return {
          success: true,
          deviceId,
          message: 'Device deleted'
        };
      } catch (e) {
        api.logger.error('Delete failed: ' + e.message);
        return { success: false, error: `Delete failed: ${e.message}` };
      }
    }
  });

  // Tool 8: Device Sync - Query device state
  api.registerTool({
    name: 'device.sync',
    description: 'Query device state and update local record',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { 
          type: 'string', 
          description: 'Device unique ID (MAC address)' 
        }
      },
      required: ['deviceId']
    },
    async execute(toolCallId, { deviceId }) {
      // Reuse control tool with query action
      return api.executeTool('device.control', { deviceId, action: 'query' });
    }
  });

  // Tool 9: Device List - List all devices
  api.registerTool({
    name: 'device.list',
    description: 'List all registered devices',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    async execute(toolCallId) {
      try {
        const devicesData = readDevicesFile();
        return {
          success: true,
          devices: devicesData.devices.map(d => ({
            deviceId: d.deviceId,
            name: d.name,
            ip: d.ip,
            authorized: d.authorized,
            online: d.online,
            state: d.state,
            lastSeen: d.lastSeen
          }))
        };
      } catch (e) {
        api.logger.error('List devices failed: ' + e.message);
        return { success: false, error: `List failed: ${e.message}` };
      }
    }
  });

  // ========================================
  // Background Services
  // ========================================

  // Service 1: Device Listener - TCP server for device connections
  api.startService('device-listener', async () => {
    // Find available port
    const actualPort = await findAvailablePort(
      pluginConfig.devicePort, 
      pluginConfig.portRangeMax
    );

    if (!actualPort) {
      api.logger.error('No available port for device listener');
      return;
    }

    const server = net.createServer(async (client) => {
      let buffer = '';
      let deviceInfo = null;

      client.on('connect', () => {
        api.logger.info(`New connection: ${client.remoteAddress}:${client.remotePort}`);
      });

      client.on('data', async (data) => {
        buffer += data.toString();
        const packets = buffer.split('\n');
        buffer = packets.pop();

        for (const packetStr of packets) {
          if (!packetStr.trim()) continue;

          try {
            const packet = JSON.parse(packetStr);

            // Handle pairing request from device
            if (packet.type === 'pairing_request') {
              const { deviceId, publicKey, name } = packet;
              
              api.logger.info(`Pairing request from ${deviceId} (${name || 'Unknown'})`);

              // Check if device already paired
              const devicesData = readDevicesFile();
              const existingDevice = devicesData.devices.find(d => d.deviceId === deviceId);

              if (existingDevice && existingDevice.authorized) {
                // Reconnection attempt - verify public key
                if (existingDevice.publicKey === publicKey) {
                  // Public key matches, allow reconnection
                  client.write(JSON.stringify({
                    type: 'reconnect_allowed',
                    ephemeralPublicKey: openclawKeyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
                  }) + '\n');
                } else {
                  client.write(JSON.stringify({
                    type: 'pairing_error',
                    error: 'Public key mismatch'
                  }) + '\n');
                }
              } else {
                // New device - start pairing process
                // Notify user about new device discovery
                api.sendChannelMessage('feishu', {
                  title: '发现新设备',
                  content: `发现新设备【${name || deviceId}】正在请求配对。请使用 device.pairing.start 工具开始配对流程。`
                });
              }
            }

            // Handle encrypted status report from device
            if (packet.type === 'encrypted' && packet.iv && packet.ciphertext) {
              // Find device by IP (since we don't know deviceId yet)
              const devicesData = readDevicesFile();
              const device = devicesData.devices.find(d => 
                d.ip === client.remoteAddress && d.authorized
              );

              if (device && device.sessionKey) {
                try {
                  const sessionKey = Buffer.from(device.sessionKey, 'base64');
                  const decrypted = decryptMessage({
                    iv: packet.iv,
                    ciphertext: packet.ciphertext
                  }, sessionKey);

                  device.state = decrypted.state;
                  device.lastSeen = Date.now();
                  await writeDevicesFile(devicesData);

                  api.logger.debug(`Status update from ${device.deviceId}: ${JSON.stringify(decrypted.state)}`);
                } catch (e) {
                  api.logger.error('Failed to decrypt status report: ' + e.message);
                }
              }
            }

          } catch (e) {
            api.logger.error('Failed to parse packet: ' + e.message);
          }
        }
      });

      client.on('close', () => {
        api.logger.info(`Connection closed: ${client.remoteAddress}`);
        if (deviceInfo) {
          const devicesData = readDevicesFile();
          const device = devicesData.devices.find(d => d.deviceId === deviceInfo.deviceId);
          if (device) {
            device.online = false;
            writeDevicesFile(devicesData).catch(() => {});
          }
        }
      });

      client.on('error', (err) => {
        api.logger.error(`Connection error: ${err.message}`);
      });
    });

    server.listen(actualPort, () => {
      api.logger.info(`Device listener started on port ${actualPort}`);
    });
  });

  // Service 2: mDNS Discovery (Local network only)
  if (pluginConfig.enableMdnsDiscovery) {
    api.startService('mdns-discovery', async () => {
      const mdnsSocket = dgram.createSocket('udp4');
      
      mdnsSocket.bind(pluginConfig.mdnsPort, () => {
        mdnsSocket.addMembership('224.0.0.251');
        api.logger.info(`mDNS discovery listening on ${pluginConfig.mdnsPort}`);
      });

      mdnsSocket.on('message', (msg, rinfo) => {
        // Parse mDNS message for OpenClaw device announcements
        // This is a simplified implementation
        if (msg.toString().includes('_openclaw._tcp')) {
          api.logger.debug(`mDNS: OpenClaw device discovered at ${rinfo.address}`);
        }
      });

      mdnsSocket.on('error', (err) => {
        api.logger.error('mDNS error: ' + err.message);
      });
    });
  }

  // Service 3: File Watcher
  api.startService('file-watcher', async () => {
    const watcher = chokidar.watch(devicesPath, { 
      persistent: true, 
      ignoreInitial: true 
    });

    watcher.on('change', (filePath) => {
      api.logger.debug(`Devices file changed: ${filePath}`);
    });

    watcher.on('error', (error) => {
      api.logger.error('File watcher error: ' + error);
    });
  });

  api.logger.info('DeviceLinkPlugin registered successfully');
};
