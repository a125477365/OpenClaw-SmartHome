# OpenClaw 智能开关 - 3D 外壳模型规格

## 一、外壳整体规格

```json
{
  "name": "OpenClaw Smart Switch Enclosure",
  "type": "86-type Wall Switch Housing",
  "outer_dimensions": {
    "length": 86.0,
    "width": 86.0,
    "height": 35.0,
    "unit": "mm"
  },
  "inner_dimensions": {
    "length": 82.0,
    "width": 82.0,
    "height": 30.0,
    "unit": "mm"
  },
  "wall_thickness": 2.0,
  "material": "PC (Polycarbonate) Flame Retardant",
  "color": "Matte White",
  "surface_finish": "Fine Matte Texture",
  "install_holes": {
    "distance": 60.3,
    "diameter": 4.0,
    "unit": "mm"
  }
}
```

---

## 二、上盖设计

### 2.1 外观设计

```
上盖正面视图：

┌────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                                                              │ │
│  │                                                              │ │
│  │                          ┌───┐                               │ │
│  │                          │LED│  ← 状态指示灯孔               │ │
│  │                          │   │    直径：3mm                   │ │
│  │                          └───┘    位置：顶部居中              │ │
│  │                                                              │ │
│  │                                                              │ │
│  │                                                              │ │
│  │                          ┌───┐                               │ │
│  │                          │BTN│  ← 配网按钮孔                 │ │
│  │                          │   │    直径：8mm                   │ │
│  │                          └───┘    位置：底部居中              │ │
│  │                                   深度：凹入2mm               │ │
│  │                                                              │ │
│  │                                                              │ │
│  │                                                              │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  安装孔：                                                          │
│     ○                                           ○                  │
│    (Φ4)                                       (Φ4)                 │
│    孔距：60.3mm (标准86型)                                        │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 LED灯孔细节

```json
{
  "led_hole": {
    "type": "Through hole with light guide",
    "diameter": 3.0,
    "position": {"x": 43.0, "y": 25.0},
    "light_guide": {
      "type": "Acrylic dome",
      "diameter": 4.0,
      "height": 1.5,
      "material": "Clear acrylic"
    },
    "counterbore": {
      "diameter": 5.0,
      "depth": 1.0
    }
  }
}
```

### 2.3 按钮孔细节

```json
{
  "button_hole": {
    "type": "Recessed button hole",
    "diameter": 8.0,
    "position": {"x": 43.0, "y": 60.0},
    "recess": {
      "diameter": 10.0,
      "depth": 2.0
    },
    "chamfer": {
      "angle": 45,
      "width": 0.5
    }
  }
}
```

---

## 三、下盖设计

### 3.1 底部接线区域

```
下盖底面视图：

┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│  散热孔区域（可选）：                                               │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  ═══════════════════════════════════════════════════════════ │ │
│  │  ═══════════════════════════════════════════════════════════ │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  接线端子孔：                                                       │
│  ┌────┬────┬────┬────┬────┬────┬────┬────┐                         │
│  │ L  │ N  │COM │ SW │    │    │    │    │                         │
│  │ ●  │ ●  │ ●  │ ●  │    │    │    │    │                         │
│  └────┴────┴────┴────┴────┴────┴────┴────┘                         │
│                                                                    │
│  端子规格：                                                        │
│    - 孔径：5.08mm (KF301端子)                                     │
│    - 间距：10mm                                                    │
│    - 数量：4个 (L/N/COM/SW)                                       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 内部卡扣

```json
{
  "internal_features": {
    "pcb_supports": [
      {"x": 10, "y": 10, "type": "boss", "diameter": 5.0, "height": 3.0},
      {"x": 76, "y": 10, "type": "boss", "diameter": 5.0, "height": 3.0},
      {"x": 10, "y": 76, "type": "boss", "diameter": 5.0, "height": 3.0},
      {"x": 76, "y": 76, "type": "boss", "diameter": 5.0, "height": 3.0}
    ],
    "snap_fits": [
      {"x": 43, "y": 5, "width": 10, "depth": 1.5},
      {"x": 43, "y": 81, "width": 10, "depth": 1.5},
      {"x": 5, "y": 43, "width": 10, "depth": 1.5},
      {"x": 81, "y": 43, "width": 10, "depth": 1.5}
    ]
  }
}
```

---

## 四、STEP/STP 模型规格

### 4.1 导出要求

