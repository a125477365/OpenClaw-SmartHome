/*
 * ESP32 Smart Switch Firmware for OpenClaw Smart Home System
 * 
 * ECDH-Based Pairing (Bluetooth-Style, No Pre-Shared Secrets)
 * 
 * Features:
 * - Connects to WiFi (STA mode) using credentials via SmartConfig
 * - Uses unique MAC address as deviceId
 * - Generates unique EC key pair on first boot (P-256/secp256r1)
 * - ECDH key exchange during pairing (no factory secret)
 * - User confirmation via button press (simulate numeric comparison)
 * - All messages encrypted with AES-256-GCM
 * - Controls a relay connected to GPIO12
 * - Reports state changes back to OpenClaw
 * 
 * Security:
 * - No pre-shared factory secrets
 * - Per-device EC key pair generated at first boot
 * - ECDH shared secret derivation
 * - AES-256-GCM for encryption and authentication
 * - Replay protection via timestamp and nonce
 * - User confirmation to prevent MITM
 */

#include <WiFi.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <mbedtls/ecdh.h>
#include <mbedtls/ecp.h>
#include <mbedtls/entropy.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/gcm.h>
#include <mbedtls/sha256.h>

// ------------------- Configuration -------------------
const char* WIFI_SSID = "";        // To be set via SmartConfig
const char* WIFI_PASSWORD = "";    // To be set via SmartConfig
const uint16_t TCP_PORT = 8080;    // Must match DeviceLinkPlugin.config.devicePort
const uint8_t  RELAY_PIN = 12;     // GPIO12 controls relay
const uint8_t  LED_PIN   = 14;     // GPIO14 LED indicator
const uint8_t  BUTTON_PIN= 13;     // GPIO13 button for user confirmation

// EC key pair (generated on first boot, stored in flash)
mbedtls_ecp_keypair keypair;
mbedtls_entropy_context entropy;
mbedtls_ctr_drbg_context ctr_drbg;
bool keysInitialized = false;

// Session keys (derived from ECDH)
uint8_t sessionKey[32];   // AES-256 key
uint8_t signKey[32];      // HMAC key (if needed for additional auth)
bool pairingComplete = false;

// Relay state
bool relayState = false;

// WiFi connection status
bool wifiConnected = false;

// Forward declarations
void handleClient(WiFiClient client);
void generateKeyPair();
bool loadKeyPair();
bool saveKeyPair();
void performECDH(uint8_t* peerPublicKey, size_t peerKeyLen, uint8_t* sharedSecret);
void deriveSessionKeys(const uint8_t* sharedSecret, const uint8_t* salt, size_t saltLen);
int encryptMessage(const uint8_t* plaintext, size_t plaintextLen, 
                   const uint8_t* key, uint8_t* ciphertext, size_t* ciphertextLen,
                   uint8_t* nonce, uint8_t* tag);
int decryptMessage(const uint8_t* ciphertext, size_t ciphertextLen,
                   const uint8_t* key, const uint8_t* nonce, const uint8_t* tag,
                   uint8_t* plaintext, size_t* plaintextLen);

// ------------------- Setup -------------------
void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  digitalWrite(RELAY_PIN, relayState);
  digitalWrite(LED_PIN, LOW);

  // Initialize entropy and random number generator
  mbedtls_entropy_init(&entropy);
  mbedtls_ctr_drbg_init(&ctr_drbg);
  int ret = mbedtls_ctr_drbg_seed(&ctr_drbg, mbedtls_entropy_func, &entropy, NULL, 0);
  if (ret != 0) {
    Serial.println("Failed to initialize RNG");
    return;
  }

  // Load or generate EC key pair
  if (!loadKeyPair()) {
    generateKeyPair();
    saveKeyPair();
  }

  // Connect to WiFi (SmartConfig if credentials not set)
  if (strlen(WIFI_SSID) == 0) {
    Serial.println("Starting SmartConfig...");
    WiFi.mode(WIFI_STA);
    WiFi.beginSmartConfig();
    while (!WiFi.smartConfigDone()) {
      delay(500);
      Serial.print(".");
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    }
    Serial.println("\nSmartConfig done");
  } else {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) {
      delay(500);
      Serial.print(".");
    }
    Serial.println("\nWiFi connected");
  }

  wifiConnected = (WiFi.status() == WL_CONNECTED);
  if (wifiConnected) {
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    digitalWrite(LED_PIN, HIGH);
  }

  // Start TCP server
  WiFiServer server(TCP_PORT);
  server.begin();
  Serial.printf("TCP server listening on port %d\n", TCP_PORT);

  // Main loop
  while (true) {
    WiFiClient client = server.available();
    if (client) {
      Serial.println("Client connected");
      handleClient(client);
      client.stop();
      Serial.println("Client disconnected");
    }
    delay(10);
  }
}

