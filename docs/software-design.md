# Software Design for OpenClaw Smart Home System

## Overview

This document details the software architecture, communication protocol, encryption, and API definitions for the OpenClaw Smart Home system.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         OpenClaw Agent                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │  DeviceLinkPlugin │    │ UIManagePlugin  │                    │
│  │                 │    │                 │                    │
│  │ - device.control│    │ - HTTPS Server  │                    │
│  │ - device.pairing│    │ - Password Auth │                    │
│  │ - device.reconnect│    │ - Device List   │                    │
│  │ - device.sync   │    │ - Control UI    │                    │
│  │ - device.list   │    │                 │                    │
│  └────────┬────────┘    └────────┬────────┘                    │
│           │                      │                              │
│           └──────────┬───────────┘                              │
│                      │                                          │
│              ┌───────▼───────┐                                  │
│              │ devices.json  │                                  │
│              │ (Data Store)  │                                  │
│              └───────────────┘                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                       │
                       │ TCP (AES-256-GCM)
                       ▼
              ┌───────────────┐
              │  ESP32 Device │
              │ (Smart Switch)│
              └───────────────┘
```

## Skill and Plugin Structure

### HomeSkill

The main skill that contains all device management functionality.

```json
{
  "id": "home-smart-skill",
  "name": "Smart Home Skill",
  "version": "1.0.0",
  "plugins": [
    "DeviceLinkPlugin",
    "UIManagePlugin"
  ]
}
```

### DeviceLinkPlugin

Handles device communication, pairing, and control.

**Tools:**
- `device.control` - Send commands to devices
- `device.pairing.start` - Initiate ECDH pairing
- `device.pairing.confirm` - Complete pairing
- `device.pairing.reject` - Reject pairing
- `device.reconnect` - Reconnect using stored key
- `device.unauthorize` - Revoke authorization
- `device.delete` - Remove device
- `device.sync` - Query device state
- `device.list` - List all devices

**Services:**
- `device-listener` - TCP server for device connections
- `mdns-discovery` - mDNS discovery (local network only)
- `file-watcher` - Monitor devices.json changes

### UIManagePlugin

Provides web-based management interface.

**Tools:**
- `ui.password.get` - Get password info
- `ui.password.reset` - Reset password
- `ui.ports` - Get actual ports in use

**Services:**
- `http-server` - HTTPS server with password auth

## Communication Protocol

### 1. Device Pairing (ECDH)

```
┌─────────────┐                    ┌─────────────┐
│   Device    │                    │  OpenClaw   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ 1. pairing_request               │
       │   {deviceId, publicKey, name}    │
       │─────────────────────────────────>│
       │                                  │
       │                                  │ 2. Generate ephemeral key
       │                                  │    Compute shared secret
       │                                  │    Generate confirm code
       │                                  │
       │ 3. pairing_response              │
       │   {ephemeralPublicKey, salt}     │
       │<─────────────────────────────────│
       │                                  │
       │ 4. Compute shared secret         │
       │    Generate same confirm code    │
       │                                  │
       │         [User confirms code      │
       │          matches on both sides]  │
       │                                  │
       │ 5. pairing_confirm               │
       │   {confirmed: true}              │
       │─────────────────────────────────>│
       │                                  │
       │ 6. pairing_success               │
       │   {sessionKey stored}            │
       │<─────────────────────────────────│
       │                                  │
```

### 2. Device Control

```
┌─────────────┐                    ┌─────────────┐
│   Device    │                    │  OpenClaw   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ 1. control command (encrypted)   │
       │   {type: "encrypted",            │
       │    iv: "...",                    │
       │    ciphertext: "..."}            │
       │<─────────────────────────────────│
       │                                  │
       │ 2. Decrypt, execute command      │
       │                                  │
       │ 3. response (encrypted)          │
       │   {type: "encrypted",            │
       │    iv: "...",                    │
       │    ciphertext: "..."}            │
       │─────────────────────────────────>│
       │                                  │
```

### 3. Device Status Report

```
┌─────────────┐                    ┌─────────────┐
│   Device    │                    │  OpenClaw   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ 1. status report (encrypted)     │
       │   {type: "encrypted",            │
       │    iv: "...",                    │
       │    ciphertext: {state: "on"}}    │
       │─────────────────────────────────>│
       │                                  │
       │                    2. Decrypt, update state
       │                       in devices.json
       │                                  │