```json
{
  "export_format": "STEP (ISO 10303-214)",
  "file_name": "OpenClaw-SmartSwitch-Enclosure.step",
  "units": "mm",
  "assembly": {
    "components": [
      "Top_Cover.step",
      "Bottom_Cover.step",
      "LED_Light_Guide.step",
      "Button_Cap.step"
    ]
  },
  "tolerance": {
    "general": "±0.1mm",
    "critical_dimensions": "±0.05mm"
  }
}
```

---

## 五、3D打印测试模型

### 5.1 简化版 STL 规格

```
可用于桌面3D打印机测试的简化模型：

文件：OpenClaw-SmartSwitch-Enclosure-Simple.stl

打印参数建议：
- 材料：PLA 或 PETG
- 层高：0.2mm
- 壁厚：3层（约1.2mm）
- 填充：20%
- 支撑：上盖LED孔和按钮孔需要支撑
- 打印温度：200-220°C (PLA)
- 热床温度：60°C

打印时间预估：
- 上盖：约3-4小时
- 下盖：约2-3小时

注意：
- 3D打印版本仅用于功能测试
- 量产需开模注塑
```

---

## 六、开模规格

### 6.1 注塑模具要求

```json
{
  "mold_type": "Injection Mold",
  "cavity_count": 1,
  "material": "P20 Steel",
  "surface_finish": "MT11010 (Fine Matte)",
  "cycle_time": "30-40 seconds",
  "expected_life": "300,000+ cycles",
  "part_weight": {
    "top_cover": 25,
    "bottom_cover": 35,
    "unit": "g"
  },
  "runner_type": "Cold Runner",
  "gate_type": "Edge Gate",
  "draft_angle": 1.5,
  "shrinkage_rate": 0.005
}
```

### 6.2 开模费用估算

```
模具费用（仅供参考）：

1. 简易模（样品用）：
   - 材料：铝模
   - 费用：5,000 - 10,000 元
   - 寿命：5,000 - 10,000 次

2. 生产模（量产用）：
   - 材料：钢模 (P20)
   - 费用：20,000 - 50,000 元
   - 寿命：300,000+ 次

3. 双色模（如需双色LED窗）：
   - 费用：50,000 - 100,000 元

推荐方案：
- 先做铝模样品，验证设计
- 样品OK后开钢模量产
```

---

## 七、给3D设计师的需求

### 7.1 设计需求模板

```
项目：OpenClaw智能开关外壳设计

交付物：
1. 上盖 STEP 模型
2. 下盖 STEP 模型
3. 组装爆炸图
4. 2D 工程图（PDF）

规格要求：
- 尺寸：86mm × 86mm × 35mm
- 材质感：哑光磨砂，类似Apple产品
- 颜色：白色
- 特征：
  * 上盖：LED孔(Φ3mm)、按钮孔(Φ8mm，凹入2mm)
  * 下盖：4个接线端子孔、散热孔（可选）
  * 卡扣式固定（无螺丝）
- 安装孔距：60.3mm（标准86型）

参考风格：
- 小米智能开关
- Aqara墙壁开关

交付格式：
- STEP (STEP214)
- STL (3D打印测试用)
- PDF (2D工程图)

预算：XXX元
交期：X天
```

---

## 八、快速获取外壳方案

### 方案A：淘宝3D打印（最快）

```
搜索：3D打印服务
价格：约50-100元/套（PLA材料）
交期：3-5天
适合：功能验证
```

### 方案B：淘宝开模

```
搜索：注塑开模、外壳开模
价格：5,000-20,000元（铝模）
交期：15-30天
适合：小批量生产
```

### 方案C：用现成外壳

```
方案：购买标准86型开关面板改装
1. 买现成的86型空白面板（约5-10元）
2. 钻孔：LED孔、按钮孔
3. 费用低，快速验证
```

---

## 九、文件清单

```
production/enclosure/
├── OpenClaw-SmartSwitch-Top.step      ← 上盖模型
├── OpenClaw-SmartSwitch-Bottom.step   ← 下盖模型
├── OpenClaw-SmartSwitch-Assembly.step ← 组装模型
├── OpenClaw-SmartSwitch-Top.stl       ← 上盖STL（3D打印）
├── OpenClaw-SmartSwitch-Bottom.stl    ← 下盖STL（3D打印）
├── Drawing-Top.pdf                    ← 上盖2D图
├── Drawing-Bottom.pdf                 ← 下盖2D图
└── enclosure-spec.json                ← 规格参数
```

---

*文档版本：1.0*
*更新日期：2026-03-22*