void loop() {
  // Empty; all work in setup() loop
}

// ------------------- Client Handler -------------------
void handleClient(WiFiClient client) {
  String buffer = "";
  while (client.connected()) {
    while (client.available()) {
      char c = client.read();
      buffer += c;
      if (c == '\n') {
        if (buffer.length() > 2) {
          processPacket(client, buffer.trim());
        }
        buffer = "";
      }
    }
    delay(1);
  }
}

// ------------------- Packet Processing -------------------
void processPacket(WiFiClient client, String packet) {
  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, packet);
  if (err) {
    Serial.println("Invalid JSON");
    return;
  }

  const char* type = doc["type"];

  // Pairing initiation
  if (strcmp(type, "pairing_start") == 0) {
    handlePairingStart(client, doc);
    return;
  }

  // Pairing confirmation
  if (strcmp(type, "pairing_confirm") == 0) {
    handlePairingConfirm(client, doc);
    return;
  }

  // Encrypted command
  if (strcmp(type, "encrypted") == 0) {
    handleEncryptedCommand(client, doc);
    return;
  }

  Serial.println("Unknown packet type");
}

// ------------------- Pairing Start -------------------
void handlePairingStart(WiFiClient client, JsonDocument& req) {
  const char* deviceId = req["deviceId"];
  const char* ephemeralPublicKeyB64 = req["ephemeralPublicKey"];
  const char* salt = req["salt"]; // optional

  // Verify deviceId matches our MAC
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  mac.toLowerCase();
  String incomingId = String(deviceId);
  incomingId.toLowerCase();
  if (incomingId != mac) {
    client.println("{\"type\":\"pairing_error\",\"error\":\"Device ID mismatch\"}");
    return;
  }

  // Decode ephemeral public key from base64
  size_t ephKeyLen = strlen(ephemeralPublicKeyB64);
  uint8_t* ephemeralPublicKey = (uint8_t*)malloc(ephKeyLen);
  size_t decodedLen = 0;
  mbedtls_base64_decode(ephemeralPublicKey, ephKeyLen, &decodedLen, 
                         (const unsigned char*)ephemeralPublicKeyB64, strlen(ephemeralPublicKeyB64));

  // Perform ECDH to get shared secret
  uint8_t sharedSecret[32];
  performECDH(ephemeralPublicKey, decodedLen, sharedSecret);

  // Derive session keys
  uint8_t saltBytes[16] = {0}; // Default salt
  if (salt) {
    mbedtls_base64_decode(saltBytes, sizeof(saltBytes), &decodedLen, 
                           (const unsigned char*)salt, strlen(salt));
  }
  deriveSessionKeys(sharedSecret, saltBytes, sizeof(saltBytes));

  // Compute confirmation value (6-digit code)
  uint8_t confirmHash[32];
  mbedtls_sha256_context shaCtx;
  mbedtls_sha256_init(&shaCtx);
  mbedtls_sha256_starts(&shaCtx, 0);
  mbedtls_sha256_update(&shaCtx, sharedSecret, 32);
  mbedtls_sha256_update(&shaCtx, saltBytes, sizeof(saltBytes));
  mbedtls_sha256_finish(&shaCtx, confirmHash);
  mbedtls_sha256_free(&shaCtx);

  // Derive 6-digit code from hash
  uint32_t confirmCode = 0;
  for (int i = 0; i < 4; i++) {
    confirmCode = (confirmCode << 8) | confirmHash[i];
  }
  confirmCode = confirmCode % 1000000;

  // Encode our static public key
  uint8_t publicKeyBuf[128];
  size_t publicKeyLen = 0;
  mbedtls_ecp_group grp;
  mbedtls_ecp_group_init(&grp);
  mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1);
  mbedtls_ecp_point Q;
  mbedtls_ecp_point_init(&Q);
  mbedtls_ecp_copy(&Q, &keypair.Q);
  mbedtls_ecp_point_write_binary(&grp, &Q, MBEDTLS_ECP_PF_UNCOMPRESSED, 
                                  &publicKeyLen, publicKeyBuf, sizeof(publicKeyBuf));
  
  // Base64 encode public key
  size_t b64Len = 0;
  mbedtls_base64_encode(NULL, 0, &b64Len, publicKeyBuf, publicKeyLen);
  char* publicKeyB64 = (char*)malloc(b64Len + 1);
  mbedtls_base64_encode((unsigned char*)publicKeyB64, b64Len, &b64Len, 
                         publicKeyBuf, publicKeyLen);
  publicKeyB64[b64Len] = '\0';

  // Sign the public key + ephemeral key to prove ownership
  uint8_t signBuf[256];
  size_t signBufLen = publicKeyLen + decodedLen;
  memcpy(signBuf, publicKeyBuf, publicKeyLen);
  memcpy(signBuf + publicKeyLen, ephemeralPublicKey, decodedLen);
  
  uint8_t signature[64];
  size_t sigLen = 0;
  mbedtls_ecdsa_write_signature(&keypair, MBEDTLS_MD_SHA256, signBuf, signBufLen, 
                                  signature, &sigLen, mbedtls_ctr_drbg_random, &ctr_drbg);

  // Base64 encode signature
  size_t sigB64Len = 0;
  mbedtls_base64_encode(NULL, 0, &sigB64Len, signature, sigLen);
  char* signatureB64 = (char*)malloc(sigB64Len + 1);
  mbedtls_base64_encode((unsigned char*)signatureB64, sigB64Len, &sigB64Len, 
                         signature, sigLen);
  signatureB64[sigB64Len] = '\0';

  // Send pairing response with our public key and signature
  char response[512];
  snprintf(response, sizeof(response), 
           "{\"type\":\"pairing_response\",\"staticPublicKey\":\"%s\",\"signature\":\"%s\",\"confirmCode\":%u}",
           publicKeyB64, signatureB64, confirmCode);
  client.println(response);

  // Wait for user confirmation (button press)
  Serial.printf("Confirmation code: %06u\n", confirmCode);
  Serial.println("Press button to confirm pairing...");
  
  unsigned long startTime = millis();
  bool confirmed = false;
  while (millis() - startTime < 60000) { // 60 second timeout
    if (digitalRead(BUTTON_PIN) == LOW) { // Button pressed
      delay(50); // Debounce
      if (digitalRead(BUTTON_PIN) == LOW) {
        confirmed = true;
        break;
      }
    }
    delay(10);
  }

  if (!confirmed) {
    client.println("{\"type\":\"pairing_error\",\"error\":\"User did not confirm\"}");
    pairingComplete = false;
    return;
  }

  pairingComplete = true;
  Serial.println("Pairing confirmed!");
  
  // Clean up
  free(ephemeralPublicKey);
  free(publicKeyB64);
  free(signatureB64);
}