```

## Encryption Details

### Algorithm: AES-256-GCM

- **Key Length**: 256 bits
- **IV Length**: 96 bits (12 bytes)
- **Tag Length**: 128 bits (16 bytes)

### Key Derivation (HKDF)

```javascript
// From shared secret to session keys
sessionKey = HKDF-SHA256(sharedSecret, salt, "encryption", 32)
signKey = HKDF-SHA256(sharedSecret, salt, "signing", 32)
```

### Message Format

```json
{
  "type": "encrypted",
  "iv": "base64(12 bytes)",
  "ciphertext": "base64(encrypted data + auth tag)"
}
```

### Encryption Process

1. Generate random 12-byte IV
2. Create AES-256-GCM cipher with key and IV
3. Encrypt plaintext JSON
4. Get authentication tag
5. Concatenate ciphertext + auth tag
6. Base64 encode IV and ciphertext

### Decryption Process

1. Base64 decode IV and ciphertext
2. Split ciphertext (data) and auth tag (last 16 bytes)
3. Create AES-256-GCM decipher
4. Set authentication tag
5. Decrypt and verify

## Data Structures

### devices.json

```json
{
  "devices": [
    {
      "deviceId": "AA:BB:CC:DD:EE:FF",
      "name": "Living Room Light",
      "ip": "192.168.1.100",
      "port": 8080,
      "publicKey": "base64(EC public key)",
      "sessionKey": "base64(AES key)",
      "signKey": "base64(HMAC key)",
      "authorized": true,
      "online": true,
      "state": {
        "switch": "on"
      },
      "pairedAt": 1710987654321,
      "lastSeen": 1710987654321
    }
  ],
  "pendingPairings": [
    {
      "deviceId": "11:22:33:44:55:66",
      "deviceIp": "192.168.1.101",
      "devicePublicKey": "base64",
      "ephemeralPublicKey": "base64",
      "salt": "base64",
      "sessionKey": "base64",
      "signKey": "base64",
      "confirmCode": "123456",
      "createdAt": 1710987654321,
      "expiresAt": 1710987714321
    }
  ]
}
```

## API Endpoints (UIManagePlugin)

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/login` | GET | Login page |
| `/api/login` | POST | Authenticate with password |
| `/logout` | GET | Logout |
| `/api/password/reset` | POST | Reset password |

### Device Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/devices` | GET | List all devices |
| `/api/devices` | POST | Add new device |
| `/api/device/authorize` | POST | Authorize device |
| `/api/device/unauthorize` | POST | Revoke device |
| `/api/device/control` | POST | Control device |

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "error": "Error message",
  "deviceId": "optional"
}
```

### Common Error Codes

| Error | Description |
|-------|-------------|
| Device not found | deviceId does not exist |
| Device not authorized | Device exists but not paired |
| Device offline | Device not connected |
| Connection failed | TCP connection error |
| Response timeout | No response within 10s |
| Decryption failed | AES-GCM auth failed |

## Configuration

### DeviceLinkPlugin/config.json

```json
{
  "devicePort": 8080,
  "mdnsPort": 5353,
  "pairingTimeout": 60000,
  "portRangeMin": 8080,
  "portRangeMax": 8100,
  "enableMdnsDiscovery": true,
  "encryption": {
    "algorithm": "aes-256-gcm",
    "keyLength": 32,
    "ivLength": 12
  }
}
```

### UIManagePlugin/config.json

```json
{
  "httpsPort": 8083,
  "httpPort": 8082,
  "portRangeMin": 8080,
  "portRangeMax": 8100,
  "webRoot": "./web",
  "ssl": {
    "key": "./ssl/key.pem",
    "cert": "./ssl/cert.pem"
  }
}
```

## Security Considerations

1. **No pre-shared secrets**: Each pairing generates unique keys
2. **Forward secrecy**: New keys for each pairing session
3. **User confirmation**: 6-digit code prevents MITM
4. **Encrypted storage**: Keys stored encrypted in devices.json
5. **Password protection**: UI requires authentication
6. **HTTPS only**: HTTP redirects to HTTPS
7. **Session timeout**: 24-hour session expiry

## Dependencies

### DeviceLinkPlugin

- `chokidar` - File watching

### UIManagePlugin

- Built-in Node.js modules only (fs, path, crypto, net, http, https)

## License

MIT
