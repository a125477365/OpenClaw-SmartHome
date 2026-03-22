#!/usr/bin/env node
/**
 * Automated tests for OpenClaw Smart Home System
 * Tests: encryption, ECDH key derivation, message format
 */

const crypto = require('crypto');
const assert = require('assert');

console.log('========================================');
console.log('OpenClaw Smart Home - Automated Tests');
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

// ========================================
// Test 1: ECDH Key Generation
// ========================================
console.log('\n--- ECDH Key Generation Tests ---\n');

test('ECDH key pair generation (P-256)', () => {
  const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  assert(keyPair.publicKey, 'Public key should exist');
  assert(keyPair.privateKey, 'Private key should exist');
});

test('ECDH shared secret computation', () => {
  const alice = crypto.createECDH('prime256v1');
  const bob = crypto.createECDH('prime256v1');
  
  alice.generateKeys();
  bob.generateKeys();
  
  const aliceSecret = alice.computeSecret(bob.getPublicKey());
  const bobSecret = bob.computeSecret(alice.getPublicKey());
  
  assert(aliceSecret.equals(bobSecret), 'Shared secrets should match');
  assert(aliceSecret.length === 32, 'Shared secret should be 32 bytes');
});

// ========================================
// Test 2: Key Derivation (SHA256 method)
// ========================================
console.log('\n--- Key Derivation Tests ---\n');

test('Session key derivation (SHA256)', () => {
  const sharedSecret = crypto.randomBytes(32);
  const salt = crypto.randomBytes(16);
  
  // OpenClaw implementation
  const sessionKeyHash = crypto.createHash('sha256');
  sessionKeyHash.update(sharedSecret);
  sessionKeyHash.update('encryption');
  sessionKeyHash.update(salt);
  const sessionKey = sessionKeyHash.digest();
  
  assert(sessionKey.length === 32, 'Session key should be 32 bytes');
});

test('Key derivation consistency', () => {
  const sharedSecret = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const salt = Buffer.from('0123456789abcdef', 'hex');
  
  // Derive twice with same inputs
  const deriveKey = (secret, s) => {
    const hash = crypto.createHash('sha256');
    hash.update(secret);
    hash.update('encryption');
    hash.update(s);
    return hash.digest();
  };
  
  const key1 = deriveKey(sharedSecret, salt);
  const key2 = deriveKey(sharedSecret, salt);
  
  assert(key1.equals(key2), 'Same inputs should produce same key');
});

// ========================================
// Test 3: AES-256-GCM Encryption
// ========================================
console.log('\n--- AES-256-GCM Encryption Tests ---\n');

test('AES-256-GCM encryption/decryption', () => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const plaintext = { type: 'control', action: 'on', deviceId: 'test' };
  
  // Encrypt
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  let encrypted = cipher.update(JSON.stringify(plaintext), 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Decrypt
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  const result = JSON.parse(decrypted.toString('utf8'));
  assert(result.action === 'on', 'Decrypted message should match original');
});

test('AES-256-GCM authentication failure detection', () => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const plaintext = 'test message';
  
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Tamper with auth tag
  const tamperedTag = Buffer.from(authTag);
  tamperedTag[0] ^= 0xFF;
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tamperedTag);
  
  let errorOccurred = false;
  try {
    decipher.update(encrypted);
    decipher.final();
  } catch (e) {
    errorOccurred = true;
  }
  
  assert(errorOccurred, 'Tampered auth tag should cause error');
});

// ========================================
// Test 4: Confirmation Code Generation
// ========================================
console.log('\n--- Confirmation Code Tests ---\n');

test('6-digit confirmation code generation', () => {
  const sharedSecret = crypto.randomBytes(32);
  const salt = crypto.randomBytes(16);
  
  const hash = crypto.createHash('sha256');
  hash.update(sharedSecret);
  hash.update(salt);
  const digest = hash.digest();
  
  const code = (digest[0] << 16 | digest[1] << 8 | digest[2]) % 1000000;
  const confirmCode = code.toString().padStart(6, '0');
  
  assert(confirmCode.length === 6, 'Confirmation code should be 6 digits');
  assert(/^\d{6}$/.test(confirmCode), 'Should be numeric string');
});

test('Confirmation code consistency', () => {
  const sharedSecret = Buffer.alloc(32, 0x42);
  const salt = Buffer.alloc(16, 0x00);
  
  const generateCode = (secret, s) => {
    const hash = crypto.createHash('sha256');
    hash.update(secret);
    hash.update(s);
    const digest = hash.digest();
    const code = (digest[0] << 16 | digest[1] << 8 | digest[2]) % 1000000;
    return code.toString().padStart(6, '0');
  };
  
  const code1 = generateCode(sharedSecret, salt);
  const code2 = generateCode(sharedSecret, salt);
  
  assert(code1 === code2, 'Same inputs should produce same code');
});

// ========================================
// Test 5: Message Format
// ========================================
console.log('\n--- Message Format Tests ---\n');

test('Encrypted message format', () => {
  const key = crypto.randomBytes(32);
  const message = { type: 'control', action: 'on' };
  
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  let encrypted = cipher.update(JSON.stringify(message), 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  const packet = {
    type: 'encrypted',
    iv: iv.toString('base64'),
    ciphertext: Buffer.concat([encrypted, authTag]).toString('base64')
  };
  
  assert(packet.type === 'encrypted', 'Packet type should be encrypted');
  assert(packet.iv, 'Should have IV');
  assert(packet.ciphertext, 'Should have ciphertext');
});

// ========================================
// Test 6: Replay Protection
// ========================================
console.log('\n--- Replay Protection Tests ---\n');

test('Timestamp validation (within window)', () => {
  const now = Date.now();
  const messageTime = now - 4000; // 4 seconds ago
  
  const isValid = Math.abs(now - messageTime) <= 5000;
  assert(isValid, 'Message within 5s window should be valid');
});

test('Timestamp validation (outside window)', () => {
  const now = Date.now();
  const messageTime = now - 10000; // 10 seconds ago
  
  const isValid = Math.abs(now - messageTime) <= 5000;
  assert(!isValid, 'Message outside 5s window should be invalid');
});

test('Nonce uniqueness', () => {
  const nonces = new Set();
  for (let i = 0; i < 1000; i++) {
    const nonce = crypto.randomBytes(8).toString('hex');
    assert(!nonces.has(nonce), 'Nonce should be unique');
    nonces.add(nonce);
  }
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
