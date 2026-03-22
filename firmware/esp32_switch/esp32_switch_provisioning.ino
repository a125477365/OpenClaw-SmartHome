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
 * 
 * Features:
 * - WiFi scan with signal strength
 * - Web-based configuration interface
 * - OpenClaw server connection test
 * - Pairing code display after successful connection
 */

#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
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
const char* AP_PASSWORD = "12345678";  // Default AP password
const uint16_t TCP_PORT = 8080;
const uint8_t RELAY_PIN = 12;
const uint8_t LED_PIN = 14;
const uint8_t BUTTON_PIN = 13;

// State
WebServer server(80);
bool provisioningMode = true;
bool wifiConnected = false;
bool serverConnected = false;
String selectedSSID = "";
String selectedPassword = "";
String openclawHost = "";
uint16_t openclawPort = 0;
String pairingCode = "";
String deviceName = "";

// EC key pair
mbedtls_ecp_keypair keypair;
mbedtls_entropy_context entropy;
mbedtls_ctr_drbg_context ctr_drbg;
bool keysInitialized = false;

// Session keys
uint8_t sessionKey[32];
uint8_t signKey[32];
bool pairingComplete = false;

// Relay state
bool relayState = false;

// Forward declarations
void setupProvisioningMode();
void handleRoot();
void handleScan();
void handleConnect();
void handleStatus();
void handlePairing();
void handleControl();
void generateKeyPair();
bool saveConfig();
bool loadConfig();
String getDeviceAPName();

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
  if (!loadConfig()) {
    generateKeyPair();
    saveConfig();
  }

  // Get device name
  deviceName = getDeviceAPName();
  
  // Try to load saved WiFi config
  if (loadWiFiConfig()) {
    WiFi.begin(savedSSID.c_str(), savedPassword.c_str());
    Serial.println("Attempting to connect to saved WiFi...");
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
      delay(500);
      Serial.print(".");
      attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
      Serial.println("\nWiFi connected!");
      Serial.print("IP: ");
      Serial.println(WiFi.localIP());
      provisioningMode = false;
      
      // Start normal operation mode
      setupNormalMode();
    }
  }

  // If not connected, start provisioning mode
  if (!wifiConnected) {
    provisioningMode = true;
    setupProvisioningMode();
  }
}

void loop() {
  if (provisioningMode) {
    server.handleClient();
  } else {
    handleNormalOperation();
  }
}

