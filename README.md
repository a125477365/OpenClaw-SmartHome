# OpenClaw Smart Home System

## Overview
This repository provides a complete design for a smart home system built on the OpenClaw platform. It consists of:
- 1 Skill: `HomeSkill` (container for plugins)
- 2 Plugins:
  1. `DeviceLinkPlugin` – handles device connection, control, encryption, and file watching
  2. `UIManagePlugin` – provides a web-based management interface
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
└── docs/
    ├── hardware-design.md
    └── software-design.md
```

## Hardware Design (ESP32 Smart Switch)
See `docs/hardware-design.md` for detailed schematic, BOM, and PCB layout guidance.

## Software Design
See `docs/software-design.md` for detailed plugin architecture, communication protocol, encryption, and API definitions.

## Quick Start
1. Clone this repository into your OpenClaw `Skills/` directory.
2. Ensure OpenClaw is running (gateway started).
3. OpenClaw will automatically load the `HomeSkill` and its plugins.
4. Use the UIManagePlugin web interface (default port configured in `UIManagePlugin/config.json`) to add devices (input device MAC/IP, authorize).
5. Once authorized, use the `device.control` tool via OpenClaw agent or CLI to control devices.

## Security
- All communication between OpenClaw and devices is encrypted using AES-256-CBC with HMAC-SHA256 signing.
- Devices are authorized via a one-time trust process: upon first connection, the device must be explicitly authorized via the `device.authorize` tool (or UI).
- Encryption keys are generated per device and stored in `devices.json`.

## License
MIT
