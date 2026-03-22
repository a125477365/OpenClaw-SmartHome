/*
 * ESP32 Smart Switch Firmware with WiFi Provisioning
 * 
 * WiFi Provisioning Flow:
 * 1. Device starts in AP mode (access point)
 * 2. User connects to device's WiFi (e.g., "OpenClaw-SmartSwitch-XXXX")
 * 3. User opens web page (http://192.168.4.1)
 * 4. Device shows WiFi scan results
 * 5. User selects WiFi, enters password and OpenClaw server address
 * 6. Device connects to WiFi and tries to connect to OpenClaw
 * 7. On success, displays pairing code on web page
 * 8. After pairing confirmed, device saves config and restarts in STA-only mode
 * 
 * Normal Operation:
 * - On startup, if WiFi config exists, connects automatically
 * - No AP mode after first successful pairing
 * 
 * Reset to Provisioning Mode:
 * - Hold button for 5+ seconds to clear WiFi config and restart in AP mode
 */

#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <mbedtls/ecdh.h>
#include <mbedtls/ecp.h>
#include <mbedtls/entropy.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/gcm.h>
#include <mbedtls/sha256.h>
#include <mbedtls/base64.h>
#include <mbedtls/md.h>

// ------------------- Configuration -------------------
const char* AP_SSID_PREFIX = "OpenClaw-SmartSwitch";
const char* AP_PASSWORD = "12345678";
const uint16_t TCP_PORT = 8080;
const uint8_t RELAY_PIN = 12;
const uint8_t LED_PIN = 14;
const uint8_t BUTTON_PIN = 13;
const unsigned long BUTTON_RESET_TIME = 5000;

// Preferences keys
Preferences preferences;
const char* PREF_WIFI_SSID = "wifi_ssid";
const char* PREF_WIFI_PASS = "wifi_pass";
const char* PREF_OPENCLAW_HOST = "ocl_host";
const char* PREF_OPENCLAW_PORT = "ocl_port";
const char* PREF_PAIRED = "paired";

// State
WebServer* server = nullptr;
bool provisioningMode = true;
bool wifiConnected = false;
bool serverConnected = false;
bool pairingConfirmed = false;
String pairingCode = "";
String deviceName = "";
String openclawHost = "";
uint16_t openclawPort = 8080;

// EC key pair
mbedtls_ecp_keypair keypair;
mbedtls_entropy_context entropy;
mbedtls_ctr_drbg_context ctr_drbg;
bool keysInitialized = false;

// Session keys
uint8_t sessionKey[32];
uint8_t signKey[32];

// Relay state
bool relayState = false;

// Forward declarations
void setupProvisioningMode();
void setupNormalMode();
void handleNormalOperation();
void handleRoot();
void handleScan();
void handleConnect();
void handleStatus();
void handleConfirmPairing();
void handleControl();
void generateKeyPair();
bool loadKeyPair();
bool saveKeyPair();
String getDeviceAPName();
bool tryConnectToOpenClaw();
String generatePairingCode(String ephemeralPublicKeyB64, String saltB64);
void performECDH(uint8_t* peerPublicKey, size_t peerKeyLen, uint8_t* sharedSecret);
void switchToNormalMode();
void checkButtonReset();

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  digitalWrite(RELAY_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  // Initialize RNG
  mbedtls_entropy_init(&entropy);
  mbedtls_ctr_drbg_init(&ctr_drbg);
  mbedtls_ctr_drbg_seed(&ctr_drbg, mbedtls_entropy_func, &entropy, NULL, 0);

  // Generate or load EC key pair
  if (!loadKeyPair()) {
    generateKeyPair();
    saveKeyPair();
  }

  deviceName = getDeviceAPName();
  
  // Check if already paired
  preferences.begin("smartswitch", true);
  bool wasPaired = preferences.getBool(PREF_PAIRED, false);
  String savedSSID = preferences.getString(PREF_WIFI_SSID, "");
  String savedPass = preferences.getString(PREF_WIFI_PASS, "");
  openclawHost = preferences.getString(PREF_OPENCLAW_HOST, "");
  openclawPort = preferences.getUShort(PREF_OPENCLAW_PORT, 8080);
  preferences.end();

  if (wasPaired && savedSSID.length() > 0) {
    // Already paired, try to connect to WiFi
    Serial.println("Already paired, connecting to WiFi...");
    WiFi.mode(WIFI_STA);
    WiFi.begin(savedSSID.c_str(), savedPass.c_str());
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
      delay(500);
      Serial.print(".");
      attempts++;
      // Check for reset button during connection
      if (digitalRead(BUTTON_PIN) == LOW) {
        delay(50);
        if (digitalRead(BUTTON_PIN) == LOW) {
          // Button held, wait for reset
          unsigned long pressStart = millis();
          while (digitalRead(BUTTON_PIN) == LOW && millis() - pressStart < BUTTON_RESET_TIME) {
            delay(10);
          }
          if (millis() - pressStart >= BUTTON_RESET_TIME) {
            // Clear config and restart
            preferences.begin("smartswitch", false);
            preferences.clear();
            preferences.end();
            Serial.println("Config cleared, restarting...");
            ESP.restart();
          }
        }
      }
    }
    
    if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
      provisioningMode = false;
      Serial.println("\nWiFi connected!");
      Serial.print("IP: ");
      Serial.println(WiFi.localIP());
      digitalWrite(LED_PIN, HIGH);
      setupNormalMode();
    } else {
      Serial.println("\nWiFi connection failed, entering provisioning mode");
      provisioningMode = true;
      setupProvisioningMode();
    }
  } else {
    // Not paired, enter provisioning mode
    Serial.println("Not paired, entering provisioning mode");
    provisioningMode = true;
    setupProvisioningMode();
  }
}

