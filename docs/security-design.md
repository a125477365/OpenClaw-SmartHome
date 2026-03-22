# Security Design for OpenClaw Smart Home System

## Overview
This document details the security measures implemented in the OpenClaw Smart Home system to prevent counterfeiting, impersonation, and hijacking attacks. The design follows the standard Bluetooth pairing model (cross-brand, no pre-shared secrets) using ECDH key exchange.

## Threat Model
1. **Device Cloning**: Attacker creates a fake device with copied MAC address
2. **Message Eavesdropping**: Attacker intercepts and reads communication between OpenClaw and devices
3. **Message Tampering**: Attacker modifies messages in transit
4. **Replay Attacks**: Attacker resends valid previous messages
5. **Impersonation**: Attacker pretends to be a legitimate device or OpenClaw instance
6. **Man-in-the-Middle**: Attacker intercepts and potentially alters communication

## Security Measures

### 1. Device Authentication & Anti-Counterfeiting (Bluetooth-Style Pairing)

**Key Principle**: NO pre-shared factory secrets. All keys are derived dynamically during pairing using ECDH, following standard Bluetooth cross-brand pairing model.

- **MAC Address as Device ID**: Each ESP32 has a globally unique MAC address burned in during manufacturing, used as the immutable deviceId (like Bluetooth BD_ADDR)

- **Per-Device EC Key Pair**: Each device generates its own EC key pair (secp256r1/P-256) during first boot. The private key never leaves the device; the public key is shared during pairing.

- **ECDH Key Exchange**: Session keys are derived through Elliptic Curve Diffie-Hellman key exchange:
  - Both parties exchange public keys
  - Each computes shared secret: `sharedSecret = ECDH(myPrivateKey, theirPublicKey)`
  - Session keys are derived from this shared secret

- **No Pre-Shared Secrets**: Different manufacturers' devices can pair without any prior arrangement. Each pairing is independent.

- **Anti-Cloning**: Even if MAC address is copied, the attacker cannot compute the correct session keys without the device's private EC key.

### 2. Pairing Process (Bluetooth SSP Equivalent)

The pairing process mimics Bluetooth Secure Simple Pairing (SSP) with "Just Works" model (no display on the device):

#### Step 1: Device Discovery
- Device connects to WiFi (via provisioning)
- Device announces itself via mDNS or TCP listen on port 8080
- OpenClaw discovers device via network scan or user-provided IP

#### Step 2: Public Key Exchange
- OpenClaw sends: `{ type: "pairing_start", deviceId: "MAC", ephemeralPublicKey: "..." }`
- Device verifies deviceId matches its MAC
- Device responds: `{ type: "pairing_response", staticPublicKey: "...", signature: "..." }`
- The signature proves ownership of the static private key

#### Step 3: ECDH Key Derivation
- Both parties compute shared secret:
  - OpenClaw: `sharedSecret = ECDH(ephemeralPrivateKey, deviceStaticPublicKey)`
  - Device: `sharedSecret = ECDH(staticPrivateKey, openclawEphemeralPublicKey)`
- Derive session keys using HKDF:
  - `sessionKey = HKDF(sharedSecret, "encryption", salt)`
  - `signKey = HKDF(sharedSecret, "signing", salt)`

#### Step 4: User Confirmation (Numeric Comparison)
- Both sides compute a confirmation value: `confirmHash = SHA256(sharedSecret || nonce)`
- Display 6-digit numeric code derived from confirmation hash:
  - On OpenClaw UI: show the code
  - On device: if has display, show same code; otherwise, user confirms by physical presence (button press)
- User must confirm both codes match (prevents MITM)

#### Step 5: Finalize Pairing
- After user confirmation, both parties mark the pairing as complete
- OpenClaw stores the device's static public key (for future reconnection)
- Session keys are now established for encrypted communication

### 3. Reconnection Flow

For subsequent connections after initial pairing:

1. Device sends its static public key
2. OpenClaw verifies it matches stored public key for that deviceId
3. OpenClaw generates new ephemeral key pair
4. Both perform ECDH to derive new session keys
5. No user confirmation needed (keys already trusted)

### 4. Message Confidentiality

- **Encryption Algorithm**: AES-256-GCM (provides both encryption and authentication)
- **Key Length**: 256-bit session key derived from ECDH shared secret
- **Nonce/IV**: Random 12-byte nonce per message (AES-GCM standard)
- **Implementation**: Each message includes unique nonce, preventing pattern recognition

### 5. Message Integrity & Authenticity

- **Algorithm**: AES-256-GCM provides built-in authentication tag
- **Additional Data**: Message metadata (timestamp, nonce) included as AAD
- **Tag Verification**: Receiver verifies authentication tag before decryption

### 6. Replay Attack Protection

- **Timestamp Field**: Each message includes a Unix timestamp (milliseconds)
- **Freshness Window**: Receiver only accepts messages within ±5 seconds of current time
- **Nonce Field**: Each message includes a random 64-bit nonce to prevent exact replay
- **Nonce Tracking**: Keep track of used nonces within the time window

### 7. Secure Communication Flow

1. **Device Provisioning**:
   - User provisions WiFi credentials via SmartConfig or web portal
   - Device connects to OpenClaw's local network

2. **Initial Pairing** (first time):
   - Follow Steps 1-5 above (full ECDH exchange with user confirmation)
   - Device's static public key is stored in devices.json
   - User explicitly authorizes device via UI

3. **Reconnection** (subsequent):
   - Simplified ECDH using stored public key
   - New session keys derived each time

4. **Encrypted Command & Control**:
   - OpenClaw constructs command JSON (deviceId, action, params, timestamp, nonce)
   - Encrypts using AES-256-GCM with sessionKey and random nonce
   - Device verifies tag, decrypts, executes command
   - Device sends encrypted response with new nonce

### 8. Why No Factory Secret?

**This is a critical design choice** that aligns with standard Bluetooth cross-brand pairing:

1. **Interoperability**: Different manufacturers' devices can pair without prior coordination
2. **No Key Distribution**: No need to securely distribute factory secrets to manufacturers
3. **Security Through Proven Crypto**: ECDH is well-studied; security depends on private keys staying private
4. **Per-Session Keys**: Each pairing generates unique keys; compromise of one doesn't affect others

### 9. Production Security Enhancements

For production deployment:
- **Secure Key Storage**: Store private key in ESP32 efuse or external secure element (ATECC608A)
- **Secure Boot**: Enable ESP32 secure boot to prevent firmware tampering
- **Flash Encryption**: Encrypt flash contents to protect stored keys
- **Certificate Pinning**: Consider X.509 certificates for additional verification
- **OTA Updates**: Implement signed OTA updates

### 10. Security Summary

The system provides:

- ✅ **Device Authentication**: Verified via EC public key signature
- ✅ **Message Confidentiality**: AES-256-GCM encryption
- ✅ **Message Integrity**: AES-GCM authentication tag
- ✅ **Replay Protection**: Timestamp + nonce validation
- ✅ **Authorization Required**: Explicit user approval needed
- ✅ **Forward Secrecy**: New session keys each pairing
- ✅ **No Pre-Shared Secrets**: Cross-brand compatible like Bluetooth
- ✅ **Anti-Cloning**: Requires device's private EC key

These measures collectively prevent:
- Counterfeit devices (cannot compute shared secret without private key)
- Impersonation (requires valid EC key pair)
- Eavesdropping (AES-256-GCM encryption)
- Message tampering (GCM authentication tag)
- Replay attacks (timestamp/nonce validation)
- Man-in-the-middle (user confirms numeric codes)
- Unauthorized control (requires explicit authorization)