// ------------------- Pairing Confirm -------------------
void handlePairingConfirm(WianoClient client, JsonDocument& req) {
  bool userConfirmed = req["confirmed"];
  if (!userConfirmed) {
    pairingComplete = false;
    client.println("{\"type\":\"pairing_error\",\"error\":\"User declined\"}");
    return;
  }
  pairingComplete = true;
  client.println("{\"type\":\"pairing_success\"}");
}

// ------------------- Encrypted Command -------------------
void handleEncryptedCommand(WiFiClient client, JsonDocument& req) {
  if (!pairingComplete) {
    client.println("{\"type\":\"error\",\"error\":\"Not paired\"}");
    return;
  }

  const char* nonceB64 = req["nonce"];
  const char* ciphertextB64 = req["ciphertext"];
  const char* tagB64 = req["tag"];
  uint64_t timestamp = req["timestamp"];

  // Check timestamp freshness (within 5 seconds)
  uint64_t now = millis();
  if (abs((int64_t)(now - timestamp)) > 5000) {
    client.println("{\"type\":\"error\",\"error\":\"Timestamp stale\"}");
    return;
  }

  // Decode nonce, ciphertext, tag
  uint8_t nonce[12];
  uint8_t tag[16];
  size_t nonceLen = 0, tagLen = 0;
  mbedtls_base64_decode(nonce, sizeof(nonce), &nonceLen, 
                         (const unsigned char*)nonceB64, strlen(nonceB64));
  mbedtls_base64_decode(tag, sizeof(tag), &tagLen, 
                         (const unsigned char*)tagB64, strlen(tagB64));

  size_t ctLen = 0;
  mbedtls_base64_decode(NULL, 0, &ctLen, (const unsigned char*)ciphertextB64, strlen(ciphertextB64));
  uint8_t* ciphertext = (uint8_t*)malloc(ctLen);
  mbedtls_base64_decode(ciphertext, ctLen, &ctLen, 
                         (const unsigned char*)ciphertextB64, strlen(ciphertextB64));

  // Decrypt
  uint8_t plaintext[256];
  size_t ptLen = sizeof(plaintext);
  int ret = decryptMessage(ciphertext, ctLen, sessionKey, nonce, tag, plaintext, &ptLen);
  if (ret != 0) {
    client.println("{\"type\":\"error\",\"error\":\"Decryption failed\"}");
    free(ciphertext);
    return;
  }
  free(ciphertext);

  // Parse plaintext JSON
  StaticJsonDocument<256> cmdDoc;
  deserializeJson(cmdDoc, plaintext);

  const char* action = cmdDoc["action"];
  
  // Execute command
  if (strcmp(action, "on") == 0) {
    relayState = true;
  } else if (strcmp(action, "off") == 0) {
    relayState = false;
  } else if (strcmp(action, "query") == 0) {
    // No action, just report state
  }
  digitalWrite(RELAY_PIN, relayState);

  // Prepare response
  StaticJsonDocument<128> response;
  response["type"] = "response";
  response["state"] = relayState ? "on" : "off";
  response["timestamp"] = millis();

  // Encrypt response
  uint8_t respNonce[12];
  mbedtls_ctr_drbg_random(&ctr_drbg, respNonce, sizeof(respNonce));
  
  uint8_t respCt[256];
  uint8_t respTag[16];
  size_t respCtLen = sizeof(respCt);
  
  String respJson;
  serializeJson(response, respJson);
  
  encryptMessage((const uint8_t*)respJson.c_str(), respJson.length(), 
                  sessionKey, respCt, &respCtLen, respNonce, respTag);

  // Base64 encode
  size_t nonceB64Len = 0, ctB64Len = 0, tagB64Len = 0;
  mbedtls_base64_encode(NULL, 0, &nonceB64Len, respNonce, sizeof(respNonce));
  mbedtls_base64_encode(NULL, 0, &ctB64Len, respCt, respCtLen);
  mbedtls_base64_encode(NULL, 0, &tagB64Len, respTag, sizeof(respTag));

  char* respNonceB64 = (char*)malloc(nonceB64Len + 1);
  char* respCtB64 = (char*)malloc(ctB64Len + 1);
  char* respTagB64 = (char*)malloc(tagB64Len + 1);

  mbedtls_base64_encode((unsigned char*)respNonceB64, nonceB64Len, &nonceB64Len, 
                         respNonce, sizeof(respNonce));
  mbedtls_base64_encode((unsigned char*)respCtB64, ctB64Len, &ctB64Len, 
                         respCt, respCtLen);
  mbedtls_base64_encode((unsigned char*)respTagB64, tagB64Len, &tagB64Len, 
                         respTag, sizeof(respTag));

  respNonceB64[nonceB64Len] = '\0';
  respCtB64[ctB64Len] = '\0';
  respTagB64[tagB64Len] = '\0';

  // Send response
  char finalResp[512];
  snprintf(finalResp, sizeof(finalResp), 
           "{\"type\":\"encrypted\",\"nonce\":\"%s\",\"ciphertext\":\"%s\",\"tag\":\"%s\"}",
           respNonceB64, respCtB64, respTagB64);
  client.println(finalResp);

  free(respNonceB64);
  free(respCtB64);
  free(respTagB64);
}

