# OpenClaw Smart Home System

## Overview

This repository provides a complete design for a smart home system built on the OpenClaw platform. It consists of:

- **1 Skill**: `HomeSkill` (container for plugins)
- **2 Plugins**:
  1. `DeviceLinkPlugin` – handles device connection, ECDH pairing, encryption, control, and status reporting
  2. `UIManagePlugin` – provides a web-based management interface (HTTPS with password auth, auto port selection)
- **1 Data file**: `devices.json` – stores device info, state, and encryption keys
- **Hardware design**: ESP32-based smart switch

All code and documentation are in English.

## Security Features

### ECDH-Based Pairing (Bluetooth-Style)

- **No pre-shared secrets**: Each device generates its own EC key pair
- **User confirmation**: 6-digit confirmation code prevents MITM attacks
- **Forward secrecy**: New session keys for each pairing
- **AES-256-GCM encryption**: Authenticated encryption for all communications

### UI Security

- **Password protected**: Strong password required for web access
- **HTTPS only**: HTTP redirects to HTTPS
- **Session management**: 24-hour session timeout
- **Password hashing**: PBKDF2-SHA512 with 100,000 iterations

## Directory Structure

```
OpenClaw-SmartHome/
├── README.md
├── Skills/
│   └── HomeSkill/
│       ├── openclaw.skill.json
│       ├── package.json              # npm dependencies
│       ├── devices.json
│       ├── DeviceLinkPlugin/
│       │   ├── openclaw.plugin.json
│       │   ├── config.json
│       │   └── index.js              # Main plugin code
│       └── UIManagePlugin/
│           ├── openclaw.plugin.json
│           ├── config.json
│           ├── index.js              # HTTPS server
│           ├── password.json         # Stored password hash
│           ├── ssl/
│           │   ├── cert.pem
│           │   └── key.pem
│           └── web/
│               ├── index.html
│               └── edit.html
├── docs/
│   ├── hardware-design.md
│   ├── security-design.md
│   └── software-design.md
└── firmware/
    └── esp32_switch/
        └── esp32_switch.ino
```

## Tools Provided

### DeviceLinkPlugin

| Tool | Description |
|------|-------------|
| `device.control` | Send control command (on/off/query) |
| `device.pairing.start` | Initiate ECDH pairing process |
| `device.pairing.confirm` | Complete pairing after user confirms code |
| `device.pairing.reject` | Reject pending pairing |
| `device.reconnect` | Reconnect using stored public key |
| `device.unauthorize` | Revoke device authorization |
| `device.delete` | Remove device completely |
| `device.sync` | Query and update device state |
| `device.list` | List all registered devices |

### UIManagePlugin

| Tool | Description |
|------|-------------|
| `ui.password.get` | Get password info (cannot view, only reset) |
| `ui.password.reset` | Generate new random password |
| `ui.ports` | Get actual HTTP/HTTPS ports in use |

## Configuration

### Auto Port Selection

Both plugins support automatic port selection:

1. Tries configured port first
2. If occupied, searches for next available port
3. Search range configurable via `portRangeMin` and `portRangeMax`

### DeviceLinkPlugin/config.json

```json
{
  "devicePort": 8080,
  "mdnsPort": 5353,
  "pairingTimeout": 60000,
  "portRangeMin": 8080,
  "portRangeMax": 8100,
  "enableMdnsDiscovery": false,
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

## Quick Start

1. Clone this repository into your OpenClaw `Skills/` directory:
   ```bash
   git clone https://github.com/your-org/OpenClaw-SmartHome.git ~/.openclaw/skills/HomeSkill
   ```

2. Install dependencies:
   ```bash
   cd ~/.openclaw/skills/HomeSkill
   npm install
   ```

3. Restart OpenClaw (skills load automatically)

4. Access the UI:
   - HTTPS: `https://localhost:8083` (or next available port)
   - Check logs for initial password: `ui.password.reset` to get a new one

5. Pair a device:
   ```
   User: I found a new device, start pairing
   Agent: [calls device.pairing.start]
   Agent: Please confirm code 123456 matches the device
   User: Confirmed
   Agent: [calls device.pairing.confirm]
   ```

## Pairing Flow

```
┌─────────────┐                    ┌─────────────┐
│   Device    │                    │  OpenClaw   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ pairing_request                  │
       │ {deviceId, publicKey}            │
       │─────────────────────────────────>│
       │                                  │
       │                Compute shared secret
       │                Generate 6-digit code
       │                                  │
       │ pairing_response                 │
       │ {ephemeralPublicKey, salt}       │
       │<─────────────────────────────────│
       │                                  │
       │    [User confirms code matches]  │
       │                                  │
       │ pairing_confirm                  │
       │ {confirmed: true}                │
       │─────────────────────────────────>│
       │                                  │
       │ pairing_success                  │
       │<─────────────────────────────────│
       │                                  │
```

## Hardware Design

See `docs/hardware-design.md` for:
- ESP32-WROOM-32D based smart switch
- Relay module (5V, opto-isolated)
- PCB layout and BOM
- Assembly instructions

## Security Design

See `docs/security-design.md` for:
- ECDH pairing details
- AES-256-GCM encryption
- Replay attack protection
- Production security recommendations

## Software Design

See `docs/software-design.md` for:
- Architecture diagrams
- Communication protocol
- API specifications
- Data structures

## Firmware

See `firmware/esp32_switch/esp32_switch.ino` for:
- ESP32 Arduino firmware
- ECDH key generation
- AES-256-GCM encryption
- WiFi SmartConfig provisioning

## License

MIT
