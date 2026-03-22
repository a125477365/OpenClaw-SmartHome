# OpenClaw Smart Switch v2.0 - 完整 Gerber 文件包

## 📦 文件清单

这是完整可用的 Gerber 文件包，可直接上传到 PCB 厂家打样。

### 必需文件 (10个)

| 序号 | 文件名 | 说明 |
|------|--------|------|
| 1 | OpenClaw-SmartSwitch-v2-F.Cu.gtl | 顶层铜箔 |
| 2 | OpenClaw-SmartSwitch-v2-B.Cu.gbl | 底层铜箔 |
| 3 | OpenClaw-SmartSwitch-v2-F.Mask.gts | 顶层阻焊 |
| 4 | OpenClaw-SmartSwitch-v2-B.Mask.gbs | 底层阻焊 |
| 5 | OpenClaw-SmartSwitch-v2-F.SilkS.gto | 顶层丝印 |
| 6 | OpenClaw-SmartSwitch-v2-B.SilkS.gbo | 底层丝印 |
| 7 | OpenClaw-SmartSwitch-v2-F.Paste.gtp | 顶层锡膏 |
| 8 | OpenClaw-SmartSwitch-v2-B.Paste.gbp | 底层锡膏 |
| 9 | OpenClaw-SmartSwitch-v2-Edge.Cuts.gm1 | 板框轮廓 |
| 10 | OpenClaw-SmartSwitch-v2.drl | 钻孔文件 |

## 📋 PCB 规格

```
板材：FR-4
板厚：1.6mm
层数：2层
铜厚：1oz (35μm)
表面处理：HASL 无铅
阻焊颜色：绿色
字符颜色：白色
板尺寸：86mm × 86mm
最小线宽：0.25mm (信号)
最小线宽：2mm (电源)
最小线距：0.2mm
最小孔径：0.3mm (过孔)
```

## 🏭 打样步骤

### 方式一：嘉立创

1. 访问 https://www.jlc.com
2. 点击"在线下单"
3. 上传所有 Gerber 文件（10个）
4. 选择参数：
   - 板子层数：2层
   - 板子尺寸：86×86mm
   - 板子厚度：1.6mm
   - 铜箔厚度：1oz
   - 表面处理：喷锡无铅
   - 阻焊颜色：绿色
   - 字符颜色：白色
5. 价格：约 ¥10-20/5片

### 方式二：立创 EDA

1. 访问 https://lceda.cn
2. 每月 2 片免费打样

## ✅ 完整线路说明

### 包含的电路

| 电路模块 | 状态 | 说明 |
|----------|------|------|
| 电源模块 (BP2525) | ✅ 完整 | 220V → 5V |
| ESP32-C3 模块 | ✅ 完整 | WiFi + BLE |
| 继电器驱动 | ✅ 完整 | GPIO5 → S8050 → HF32FV-G |
| RGB LED | ✅ 完整 | GPIO2/3/4 |
| 开关按键 | ✅ 完整 | GPIO6 |
| 配网按键 | ✅ 完整 | GPIO7 |
| 接线端子 | ✅ 完整 | L/N 输入, L_OUT 输出 |

### 引脚连接

```
ESP32-C3 引脚分配：

电源：
  VCC ← 5V (从 BP2525)
  GND ← 公共地

控制：
  GPIO2 → LED_RED (红灯)
  GPIO3 → LED_GREEN (绿灯)
  GPIO4 → LED_BLUE (蓝灯)
  GPIO5 → RELAY_CTRL (继电器控制)
  GPIO6 → SW_BTN (开关按键)
  GPIO7 → RST_BTN (配网/重置按键)

外部接口：
  TX/RX ← 调试串口
  EN ← 复位 (可选)
```

## ⚠️ 重要提示

### 焊接顺序

```
1. SMD 元件（先焊）
   └─ 贴片电阻/电容
   └─ LED
   └─ SOT-23 三极管
   └─ BP2525 芯片

2. 插件元件（后焊）
   └─ 继电器
   └─ 接线端子
   └─ 按键
   └─ 电解电容
   └─ ESP32 模块
```

### 测试步骤

```
1. 上电前
   └─ 目视检查焊点
   └─ 用万用表测短路

2. 低压测试 (用 5V 电源)
   └─ 测量 3.3V 是否正常
   └─ 测量 ESP32 电流 (约 50-100mA)

3. 功能测试
   └─ 烧录固件
   └─ 测试按键响应
   └─ 测试 LED 控制
   └─ 测试继电器吸合

4. 高压测试 (接 220V)
   └─ ⚠️ 注意安全！
   └─ 测量 5V 输出
   └─ 测试完整功能
```

## 📞 问题反馈

如有问题，请提交 Issue：
https://github.com/a125477365/openclaw-switch-firmware/issues

---

**版本**: v2.0 (完整版)
**日期**: 2026-03-19
