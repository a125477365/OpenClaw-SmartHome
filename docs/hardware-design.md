# ESP32 Smart Switch Hardware Design

## Overview
This document details the hardware design for the ESP32-based smart switch used in the OpenClaw Smart Home system.

## Bill of Materials (BOM)

| Component | Model/Specification | Quantity | Function |
|-----------|---------------------|----------|----------|
| Main Controller | ESP32-WROOM-32D (with built-in MAC address) | 1 | WiFi connectivity, TCP communication, command execution |
| Relay Module | 5V Single Channel Relay Module (Opto-isolated) | 1 | Controls lamp on/off |
| Button | Tactile Push Button | 1 | Manual switch (physical trigger) |
| Indicator LED | Red/Green LED (3.3V) | 1 | Device status indication (network/online/offline) |
| Power Supply | 5V/1A Power Adapter (compatible with 85-265V AC) | 1 | Device power supply |
| Terminal Blocks | 2-in-2-out Terminal Blocks | 2 | Connect lamp live/neutral wires |
| PCB | Custom PCB (with MAC fixation, antenna interface) | 1 | Hardware carrier |

## Hardware Connection Diagram

```
ESP32 Pin ──── External Connection
- GPIO12 ──── Relay IN (controls lamp)
- GPIO13 ──── Button (pull-up input, low-level trigger)
- GPIO14 ──── LED positive (series with 220Ω resistor, negative to ground)
- GPIO21 ──── I2C SDA (reserved, for future expansion)
- GPIO22 ──── I2C SCL (reserved, for future expansion)
- 3.3V ──── External power supply (for button/LED/relay control)
- GND ──── Common ground (all external devices share ground)
- VCC ──── 5V power input
```

## Hardware Design Points

1. **MAC Address Fixation**: ESP32 has a built-in MAC address that cannot be modified during firmware flashing, used as the unique device ID (deviceId) for anti-counterfeiting.

2. **Relay Isolation**: Opto-isolated relay module prevents strong electrical interference to weak electrical circuits, ensuring device safety.

3. **Power Filtering**: Power input terminal connects in series with 1000μF electrolytic capacitor + 0.1μF ceramic capacitor to filter ripple.

4. **Status Indication**: LED constantly on = network successful/online, blinking = configuring network, off = offline/unauthorized.

## PCB Design Considerations

- Reserve space for antenna to ensure good WiFi signal reception
- Fix the ESP32 module's MAC address area on the PCB (can be laser etched or silk screened)
- Consider adding test points for debugging
- Design for proper creepage and clearance between high voltage (relay contacts) and low voltage (ESP32) sections
- Include proper grounding and filtering for EMC compliance

## Assembly Instructions

1. Solder all components onto the PCB according to the silkscreen markings
2. Ensure the relay module is properly oriented (note the coil voltage and contact ratings)
3. Connect the ESP32 module ensuring antenna area is not obstructed
4. Verify all connections with a multimeter before powering on
5. Enclose in appropriate housing with IP rating suitable for installation location

## Safety Certifications

- Ensure relay module has appropriate safety certifications (UL, CE, etc.) for target market
- Use flame-retardant PCB material (FR-4 minimum)
- Provide adequate insulation between line voltage and user-accessible parts