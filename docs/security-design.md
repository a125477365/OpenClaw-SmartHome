# Security Design for OpenClaw Smart Home System

## Overview
This document details the security measures implemented in the OpenClaw Smart Home system to prevent counterfeiting, impersonation, and hijacking attacks.

## Threat Model
1. **Device Cloning**: Attacker creates a fake device with copied MAC address
2. **Message Eavesdropping**: Attacker intercepts and reads communication between OpenClaw and devices
3. **Message Tampering**: Attacker modifies messages in transit
4. **Replay Attacks**: Attacker resends valid previous messages
5. **Impersonation**: Attacker pretends to be a legitimate device or OpenClaw instance
6. **Man-in-the-Middle**: Attacker intercepts and potentially alters communication

## Security Measures

### 1. Device Authentication & Anti-Counterfeiting
- **MAC Address as Device ID**: Each ESP32 has a globally unique MAC address burned in during manufacturing, used as the immutable deviceId
- **Factory Secret Key**: A 128-bit secret key is burned into each device during manufacturing (stored in secure flash or efuse)
- **Key Derivation**: Session-specific encryption and signing keys are derived from:
  - Factory secret (unique per device)
  - Pairing nonce (random challenge from OpenClaw)
  - Purpose labels ("session" for encryption key, "sign" for signing key)
- **Pairing Process**: 
  1. Device connects to WiFi (via provisioning)
  2. Device listens for TCP connections on port 8080
  3. OpenClaw initiates TCP connection and sends pairing request with deviceId and random nonce
  4. Device verifies deviceId matches its MAC address
  5. Device derives session keys using factory secret and nonce
  6. Device responds with pairing success (no keys transmitted - OpenClaw can derive same keys)
  7. After successful pairing, both parties share the same session keys

### 2. Message Confidentiality
- **Encryption Algorithm**: AES-256-CBC
- **Key Length**: 256-bit session key derived during pairing
- **Initialization Vector (IV)**: Random 16-byte IV generated for each message
- **Implementation**: Each message includes a unique IV, preventing pattern recognition

### 3. Message Integrity & Authenticity
- **Authentication Algorithm**: HMAC-SHA256
- **Key Length**: 256-bit signing key derived during pairing (different from encryption key)
- **HMAC Input**: Concatenation of (plaintext JSON + encrypted ciphertext)
- **Verification**: Receiver computes HMAC using shared signing key and compares with transmitted value

### 4. Replay Attack Protection
- **Timestamp Field**: Each message includes a Unix timestamp (milliseconds)
- **Freshness Window**: Receiver only accepts messages within ±5 seconds of current time
- **Nonce Field**: Each message includes a random 32-bit nonce to prevent exact replay within the time window

### 5. Secure Communication Flow
1. **Device Provisioning**: 
   - User provisions WiFi credentials via SmartConfig or web portal
   - Device connects to OpenClaw's local network
   
2. **Pairing & Authorization**:
   - OpenClaw discovers device via network scan or user-provided IP
   - OpenClaw sends pairing request with deviceId (from scan/user) and random nonce
   - Device verifies deviceId matches its MAC address
   - Device derives session keys and responds with pairing success
   - User explicitly authorizes device via UI (device.authorize tool)
   - Upon authorization, OpenClaw stores derived session keys in devices.json
   - Device marks itself as authorized and online

3. **Encrypted Command & Control**:
   - OpenClaw constructs command JSON (deviceId, action, params, timestamp, nonce)
   - Encrypts JSON using AES-256-CBC with sessionKey and random IV
   - Computes HMAC-SHA256 of (JSON + encrypted data) using signKey
   - Sends packet: {type: "encrypted", data: "<base64IV>:<base64Cipher>", sign: "<hexHmac>"}
   - Device verifies HMAC, decrypts message, checks timestamp/nonce freshness
   - Device executes command (relay on/off/query)
   - Device sends encrypted response with new timestamp/nonce
   - OpenClaw verifies and processes response

### 6. Production Security Enhancements
For production deployment, consider:
- **Secure Factory Programming**: Burn factory secret into ESP32 efuse during manufacturing
- **Secure Boot**: Enable ESP32 secure boot to prevent firmware tampering
- **Flash Encryption**: Encrypt flash contents to protect stored keys
- **Certificate-based Authentication**: Use X.509 certificates for mutual TLS (more complex but stronger)
- **Secure Element**: Use external secure element (like ATECC608A) for key storage and crypto operations
- **Over-the-Air (OTA) Updates**: Implement signed OTA updates to ensure firmware integrity

### 7. Security Limitations & Assumptions
- **Physical Security**: Assides device is in physically secure location; if attacker has physical access, they may extract keys
- **Side-Channel Attacks**: Implementation not hardened against power analysis or timing attacks (adequate for most home scenarios)
- **WiFi Security**: Relies on WPA2-PSK for link-layer security; additional encryption provides defense-in-depth
- **Key Exposure**: If factory secret is extracted from one device, all devices from same batch are compromised (mitigated by unique per-device secrets in production)

## Security Summary
The system provides:
- ✅ **Device Authentication**: Verified via MAC address and factory-secret-derived keys
- ✅ **Message Confidentiality**: AES-256-CBC encryption with random IV
- ✅ **Message Integrity**: HMAC-SHA256 authentication
- ✅ **Replay Protection**: Timestamp + nonce validation
- ✅ **Authorization Required**: Explicit user approval needed before device can be controlled
- ✅ **Forward Secrecy**: Session keys derived per pairing; compromise of one session doesn't affect others
- ✅ **Defense in Depth**: Multiple security layers working together

These measures collectively prevent:
- Counterfeit devices (cannot derive correct keys without factory secret)
- Impersonation (requires valid MAC and ability to derive keys)
- Eavesdropping (AES-256 encryption)
- Message tampering (HMAC detection)
- Replay attacks (timestamp/nonce validation)
- Unauthorized control (requires explicit authorization step)