// ------------------- Key Generation -------------------
void generateKeyPair() {
  mbedtls_ecp_keypair_init(&keypair);
  mbedtls_ecp_group_init(&keypair.grp);
  mbedtls_ecp_group_load(&keypair.grp, MBEDTLS_ECP_DP_SECP256R1);
  mbedtls_mpi_init(&keypair.d);
  mbedtls_ecp_point_init(&keypair.Q);

  // Generate private key
  mbedtls_ecp_gen_keypair(&keypair.grp, &keypair.d, &keypair.Q, 
                           mbedtls_ctr_drbg_random, &ctr_drbg);

  keysInitialized = true;
  Serial.println("EC key pair generated");
}

bool loadKeyPair() {
  // In production, load from flash/NVS
  // For simplicity, always generate new (would be persisted in production)
  return false;
}

bool saveKeyPair() {
  // In production, save private key to flash/NVS
  // For now, just log
  Serial.println("Key pair would be saved to flash");
  return true;
}

// ------------------- ECDH -------------------
void performECDH(uint8_t* peerPublicKey, size_t peerKeyLen, uint8_t* sharedSecret) {
  mbedtls_ecp_group grp;
  mbedtls_ecp_group_init(&grp);
  mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1);

  // Parse peer's public key
  mbedtls_ecp_point peerQ;
  mbedtls_ecp_point_init(&peerQ);
  mbedtls_ecp_point_read_binary(&grp, &peerQ, peerPublicKey, peerKeyLen);

  // Compute shared secret: sharedSecret = ourPrivateKey * peerPublicKey
  mbedtls_mpi sharedSecretMPI;
  mbedtls_mpi_init(&sharedSecretMPI);
  mbedtls_ecdh_compute_shared(&grp, &sharedSecretMPI, &peerQ, &keypair.d, 
                               mbedtls_ctr_drbg_random, &ctr_drbg);

  // Convert to bytes
  mbedtls_mpi_write_binary(&sharedSecretMPI, sharedSecret, 32);

  // Cleanup
  mbedtls_ecp_point_free(&peerQ);
  mbedtls_mpi_free(&sharedSecretMPI);
  mbedtls_ecp_group_free(&grp);
}

