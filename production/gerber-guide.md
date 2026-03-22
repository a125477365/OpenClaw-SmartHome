# PCB Gerber 文件说明

由于 Gerber 文件是二进制格式，需要由 EDA 软件生成。以下是生成步骤：

## 一、使用 EasyEDA（推荐，最简单）

### 步骤 1：注册登录
1. 访问：https://easyeda.com/ 或 https://lceda.cn/
2. 注册账号（免费）

### 步骤 2：创建新项目
1. 点击「新建项目」
2. 项目名称：OpenClaw-SmartSwitch
3. 选择「新建原理图」

### 步骤 3：绘制原理图
按照 `docs/circuit-schematic.md` 的描述绘制：

1. 放置元件：
   - ESP32-WROOM-32D
   - HLK-PM01 电源模块
   - SRD-05VDC-SL-C 继电器
   - WS2812B LED
   - S8050 三极管
   - 1N4007 二极管
   - 电阻电容等

2. 连接线：
   - 电源线（+5V、GND）
   - GPIO 控制线
   - 继电器驱动线

### 步骤 4：转换为 PCB
1. 点击「设计」→「转换原理图到 PCB」
2. 调整元件位置（参考 pcb-design.json）
3. 布线

### 步骤 5：生成 Gerber
1. 点击「文件」→「导出」→「Gerber」
2. 选择「生成所有层」
3. 下载 gerber.zip

### 步骤 6：打样
1. 直接在 EasyEDA 点击「PCB下单」
2. 选择「嘉立创」
3. 参数：
   - 尺寸：86mm x 86mm
   - 层数：2层
   - 板厚：1.6mm
   - 数量：5片
4. 等待生产

---

## 二、使用 KiCad（开源免费）

### 步骤 1：下载安装
- 官网：https://www.kicad.org/download/

### 步骤 2：创建项目
1. 文件 → 新建项目
2. 项目名：OpenClaw-SmartSwitch

### 步骤 3：绘制原理图
1. 打开 .kicad_sch 文件
2. 添加元件符号
3. 连接导线

### 步骤 4：分配封装
1. 工具 → 分配封装
2. 为每个元件选择封装

### 步骤 5：PCB 布局
1. 工具 → 从原理图更新 PCB
2. 放置元件
3. 绘制边框（86mm x 86mm）
4. 布线

### 步骤 6：生成 Gerber
1. 文件 → 绘图 → Gerber
2. 选择输出目录
3. 生成所有层

---

## 三、Gerber 文件清单

生成后应包含以下文件：

| 文件名 | 说明 |
|--------|------|
| OpenClaw-SmartSwitch-F.Cu.gbr | 顶层铜 |
| OpenClaw-SmartSwitch-B.Cu.gbr | 底层铜 |
| OpenClaw-SmartSwitch-F.Paste.gbr | 顶层锡膏 |
| OpenClaw-SmartSwitch-B.Paste.gbr | 底层锡膏 |
| OpenClaw-SmartSwitch-F.SilkS.gbr | 顶层丝印 |
| OpenClaw-SmartSwitch-B.SilkS.gbr | 底层丝印 |
| OpenClaw-SmartSwitch-F.Mask.gbr | 顶层阻焊 |
| OpenClaw-SmartSwitch-B.Mask.gbr | 底层阻焊 |
| OpenClaw-SmartSwitch-Edge.Cuts.gbr | 板框 |
| OpenClaw-SmartSwitch.drl | 钻孔文件 |

---

## 四、验证 Gerber

### 使用在线查看器
1. 访问：https://gerber-viewer.easyeda.com/
2. 上传 gerber.zip
3. 检查：
   - 板框尺寸是否正确
   - 元件位置是否正确
   - 走线是否完整
   - 安全间距是否足够

---

## 五、交给厂家的文件

将以下文件打包发给 PCB 厂家：

```
production/
├── gerber.zip          ← Gerber 文件
├── BOM.csv             ← 物料清单
├── pick-place.csv      ← 贴片坐标文件
└── pcb-notes.txt       ← 生产说明
```

### pick-place.csv 格式

```
Designator,Footprint,Mid X,Mid Y,Ref X,Ref Y,Pad X,Pad Y,Layer,Rotation,Comment
U1,ESP32-WROOM-32,25.0,45.0,25.0,45.0,25.0,45.0,Top,0,ESP32 Module
K1,Relay_THT,65.0,55.0,65.0,55.0,65.0,55.0,Top,0,5V Relay NC
...
```

---

## 六、快速方案：找淘宝代画 PCB

如果不会用 EDA 软件，可以：

1. 淘宝搜索：「PCB画板」「PCB设计」
2. 发给卖家：
   - circuit-schematic.md（电路描述）
   - pcb-design.json（元件位置）
   - 说明：「86型智能开关，2层板，带强电隔离」
3. 费用：约 50-150 元
4. 交期：1-3 天

---

*文档版本：1.0*
*更新日期：2026-03-22*
