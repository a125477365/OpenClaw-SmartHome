' OpenClaw Smart Switch - Altium Designer Script
' This script creates the schematic and PCB layout
' Run in Altium Designer: Tools -> Run Script

Sub CreateOpenClawSmartSwitch()
    Dim SchDoc
    Dim PcbDoc
    Dim Comp
    
    ' Create Schematic
    Set SchDoc = CreateSchematicDocument("OpenClaw-SmartSwitch.SchDoc")
    
    ' Add ESP32 Component
    Set Comp = SchDoc.AddComponent("ESP32-WROOM-32D")
    Comp.x = 2000
    Comp.y = 3000
    Comp.Designator = "U1"
    Comp.Comment = "ESP32-WROOM-32D"
    
    ' Add HLK-PM01 Power Module
    Set Comp = SchDoc.AddComponent("HLK-PM01")
    Comp.x = 4000
    Comp.y = 2000
    Comp.Designator = "U2"
    Comp.Comment = "HLK-PM01"
    
    ' Add Relay SRD-05VDC-SL-C
    Set Comp = SchDoc.AddComponent("Relay_SPST")
    Comp.x = 4000
    Comp.y = 4500
    Comp.Designator = "K1"
    Comp.Comment = "SRD-05VDC-SL-C (NC)"
    
    ' Add WS2812B LED
    Set Comp = SchDoc.AddComponent("LED_WS2812B")
    Comp.x = 2500
    Comp.y = 1500
    Comp.Designator = "D1"
    Comp.Comment = "WS2812B"
    
    ' Add S8050 Transistor
    Set Comp = SchDoc.AddComponent("Transistor_NPN_TO92")
    Comp.x = 3000
    Comp.y = 4000
    Comp.Designator = "Q1"
    Comp.Comment = "S8050"
    
    ' Add 1N4007 Diode
    Set Comp = SchDoc.AddComponent("Diode_DO41")
    Comp.x = 3500
    Comp.y = 4500
    Comp.Designator = "D2"
    Comp.Comment = "1N4007"
    
    ' Add Capacitors
    Set Comp = SchDoc.AddComponent("Capacitor_Electrolytic")
    Comp.x = 2500
    Comp.y = 2500
    Comp.Designator = "C1"
    Comp.Comment = "100uF/10V"
    
    Set Comp = SchDoc.AddComponent("Capacitor_Ceramic")
    Comp.x = 2800
    Comp.y = 2500
    Comp.Designator = "C2"
    Comp.Comment = "0.1uF"
    
    ' Add Resistors
    Set Comp = SchDoc.AddComponent("Resistor_Axial")
    Comp.x = 2700
    Comp.y = 3500
    Comp.Designator = "R1"
    Comp.Comment = "1K"
    
    Set Comp = SchDoc.AddComponent("Resistor_Axial")
    Comp.x = 2200
    Comp.y = 2000
    Comp.Designator = "R2"
    Comp.Comment = "10K"
    
    ' Add Button
    Set Comp = SchDoc.AddComponent("Switch_Tactile_6mm")
    Comp.x = 2500
    Comp.y = 5000
    Comp.Designator = "SW1"
    Comp.Comment = "Config Button"
    
    ' Add Terminal Blocks
    Set Comp = SchDoc.AddComponent("Terminal_Block_2P")
    Comp.x = 5000
    Comp.y = 1500
    Comp.Designator = "J1"
    Comp.Comment = "L/N"
    
    Set Comp = SchDoc.AddComponent("Terminal_Block_2P")
    Comp.x = 5000
    Comp.y = 5500
    Comp.Designator = "J2"
    Comp.Comment = "COM/SW"
    
    ' Add Wires
    Call SchDoc.AddWire("Net+5V", 2500, 2000, 4000, 2000)
    Call SchDoc.AddWire("NetGND", 2500, 2200, 4000, 2200)
    Call SchDoc.AddWire("NetGPIO12", 2000, 3500, 2700, 3500)
    Call SchDoc.AddWire("NetGPIO13", 2000, 3700, 2200, 2000)
    Call SchDoc.AddWire("NetGPIO14", 2000, 3900, 2500, 1500)
    
    ' Add Power Ports
    Call SchDoc.AddPowerPort("+5V", 2500, 2000)
    Call SchDoc.AddPowerPort("GND", 2500, 2200)
    
    ' Save Schematic
    SchDoc.Save
    
    ' Create PCB
    Set PcbDoc = CreatePCBDocument("OpenClaw-SmartSwitch.PcbDoc")
    
    ' Set Board Size (86mm x 86mm)
    PcbDoc.BoardOutline.AddSegment 0, 0, 86, 0, 0.2
    PcbDoc.BoardOutline.AddSegment 86, 0, 86, 86, 0.2
    PcbDoc.BoardOutline.AddSegment 86, 86, 0, 86, 0.2
    PcbDoc.BoardOutline.AddSegment 0, 86, 0, 0, 0.2
    
    ' Add Mounting Holes (60.3mm spacing)
    PcbDoc.AddMountingHole 13, 13, 4
    PcbDoc.AddMountingHole 73, 13, 4
    PcbDoc.AddMountingHole 13, 73, 4
    PcbDoc.AddMountingHole 73, 73, 4
    
    ' Place Components
    ' Weak Electrical Area (Left side)
    PcbDoc.PlaceComponent "U1", 25, 45, 0  ' ESP32
    PcbDoc.PlaceComponent "D1", 25, 15, 0  ' LED
    PcbDoc.PlaceComponent "SW1", 25, 70, 0 ' Button
    PcbDoc.PlaceComponent "C1", 35, 30, 0  ' Capacitor
    PcbDoc.PlaceComponent "R2", 30, 25, 90 ' Pull-up Resistor
    
    ' Strong Electrical Area (Right side)
    PcbDoc.PlaceComponent "U2", 65, 20, 0  ' Power Module
    PcbDoc.PlaceComponent "K1", 65, 55, 0  ' Relay
    PcbDoc.PlaceComponent "Q1", 45, 60, 180 ' Transistor
    PcbDoc.PlaceComponent "D2", 55, 60, 90  ' Diode
    PcbDoc.PlaceComponent "J1", 65, 75, 180 ' Terminal L/N/COM
    PcbDoc.PlaceComponent "J2", 65, 10, 0  ' Terminal SW
    
    ' Add Strong-Weak Separation Line
    PcbDoc.AddMechanicalLine 45, 0, 45, 86, "Dwgs.User"
    
    ' Add Keep-out Zone
    PcbDoc.AddKeepOutZone 0, 0, 45, 86, "High Voltage"
    
    ' Save PCB
    PcbDoc.Save
    
    MsgBox "OpenClaw Smart Switch project created successfully!"
    
End Sub

Function CreateSchematicDocument(DocName)
    ' Create and return a new schematic document
    Set CreateSchematicDocument = SchServer.AddSchDocument(DocName)
End Function

Function CreatePCBDocument(DocName)
    ' Create and return a new PCB document
    Set CreatePCBDocument = PCBServer.AddPCBDocument(DocName)
End Function