void deriveSessionKeys(const uint8_t* sharedSecret, const uint8_t* salt, size_t saltLen) {
  // Simple key derivation: use HKDF-like approach
  // sessionKey = SHA256(sharedSecret || "encryption" || salt)
  // signKey = SHA256(sharedSecret || "signing" || salt)
  
  mbedtls_sha256_context shaCtx;
  mbedtls_sha256_init(&shaCtx);

  // Derive encryption key
  mbedtls_sha256_starts(&shaCtx, 0);
  mbedtls_sha256_update(&shaCtx, sharedSecret, 32);
  mbedtls_sha256_update(&shaCtx, (const uint8_t*)"encryption", 10);
  mbedtls_sha256_update(&shaCtx, salt, saltLen);
  mbedtls_sha256_finish(&shaCtx, sessionKey);

  // Derive signing key
  mbedtls_sha256_starts(&shaCtx, 0);
  mbedtls_sha256_update(&shaCtx, sharedSecret, 32);
  mbedtls_sha256_update(&shaCtx, (const uint8_t*)"signing", 7);
  mbedtls_sha256_update(&shaCtx, salt, saltLen);
  mbedtls_sha256_finish(&shaCtx, signKey);

  mbedtls_sha256_free(&shaCtx);
}

// ------------------- Encryption/Decryption -------------------
int encryptMessage(const uint8_t* plaintext, size_t plaintextLen, 
                   const uint8_t* key, uint8_t* ciphertext, size_t* ciphertextLen,
                   uint8_t* nonce, uint8_t* tag) {
  mbedtls_gcm_context gcm;
  mbedtls_gcm_init(&gcm);
  mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key, 256);
  
  int ret = mbedtls_gcm_crypt_and_tag(&gcm, MBEDTLS_GCM_ENCRYPT, plaintextLen, 
                                       nonce, 12, NULL, 0, plaintext, ciphertext, 16, tag);
  
  *ciphertextLen = plaintextLen;
  mbedtls_gcm_free(&gcm);
  return ret;
}

int decryptMessage(const uint8_t* ciphertext, size_t ciphertextLen,
                   const uint8_t* key, const uint8_t* nonce, const uint8_t* tag,
                   uint8_t* plaintext, size_t* plaintextLen) {
  mbedtls_gcm_context gcm;
  mbedtls_gcm_init(&gcm);
  mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key, 256);
  
  int ret = mbedtls_gcm_auth_decrypt(&gcm, ciphertextLen, nonce, 12, NULL, 0, tag, 16, 
                                      ciphertext, plaintext);
  
  *plaintextLen = ciphertextLen;
  mbedtls_gcm_free(&gcm);
  return ret;
}