// ------------------- Provisioning Mode -------------------
void setupProvisioningMode() {
  // Start AP mode
  WiFi.mode(WIFI_AP);
  WiFi.softAP(deviceName.c_str(), AP_PASSWORD);
  
  Serial.println("\n=== Provisioning Mode ===");
  Serial.print("AP Name: ");
  Serial.println(deviceName);
  Serial.print("AP Password: ");
  Serial.println(AP_PASSWORD);
  Serial.print("Connect to: http://192.168.4.1");
  Serial.println("==========================\n");
  
  // Setup web server routes
  server.on("/", handleRoot);
  server.on("/scan", handleScan);
  server.on("/connect", HTTP_POST, handleConnect);
  server.on("/status", handleStatus);
  server.on("/pairing", handlePairing);
  server.on("/control", handleControl);
  
  server.begin();
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
    .signal { display: flex; align-items: center; gap: 2px; }
    .bar { width: 4px; background: #4CAF50; border-radius: 2px; }
    .bar:nth-child(1) { height: 8px; }
    .bar:nth-child(2) { height: 12px; }
    .bar:nth-child(3) { height: 16px; }
    .bar:nth-child(4) { height: 20px; }
    .bar.weak { background: #f44336; }
    .bar.medium { background: #ff9800; }
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
                    color: #667eea; text-align: center; margin: 20px 0; }
    .info-box { background: #e3f2fd; padding: 16px; border-radius: 8px; margin-top: 16px; }
    .info-box p { color: #1565c0; margin: 8px 0; }
    #status { display: none; }
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
      
      <div id="step2" style="display:none;">
        <div class="step"><div class="step-num">2</div><h2>输入 WiFi 密码</h2></div>
        <p id="selectedWifi" style="margin-bottom:16px;color:#666;"></p>
        <div class="form-group">
          <label for="wifiPassword">WiFi 密码</label>
          <input type="password" id="wifiPassword" placeholder="请输入 WiFi 密码">
        </div>
        <button onclick="showStep3()">下一步</button>
      </div>
      
      <div id="step3" style="display:none;">
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
      
      <div id="status" style="display:none;">
        <div class="loading" id="connectingStatus">
          <div class="spinner"></div>
          <p id="statusText">正在连接...</p>
        </div>
        <div id="successStatus" style="display:none;">
          <div class="success">
            <p>✅ 网络对接成功！</p>
          </div>
          <div class="info-box">
            <p>📱 请将以下配对码提供给 OpenClaw 完成配对：</p>
            <div class="pairing-code" id="pairingCode">------</div>
            <p style="font-size:14px;color:#888;margin-top:12px;">
              在 OpenClaw 中使用 device.pairing.start 工具，输入此配对码进行配对
            </p>
          </div>
        </div>
        <div id="errorStatus" style="display:none;">
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
          data.networks.sort((a, b) => b.rssi - a.rssi).forEach(net => {
            const signal = getSignalBars(net.rssi);
            html += '<div class="wifi-item" onclick="selectWifi(\'' + net.ssid + '\')">';
            html += '<span class="wifi-name">' + net.ssid + '</span>';
            html += '<span class="wifi-rssi">' + signal + ' ' + net.rssi + 'dBm</span>';
            html += '</div>';
          });
          document.getElementById('wifiList').innerHTML = html || '<p style="padding:16px;color:#888;">未找到 WiFi 网络</p>';
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
    
    function selectWifi(ssid) {
      selectedSSID = ssid;
      document.querySelectorAll('.wifi-item').forEach(el => el.classList.remove('selected'));
      event.target.closest('.wifi-item').classList.add('selected');
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
    
    function checkStatus() {
      fetch('/status')
        .then(r => r.json())
        .then(data => {
          if (data.wifi && data.server) {
            document.getElementById('connectingStatus').style.display = 'none';
            document.getElementById('successStatus').style.display = 'block';
            document.getElementById('pairingCode').textContent = data.pairingCode;
          } else if (data.error) {
            showError(data.error);
          } else {
            document.getElementById('statusText').textContent = data.status || '连接中...';
            setTimeout(checkStatus, 1000);
          }
        })
        .catch(e => setTimeout(checkStatus, 1000));
    }
    
    function showError(msg) {
      document.getElementById('connectingStatus').style.display = 'none';
      document.getElementById('errorStatus').style.display = 'block';
      document.getElementById('errorText').textContent = msg;
    }
    
    function resetToStep1() {
      document.getElementById('status').style.display = 'none';
      document.getElementById('step1').style.display = 'block';
      scanWiFi();
    }
    
    // Start scan on load
    scanWiFi();
  </script>
</body>
</html>
  )";
  
  server.send(200, "text/html", html);
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
  server.send(200, "application/json", response);
}

void handleConnect() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"success\":false,\"error\":\"No data\"}");
    return;
  }
  
  DynamicJsonDocument doc(512);
  deserializeJson(doc, server.arg("plain"));
  
  selectedSSID = doc["ssid"].as<String>();
  selectedPassword = doc["password"].as<String>();
  openclawHost = doc["host"].as<String>();
  openclawPort = doc["port"].as<uint16_t>();
  
  // Start connection in background
  server.send(200, "application/json", "{\"success\":true}");
  
  // Initiate connection
  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(selectedSSID.c_str(), selectedPassword.c_str());
}

void handleStatus() {
  DynamicJsonDocument doc(256);
  
  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    doc["wifi"] = true;
    doc["ip"] = WiFi.localIP().toString();
    
    // Try to connect to OpenClaw server
    if (!serverConnected) {
      if (tryConnectToServer()) {
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
  server.send(200, "application/json", response);
}

bool tryConnectToServer() {
  WiFiClient client;
  
  Serial.print("Connecting to ");
  Serial.print(openclawHost);
  Serial.print(":");
  Serial.println(openclawPort);
  
  if (!client.connect(openclawHost.c_str(), openclawPort, 5000)) {
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
      // Generate confirmation code
      pairingCode = generatePairingCode(resp["ephemeralPublicKey"].as<String>(), 
                                        resp["salt"].as<String>());
      
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
  // Decode ephemeral public key
  size_t ephKeyLen = strlen(ephemeralPublicKeyB64.c_str());
  uint8_t* ephemeralPublicKey = (uint8_t*)malloc(ephKeyLen);
  size_t decodedLen = 0;
  mbedtls_base64_decode(ephemeralPublicKey, ephKeyLen, &decodedLen, 
                        (const unsigned char*)ephemeralPublicKeyB64.c_str(), 
                        strlen(ephemeralPublicKeyB64.c_str()));
  
  // Perform ECDH
  uint8_t sharedSecret[32];
  performECDH(ephemeralPublicKey, decodedLen, sharedSecret);
  
  // Decode salt
  uint8_t saltBytes[16];
  mbedtls_base64_decode(saltBytes, sizeof(saltBytes), &decodedLen,
                        (const unsigned char*)saltB64.c_str(),
                        strlen(saltB64.c_str()));
  
  // Generate confirmation code
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

void handlePairing() {
  // Endpoint for checking pairing status
  DynamicJsonDocument doc(128);
  doc["pairingCode"] = pairingCode;
  doc["paired"] = pairingComplete;
  doc["deviceId"] = WiFi.macAddress();
  doc["ip"] = WiFi.localIP().toString();
  
  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

void handleControl() {
  // Control endpoint for testing
  DynamicJsonDocument doc(256);
  
  if (!pairingComplete) {
    doc["success"] = false;
    doc["error"] = "Not paired";
  } else {
    if (server.hasArg("plain")) {
      DynamicJsonDocument req(128);
      deserializeJson(req, server.arg("plain"));
      String action = req["action"];
      
      if (action == "on") {
        relayState = true;
        digitalWrite(RELAY_PIN, HIGH);
        doc["success"] = true;
        doc["state"] = "on";
      } else if (action == "off") {
        relayState = false;
        digitalWrite(RELAY_PIN, LOW);
        doc["success"] = true;
        doc["state"] = "off";
      } else if (action == "query") {
        doc["success"] = true;
        doc["state"] = relayState ? "on" : "off";
      } else {
        doc["success"] = false;
        doc["error"] = "Unknown action";
      }
    }
  }
  
  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

// ------------------- Normal Operation Mode -------------------
void setupNormalMode() {
  // Start TCP server
  // ... existing code for normal operation
}

void handleNormalOperation() {
  // ... existing code
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

bool saveConfig() {
  // Save to preferences/NVS
  return true;
}

bool loadConfig() {
  // Load from preferences/NVS
  return false;
}

bool loadWiFiConfig() {
  // Load WiFi credentials from preferences
  return false;
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
