#!/usr/bin/env node
/**
 * Integration tests for OpenClaw Smart Home System
 * Tests: end-to-end encryption, device pairing simulation
 */

const crypto = require('crypto');
const assert = require('assert');

console.log('========================================');
console.log('OpenClaw Smart Home - Integration Tests');
console.log('========================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${e.message}`);
    failed++;
  }
}

// Simulated constants
const ECDH_CURVE = 'prime256v1';
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

// ========================================
// Simulate OpenClaw Side
// ========================================
class OpenClawSimulator {
  constructor() {
    this.ephemeralKeyPair = null;
    this.ecdh = null;
    this.sessionKey = null;
    this.signKey = null;
    this.salt = null;
  }

  startPairing(devicePublicKey) {
    // Generate ephemeral key pair
    this.ecdh = crypto.createECDH(ECDH_CURVE);
    this.ecdh.generateKeys();
    
    // Generate salt
    this.salt = crypto.randomBytes(16);
    
    // Compute shared secret
    const sharedSecret = this.ecdh.computeSecret(devicePublicKey);
    
    // Derive session keys (matching ESP32 implementation)
    this.sessionKey = this.deriveKey(sharedSecret, this.salt, 'encryption');
    this.signKey = this.deriveKey(sharedSecret, this.salt, 'signing');
    
    return {
      ephemeralPublicKey: this.ecdh.getPublicKey(),
      salt: this.salt,
      confirmCode: this.generateConfirmCode(sharedSecret, this.salt)
    };
  }

  deriveKey(sharedSecret, salt, info) {
    const hash = crypto.createHash('sha256');
    hash.update(sharedSecret);
    hash.update(info);
    hash.update(salt);
    return hash.digest();
  }

  generateConfirmCode(sharedSecret, salt) {
    const hash = crypto.createHash('sha256');
    hash.update(sharedSecret);
    hash.update(salt);
    const digest = hash.digest();
    const code = (digest[0] << 16 | digest[1] << 8 | digest[2]) % 1000000;
    return code.toString().padStart(6, '0');
  }

  encryptCommand(action, deviceId) {
    const command = {
      type: 'control',
      deviceId: deviceId,
      action: action,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(8).toString('hex')
    };

    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.sessionKey, iv, { authTagLength: GCM_TAG_LENGTH });
    let encrypted = cipher.update(JSON.stringify(command), 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      type: 'encrypted',
      iv: iv.toString('base64'),
      ciphertext: Buffer.concat([encrypted, authTag]).toString('base64')
    };
  }

  decryptResponse(response) {
    const iv = Buffer.from(response.iv, 'base64');
    const data = Buffer.from(response.ciphertext, 'base64');
    const ciphertext = data.slice(0, -GCM_TAG_LENGTH);
    const authTag = data.slice(-GCM_TAG_LENGTH);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.sessionKey, iv, { authTagLength: GCM_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }
}

// ========================================
// Simulate ESP32 Device
// ========================================
class DeviceSimulator {
  constructor() {
    this.ecdh = crypto.createECDH(ECDH_CURVE);
    this.ecdh.generateKeys();
    this.sessionKey = null;
    this.signKey = null;
    this.confirmCode = null;
  }

  getPublicKey() {
    // Return uncompressed public key (65 bytes: 0x04 + x + y)
    return this.ecdh.getPublicKey();
  }

  completePairing(ephemeralPublicKey, salt) {
    // Compute shared secret using our private key and OpenClaw's ephemeral public key
    const sharedSecret = this.ecdh.computeSecret(ephemeralPublicKey);
    
    // Derive session keys (same as OpenClaw)
    this.sessionKey = this.deriveKey(sharedSecret, salt, 'encryption');
    this.signKey = this.deriveKey(sharedSecret, salt, 'signing');
    
    // Generate confirmation code (should match OpenClaw)
    this.confirmCode = this.generateConfirmCode(sharedSecret, salt);
    return this.confirmCode;
  }

  deriveKey(sharedSecret, salt, info) {
    const hash = crypto.createHash('sha256');
    hash.update(sharedSecret);
    hash.update(info);
    hash.update(salt);
    return hash.digest();
  }

  generateConfirmCode(sharedSecret, salt) {
    const hash = crypto.createHash('sha256');
    hash.update(sharedSecret);
    hash.update(salt);
    const digest = hash.digest();
    const code = (digest[0] << 16 | digest[1] << 8 | digest[2]) % 1000000;
    return code.toString().padStart(6, '0');
  }