void loop() {
  if (provisioningMode) {
    if (server) {
      server->handleClient();
    }
    checkButtonReset();
    
    // If pairing confirmed, save config and switch to normal mode
    if (pairingConfirmed && wifiConnected && serverConnected) {
      delay(1000); // Give time for final response
      switchToNormalMode();
    }
  } else {
    handleNormalOperation();
  }
}

// ------------------- Provisioning Mode -------------------
void setupProvisioningMode() {
  Serial.println("\n=== Provisioning Mode ===");
  
  // Start AP mode
  WiFi.mode(WIFI_AP);
  WiFi.softAP(deviceName.c_str(), AP_PASSWORD);
  
  Serial.print("AP Name: ");
  Serial.println(deviceName);
  Serial.print("AP Password: ");
  Serial.println(AP_PASSWORD);
  Serial.println("Connect and open: http://192.168.4.1");
  Serial.println("==========================\n");
  
  // Setup web server
  server = new WebServer(80);
  server->on("/", handleRoot);
  server->on("/scan", handleScan);
  server->on("/connect", HTTP_POST, handleConnect);
  server->on("/status", handleStatus);
  server->on("/confirm", HTTP_POST, handleConfirmPairing);
  server->on("/control", handleControl);
  server->begin();
  
  // Blink LED to indicate provisioning mode
  digitalWrite(LED_PIN, HIGH);
}

