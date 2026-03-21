# OpenClaw Smart Home System

## Overview
This repository provides a complete design for a smart home system built on the OpenClaw platform. It consists of:
- 1 Skill: `HomeSkill` (container for plugins)
- 2 Plugins:
  1. `DeviceLinkPlugin` – handles device connection, control, encryption, and file watching
  2. `UIManagePlugin` – provides a web-based management interface (HTTPS with HTTP redirect)
- 1 Data file: `devices.json` – stores device info, state, and encryption keys
- Hardware design: ESP32-based smart switch

All code and documentation are in English.

## Directory Structure
```
OpenClaw-SmartHome/
├── README.md
├── Skills/
│   └── HomeSkill/
│       ├── openclaw.skill.json
│       ├── devices.json
│       ├── DeviceLinkPlugin/
│       │   ├── openclaw.plugin.json
│       │   ├── config.json
│       │   └── index.js
│       └── UIManagePlugin/
│           ├── openclaw.plugin.json
│           ├── config.json
│           ├── index.js
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

## Hardware Design (ESP32 Smart Switch)
See `docs/hardware-design.md` for detailed schematic, BOM, and PCB layout guidance.

## Security Design
See `docs/security-design.md` for details on anti-counterfeiting, anti-impersonation, and anti-hijacking measures.

## Software Design
See `docs/software-design.md` for detailed plugin architecture, communication protocol, encryption, and API definitions.

## Quick Start
1. Clone this repository into your OpenClaw `Skills/` directory.
2. Ensure OpenClaw is running (gateway started).
3. OpenClaw will automatically load the `HomeSkill` and its plugins.
4. The UIManagePlugin provides a web interface:
   - HTTP port 8082 automatically redirects to HTTPS port 8083
   - HTTPS port 8083 serves the management interface (self-signed certificate; browsers will show a warning that can be bypassed for local use)
5. Use the UI to add devices (input device MAC/IP, authorize).
6. Once authorized, use the `device.control` tool via OpenClaw agent or CLI to control devices.

## Security
- All communication between OpenClaw and devices is encrypted using AES-256-CBC with HMAC-SHA256 signing.
- Devices are authorized via a one-time trust process: upon first connection, the device must be explicitly authorized via the `device.authorize` tool (or UI).
- Encryption keys are generated per device and stored in `devices.json`.
- The UI is served over HTTPS to protect credentials in transit.

## License
MIT