  decryptCommand(packet) {
    const iv = Buffer.from(packet.iv, 'base64');
    const data = Buffer.from(packet.ciphertext, 'base64');
    const ciphertext = data.slice(0, -GCM_TAG_LENGTH);
    const authTag = data.slice(-GCM_TAG_LENGTH);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.sessionKey, iv, { authTagLength: GCM_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  encryptResponse(state) {
    const response = {
      type: 'response',
      state: state,
      timestamp: Date.now()
    };

    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.sessionKey, iv, { authTagLength: GCM_TAG_LENGTH });
    let encrypted = cipher.update(JSON.stringify(response), 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      type: 'encrypted',
      iv: iv.toString('base64'),
      ciphertext: Buffer.concat([encrypted, authTag]).toString('base64')
    };
  }
}

// ========================================
// Integration Tests
// ========================================
console.log('\n--- End-to-End Pairing Tests ---\n');

test('ECDH pairing: both sides compute same confirm code', () => {
  const openclaw = new OpenClawSimulator();
  const device = new DeviceSimulator();
  
  // Step 1: Device sends public key
  const devicePublicKey = device.getPublicKey();
  
  // Step 2: OpenClaw starts pairing
  const pairingInfo = openclaw.startPairing(devicePublicKey);
  
  // Step 3: Device computes same code
  const deviceConfirmCode = device.completePairing(
    openclaw.ecdh.getPublicKey(),
    pairingInfo.salt
  );
  
  assert(pairingInfo.confirmCode === deviceConfirmCode, 
    `Codes should match: OpenClaw=${pairingInfo.confirmCode}, Device=${deviceConfirmCode}`);
});

test('ECDH pairing: session keys match on both sides', () => {
  const openclaw = new OpenClawSimulator();
  const device = new DeviceSimulator();
  
  const devicePublicKey = device.getPublicKey();
  const pairingInfo = openclaw.startPairing(devicePublicKey);
  device.completePairing(openclaw.ecdh.getPublicKey(), pairingInfo.salt);
  
  assert(openclaw.sessionKey.equals(device.sessionKey), 
    'Session keys should match');
});

console.log('\n--- End-to-End Communication Tests ---\n');

test('Encrypted command: OpenClaw -> Device', () => {
  const openclaw = new OpenClawSimulator();
  const device = new DeviceSimulator();
  
  // Setup pairing
  const devicePublicKey = device.getPublicKey();
  const pairingInfo = openclaw.startPairing(devicePublicKey);
  device.completePairing(openclaw.ecdh.getPublicKey(), pairingInfo.salt);
  
  // Send command
  const packet = openclaw.encryptCommand('on', 'AA:BB:CC:DD:EE:FF');
  const decrypted = device.decryptCommand(packet);
  
  assert(decrypted.action === 'on', 'Action should be preserved');
  assert(decrypted.deviceId === 'AA:BB:CC:DD:EE:FF', 'DeviceId should be preserved');
});

test('Encrypted response: Device -> OpenClaw', () => {
  const openclaw = new OpenClawSimulator();
  const device = new DeviceSimulator();
  
  // Setup pairing
  const devicePublicKey = device.getPublicKey();
  const pairingInfo = openclaw.startPairing(devicePublicKey);
  device.completePairing(openclaw.ecdh.getPublicKey(), pairingInfo.salt);
  
  // Send response
  const response = device.encryptResponse('on');
  const decrypted = openclaw.decryptResponse(response);
  
  assert(decrypted.state === 'on', 'State should be preserved');
});

test('Full round-trip: command + response', () => {
  const openclaw = new OpenClawSimulator();
  const device = new DeviceSimulator();
  
  // Setup pairing
  const devicePublicKey = device.getPublicKey();
  const pairingInfo = openclaw.startPairing(devicePublicKey);
  device.completePairing(openclaw.ecdh.getPublicKey(), pairingInfo.salt);
  
  // OpenClaw sends 'on' command
  const commandPacket = openclaw.encryptCommand('on', 'test-device');
  const commandDecrypted = device.decryptCommand(commandPacket);
  assert(commandDecrypted.action === 'on');
  
  // Device responds with state
  const responsePacket = device.encryptResponse('on');
  const responseDecrypted = openclaw.decryptResponse(responsePacket);
  assert(responseDecrypted.state === 'on');
});

console.log('\n--- Security Tests ---\n');

test('Man-in-the-middle detection: wrong session key fails', () => {
  const openclaw = new OpenClawSimulator();
  const device = new DeviceSimulator();
  
  // Setup pairing
  const devicePublicKey = device.getPublicKey();
  const pairingInfo = openclaw.startPairing(devicePublicKey);
  device.completePairing(openclaw.ecdh.getPublicKey(), pairingInfo.salt);
  
  // Attacker with wrong key tries to decrypt
  const attackerKey = crypto.randomBytes(32);
  const packet = openclaw.encryptCommand('on', 'test');
  
  let errorOccurred = false;
  try {
    // Replace session key with attacker's key
    const iv = Buffer.from(packet.iv, 'base64');
    const data = Buffer.from(packet.ciphertext, 'base64');
    const ciphertext = data.slice(0, -GCM_TAG_LENGTH);
    const authTag = data.slice(-GCM_TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', attackerKey, iv);
    decipher.setAuthTag(authTag);
    decipher.update(ciphertext);
    decipher.final();
  } catch (e) {
    errorOccurred = true;
  }
  
  assert(errorOccurred, 'Wrong key should fail decryption');
});

test('Replay attack prevention: different nonces each time', () => {
  const openclaw = new OpenClawSimulator();
  const device = new DeviceSimulator();
  
  const devicePublicKey = device.getPublicKey();
  const pairingInfo = openclaw.startPairing(devicePublicKey);
  device.completePairing(openclaw.ecdh.getPublicKey(), pairingInfo.salt);
  
  const packet1 = openclaw.encryptCommand('on', 'test');
  const packet2 = openclaw.encryptCommand('on', 'test');
  
  // Different IVs mean different ciphertexts
  assert(packet1.iv !== packet2.iv, 'Each packet should have unique IV');
  assert(packet1.ciphertext !== packet2.ciphertext, 'Ciphertexts should differ');
});

// ========================================
// Summary
// ========================================
console.log('\n========================================');
console.log(`Total: ${passed + failed} tests`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);