void handleRoot() {
  String html = R"(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenClaw 智能开关配网</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
           background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
           min-height: 100vh; padding: 20px; }
    .container { max-width: 500px; margin: 0 auto; }
    .card { background: white; border-radius: 16px; padding: 24px; margin-bottom: 20px; 
            box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
    h1 { color: #333; margin-bottom: 8px; font-size: 24px; }
    h2 { color: #555; margin-bottom: 16px; font-size: 18px; }
    .subtitle { color: #888; margin-bottom: 24px; }
    .step { display: flex; align-items: center; margin-bottom: 20px; }
    .step-num { width: 32px; height: 32px; background: #667eea; color: white; 
                border-radius: 50%; display: flex; align-items: center; 
                justify-content: center; margin-right: 12px; font-weight: bold; }
    .form-group { margin-bottom: 16px; }
    label { display: block; margin-bottom: 8px; color: #555; font-weight: 500; }
    select, input[type="text"], input[type="password"], input[type="number"] { 
      width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; 
      font-size: 16px; transition: border-color 0.3s; }
    select:focus, input:focus { border-color: #667eea; outline: none; }
    .wifi-list { max-height: 200px; overflow-y: auto; border: 2px solid #e0e0e0; 
                 border-radius: 8px; margin-bottom: 16px; }
    .wifi-item { padding: 12px 16px; border-bottom: 1px solid #eee; cursor: pointer; 
                 display: flex; justify-content: space-between; align-items: center; }
    .wifi-item:hover { background: #f5f5f5; }
    .wifi-item.selected { background: #e8f5e9; }
    .wifi-name { font-weight: 500; }
    .wifi-rssi { color: #888; font-size: 14px; }
    button { width: 100%; padding: 14px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
             color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; 
             cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
    button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(102,126,234,0.4); }
    button:disabled { background: #ccc; cursor: not-allowed; transform: none; box-shadow: none; }
    .loading { text-align: center; padding: 20px; }
    .spinner { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #667eea; 
               border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .success { background: #e8f5e9; color: #2e7d32; padding: 16px; border-radius: 8px; text-align: center; }
    .error { background: #ffebee; color: #c62828; padding: 16px; border-radius: 8px; text-align: center; }
    .pairing-code { font-size: 48px; font-weight: bold; letter-spacing: 8px; 
                    color: #667eea; text-align: center; margin: 20px 0; font-family: monospace; }
    .info-box { background: #e3f2fd; padding: 16px; border-radius: 8px; margin-top: 16px; }
    .info-box p { color: #1565c0; margin: 8px 0; }
    #step2, #step3, #status { display: none; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>🔌 OpenClaw 智能开关</h1>
      <p class="subtitle" id="deviceName">设备: Loading...</p>
      
      <div id="step1">
        <div class="step"><div class="step-num">1</div><h2>选择 WiFi 网络</h2></div>
        <div class="wifi-list" id="wifiList">
          <div class="loading"><div class="spinner"></div><p>正在扫描 WiFi...</p></div>
        </div>
        <button onclick="scanWiFi()">🔄 刷新列表</button>
      </div>
      
      <div id="step2">
        <div class="step"><div class="step-num">2</div><h2>输入 WiFi 密码</h2></div>
        <p id="selectedWifi" style="margin-bottom:16px;color:#666;"></p>
        <div class="form-group">
          <label for="wifiPassword">WiFi 密码</label>
          <input type="password" id="wifiPassword" placeholder="请输入 WiFi 密码">
        </div>
        <button onclick="showStep3()">下一步</button>
      </div>
      
      <div id="step3">
        <div class="step"><div class="step-num">3</div><h2>输入 OpenClaw 服务器地址</h2></div>
        <div class="form-group">
          <label for="serverHost">服务器地址</label>
          <input type="text" id="serverHost" placeholder="例如: 192.168.1.100 或 your.domain.com">
        </div>
        <div class="form-group">
          <label for="serverPort">服务器端口</label>
          <input type="number" id="serverPort" value="8080" placeholder="默认: 8080">
        </div>
        <button onclick="startConnect()">连接并配对</button>
      </div>
      
      <div id="status">
        <div id="connectingStatus">
          <div class="loading">
            <div class="spinner"></div>
            <p id="statusText">正在连接...</p>
          </div>
        </div>
        <div id="successStatus" class="hidden">
          <div class="success">
            <p>✅ 网络对接成功！</p>
          </div>
          <div class="info-box">
            <p>📱 请将以下配对码提供给 OpenClaw 完成配对：</p>
            <div class="pairing-code" id="pairingCode">------</div>
            <p style="font-size:14px;color:#888;margin-top:12px;">
              在 OpenClaw 中使用 device.pairing.confirm 工具，输入此配对码完成配对
            </p>
          </div>
          <button onclick="confirmPairing()" style="margin-top:16px;" id="confirmBtn">
            ✅ 已完成配对，重启设备
          </button>
        </div>
        <div id="errorStatus" class="hidden">
          <div class="error">
            <p id="errorText">连接失败</p>
          </div>
          <button onclick="resetToStep1()" style="margin-top:16px;">重新开始</button>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    let selectedSSID = '';
    const deviceName = ')"+deviceName+R"(';
    document.getElementById('deviceName').textContent = '设备: ' + deviceName;
    
    function scanWiFi() {
      document.getElementById('wifiList').innerHTML = '<div class="loading"><div class="spinner"></div><p>正在扫描 WiFi...</p></div>';
      fetch('/scan')
        .then(r => r.json())
        .then(data => {
          let html = '';
          if (data.networks && data.networks.length > 0) {
            data.networks.sort((a, b) => b.rssi - a.rssi).forEach(net => {
              const signal = getSignalBars(net.rssi);
              html += '<div class="wifi-item" onclick="selectWifi(\'' + net.ssid + '\', this)">';
              html += '<span class="wifi-name">' + net.ssid + '</span>';
              html += '<span class="wifi-rssi">' + signal + ' ' + net.rssi + 'dBm</span>';
              html += '</div>';
            });
          } else {
            html = '<p style="padding:16px;color:#888;">未找到 WiFi 网络</p>';
          }
          document.getElementById('wifiList').innerHTML = html;
        })
        .catch(e => {
          document.getElementById('wifiList').innerHTML = '<p style="padding:16px;color:#c62828;">扫描失败: ' + e + '</p>';
        });
    }
    
    function getSignalBars(rssi) {
      if (rssi > -50) return '▂▄▆█';
      if (rssi > -60) return '▂▄▆';
      if (rssi > -70) return '▂▄';
      return '▂';
    }
    
    function selectWifi(ssid, el) {
      selectedSSID = ssid;
      document.querySelectorAll('.wifi-item').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      document.getElementById('selectedWifi').textContent = '已选择: ' + ssid;
      document.getElementById('step1').style.display = 'none';
      document.getElementById('step2').style.display = 'block';
    }
    
    function showStep3() {
      document.getElementById('step2').style.display = 'none';
      document.getElementById('step3').style.display = 'block';
    }
    
    function startConnect() {
      const password = document.getElementById('wifiPassword').value;
      const host = document.getElementById('serverHost').value;
      const port = document.getElementById('serverPort').value;
      
      if (!password || !host) {
        alert('请填写所有必填项');
        return;
      }
      
      document.getElementById('step3').style.display = 'none';
      document.getElementById('status').style.display = 'block';
      
      fetch('/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ssid: selectedSSID,
          password: password,
          host: host,
          port: parseInt(port)
        })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          checkStatus();
        } else {
          showError(data.error || '连接失败');
        }
      })
      .catch(e => showError(e.toString()));
    }
    
    let statusCheckCount = 0;
    function checkStatus() {
      fetch('/status')
        .then(r => r.json())
        .then(data => {
          statusCheckCount++;
          if (data.wifi && data.server && data.pairingCode) {
            document.getElementById('connectingStatus').classList.add('hidden');
            document.getElementById('successStatus').classList.remove('hidden');
            document.getElementById('pairingCode').textContent = data.pairingCode;
          } else if (data.error) {
            showError(data.error);
          } else if (statusCheckCount < 60) {
            document.getElementById('statusText').textContent = data.status || '连接中...';
            setTimeout(checkStatus, 1000);
          } else {
            showError('连接超时');
          }
        })
        .catch(e => {
          statusCheckCount++;
          if (statusCheckCount < 60) {
            setTimeout(checkStatus, 1000);
          } else {
            showError('连接超时');
          }
        });
    }
    
    function confirmPairing() {
      fetch('/confirm', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            document.getElementById('confirmBtn').textContent = '重启中...';
            document.getElementById('confirmBtn').disabled = true;
          }
        });
    }
    
    function showError(msg) {
      document.getElementById('connectingStatus').classList.add('hidden');
      document.getElementById('errorStatus').classList.remove('hidden');
      document.getElementById('errorText').textContent = msg;
    }
    
    function resetToStep1() {
      document.getElementById('status').style.display = 'none';
      document.getElementById('successStatus').classList.add('hidden');
      document.getElementById('errorStatus').classList.add('hidden');
      document.getElementById('connectingStatus').classList.remove('hidden');
      document.getElementById('step1').style.display = 'block';
      statusCheckCount = 0;
      scanWiFi();
    }
    
    // Start scan on load
    scanWiFi();
  </script>
</body>
</html>
  )";
  
  server->send(200, "text/html", html);
}

void handleScan() {
  int n = WiFi.scanNetworks();
  DynamicJsonDocument doc(2048);
  JsonArray networks = doc.createNestedArray("networks");
  
  for (int i = 0; i < n; i++) {
    JsonObject net = networks.createNestedObject();
    net["ssid"] = WiFi.SSID(i);
    net["rssi"] = WiFi.RSSI(i);
    net["encryption"] = WiFi.encryptionType(i);
  }
  
  String response;
  serializeJson(doc, response);
  server->send(200, "application/json", response);
}

void handleConnect() {
  if (!server->hasArg("plain")) {
    server->send(400, "application/json", "{\"success\":false,\"error\":\"No data\"}");
    return;
  }
  
  DynamicJsonDocument doc(512);
  deserializeJson(doc, server->arg("plain"));
  
  String ssid = doc["ssid"].as<String>();
  String password = doc["password"].as<String>();
  openclawHost = doc["host"].as<String>();
  openclawPort = doc["port"].as<uint16_t>();
  
  // Save config
  preferences.begin("smartswitch", false);
  preferences.putString(PREF_WIFI_SSID, ssid);
  preferences.putString(PREF_WIFI_PASS, password);
  preferences.putString(PREF_OPENCLAW_HOST, openclawHost);
  preferences.putUShort(PREF_OPENCLAW_PORT, openclawPort);
  preferences.end();
  
  // Switch to AP+STA mode and connect
  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(ssid.c_str(), password.c_str());
  
  server->send(200, "application/json", "{\"success\":true}");
}

void handleStatus() {
  DynamicJsonDocument doc(256);
  
  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    doc["wifi"] = true;
    doc["ip"] = WiFi.localIP().toString();
    
    if (!serverConnected) {
      if (tryConnectToOpenClaw()) {
        serverConnected = true;
        doc["server"] = true;
        doc["pairingCode"] = pairingCode;
      } else {
        doc["server"] = false;
        doc["status"] = "正在连接服务器...";
      }
    } else {
      doc["server"] = true;
      doc["pairingCode"] = pairingCode;
    }
  } else {
    doc["wifi"] = false;
    doc["status"] = "正在连接WiFi...";
  }
  
  String response;
  serializeJson(doc, response);
  server->send(200, "application/json", response);
}

void handleConfirmPairing() {
  pairingConfirmed = true;
  server->send(200, "application/json", "{\"success\":true}");
}

bool tryConnectToOpenClaw() {
  WiFiClient client;
  
  Serial.print("Connecting to OpenClaw: ");
  Serial.print(openclawHost);
  Serial.print(":");
  Serial.println(openclawPort);
  
  if (!client.connect(openclawHost.c_str(), openclawPort, 10000)) {
    Serial.println("Server connection failed");
    return false;
  }
  
  // Send pairing request
  DynamicJsonDocument req(512);
  req["type"] = "pairing_request";
  req["deviceId"] = WiFi.macAddress();
  req["name"] = deviceName;
  
  // Get our public key
  uint8_t publicKeyBuf[128];
  size_t publicKeyLen = 0;
  mbedtls_ecp_group grp;
  mbedtls_ecp_group_init(&grp);
  mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1);
  mbedtls_ecp_point Q;
  mbedtls_ecp_point_init(&Q);
  mbedtls_ecp_copy(&Q, &keypair.Q);
  mbedtls_ecp_point_write_binary(&grp, &Q, MBEDTLS_ECP_PF_UNCOMPRESSED, &publicKeyLen, publicKeyBuf, sizeof(publicKeyBuf));
  
  // Base64 encode public key
  size_t b64Len = 0;
  mbedtls_base64_encode(NULL, 0, &b64Len, publicKeyBuf, publicKeyLen);
  char* publicKeyB64 = (char*)malloc(b64Len + 1);
  mbedtls_base64_encode((unsigned char*)publicKeyB64, b64Len, &b64Len, publicKeyBuf, publicKeyLen);
  publicKeyB64[b64Len] = '\0';
  
  req["publicKey"] = publicKeyB64;
  
  String request;
  serializeJson(req, request);
  request += "\n";
  
  client.print(request);
  
  // Wait for response
  unsigned long startTime = millis();
  while (!client.available() && millis() - startTime < 10000) {
    delay(10);
  }
  
  if (client.available()) {
    String response = client.readStringUntil('\n');
    DynamicJsonDocument resp(512);
    deserializeJson(resp, response);
    
    if (resp["type"] == "pairing_response") {
      pairingCode = generatePairingCode(resp["ephemeralPublicKey"].as<String>(), 
                                        resp["salt"].as<String>());
      Serial.println("Pairing code generated: " + pairingCode);
      free(publicKeyB64);
      client.stop();
      return true;
    }
  }
  
  free(publicKeyB64);
  client.stop();
  return false;
}

String generatePairingCode(String ephemeralPublicKeyB64, String saltB64) {
  size_t ephKeyLen = ephemeralPublicKeyB64.length();
  uint8_t* ephemeralPublicKey = (uint8_t*)malloc(ephKeyLen);
  size_t decodedLen = 0;
  mbedtls_base64_decode(ephemeralPublicKey, ephKeyLen, &decodedLen, 
                        (const unsigned char*)ephemeralPublicKeyB64.c_str(), 
                        ephemeralPublicKeyB64.length());
  
  uint8_t sharedSecret[32];
  performECDH(ephemeralPublicKey, decodedLen, sharedSecret);
  
  uint8_t saltBytes[16];
  mbedtls_base64_decode(saltBytes, sizeof(saltBytes), &decodedLen,
                        (const unsigned char*)saltB64.c_str(),
                        saltB64.length());
  
  uint8_t confirmHash[32];
  mbedtls_sha256_context shaCtx;
  mbedtls_sha256_init(&shaCtx);
  mbedtls_sha256_starts(&shaCtx, 0);
  mbedtls_sha256_update(&shaCtx, sharedSecret, 32);
  mbedtls_sha256_update(&shaCtx, saltBytes, sizeof(saltBytes));
  mbedtls_sha256_finish(&shaCtx, confirmHash);
  mbedtls_sha256_free(&shaCtx);
  
  uint32_t code = (confirmHash[0] << 16 | confirmHash[1] << 8 | confirmHash[2]) % 1000000;
  
  free(ephemeralPublicKey);
  
  char codeStr[7];
  sprintf(codeStr, "%06u", code);
  return String(codeStr);
}

void handleControl() {
  DynamicJsonDocument doc(128);
  doc["success"] = false;
  doc["error"] = "Not implemented in provisioning mode";
  String response;
  serializeJson(doc, response);
  server->send(200, "application/json", response);
}

void switchToNormalMode() {
  Serial.println("Pairing complete, saving config and restarting...");
  
  // Save paired status
  preferences.begin("smartswitch", false);
  preferences.putBool(PREF_PAIRED, true);
  preferences.end();
  
  // Stop server
  if (server) {
    server->stop();
    delete server;
    server = nullptr;
  }
  
  // Turn off AP
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  
  // Restart
  ESP.restart();
}

void checkButtonReset() {
  static unsigned long pressStartTime = 0;
  static bool buttonPressed = false;
  
  if (digitalRead(BUTTON_PIN) == LOW) {
    if (!buttonPressed) {
      buttonPressed = true;
      pressStartTime = millis();
    } else if (millis() - pressStartTime >= BUTTON_RESET_TIME) {
      Serial.println("Button held, clearing config...");
      preferences.begin("smartswitch", false);
      preferences.clear();
      preferences.end();
      ESP.restart();
    }
  } else {
    buttonPressed = false;
    pressStartTime = 0;
  }
}

// ------------------- Normal Operation Mode -------------------
void setupNormalMode() {
  Serial.println("Entering normal operation mode");
  
  // Start TCP server for commands
  // (existing normal operation code)
}

void handleNormalOperation() {
  // Handle commands from OpenClaw
  // (existing normal operation code)
}

// ------------------- Utility Functions -------------------
String getDeviceAPName() {
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  mac = mac.substring(mac.length() - 4);
  return String(AP_SSID_PREFIX) + "-" + mac;
}

void generateKeyPair() {
  mbedtls_ecp_keypair_init(&keypair);
  mbedtls_ecp_group_init(&keypair.grp);
  mbedtls_ecp_group_load(&keypair.grp, MBEDTLS_ECP_DP_SECP256R1);
  mbedtls_mpi_init(&keypair.d);
  mbedtls_ecp_point_init(&keypair.Q);
  mbedtls_ecp_gen_keypair(&keypair.grp, &keypair.d, &keypair.Q, 
                          mbedtls_ctr_drbg_random, &ctr_drbg);
  keysInitialized = true;
  Serial.println("EC key pair generated");
}

bool loadKeyPair() {
  // In production, load from preferences/NVS
  return false;
}

bool saveKeyPair() {
  // In production, save to preferences/NVS
  return true;
}

void performECDH(uint8_t* peerPublicKey, size_t peerKeyLen, uint8_t* sharedSecret) {
  mbedtls_ecp_group grp;
  mbedtls_ecp_group_init(&grp);
  mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1);
  
  mbedtls_ecp_point peerQ;
  mbedtls_ecp_point_init(&peerQ);
  mbedtls_ecp_point_read_binary(&grp, &peerQ, peerPublicKey, peerKeyLen);
  
  mbedtls_mpi sharedSecretMPI;
  mbedtls_mpi_init(&sharedSecretMPI);
  mbedtls_ecdh_compute_shared(&grp, &sharedSecretMPI, &peerQ, &keypair.d,
                              mbedtls_ctr_drbg_random, &ctr_drbg);
  
  mbedtls_mpi_write_binary(&sharedSecretMPI, sharedSecret, 32);
  
  mbedtls_ecp_point_free(&peerQ);
  mbedtls_mpi_free(&sharedSecretMPI);
  mbedtls_ecp_group_free(&grp);
}
