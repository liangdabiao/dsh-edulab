# dsh-edulab · 课件实验室

把学科题目 / 知识点生成为**可直接在浏览器打开的单文件交互课件 HTML**——Three.js 3D 场景 / Canvas 2D 动画、步进式讲解、侧栏知识点面板、可交互参数控制，全部装进一个 HTML 文件。

8 个学科技能收编自 [edulab](https://github.com/liangdabiao/edulab)（Apache-2.0），转为 dsh 全形态插件：`edulab` 工具管环境自检 / 成品安检 / 存证 / 预览，侧栏「课件实验室」看板管发起与回看。
<img width="1832" height="1401" alt="image" src="https://github.com/user-attachments/assets/9d4689ed-4661-4701-8703-c319e80fc59b" />
<img width="1413" height="1014" alt="image" src="https://github.com/user-attachments/assets/70efe271-a233-45bf-967d-3407889cacf5" />

## 安装

```
dsh plugin --profile web add https://github.com/liangdabiao/dsh-edulab
```

## 技能总览（8 个）

### 解题三件套（Python + sympy 精确内核）

| 技能 | 产物 | 一句话 |
|---|---|---|
| `edu-solid-geometry` | `solution-<题目>.html` | 立体几何题 → MathJax 分步解析 + Three.js 可交互 3D 模型（建系+向量法，答案与坐标同源） |
| `edu-analytic-geometry` | `solution-<题目>.html` | 圆锥曲线题 → 参数控制台 + KaTeX 分步解析 + Canvas 2D 动态画板（端点开闭自动判定） |
| `edu-chem-reaction` | `reaction-<反应>.html` | 化学反应 → Three.js 微观分子动画（自动配平+原子守恒计数，morph/mechanism 双引擎） |

三者都支持**文字题目 / 随机出题 / 图片识别**三入口。

### 教程模板四件套（python3 字符串替换即可）

| 技能 | 一句话 |
|---|---|
| `edu-chem-tutorial` | 非单一反应的化学课程 → Canvas 2D 步进式教学页（STEPS 驱动 + 场景字典 + 播放器） |
| `edu-physics` | 二维物理场景（力学/热学/电磁/光学/振动波）→ 三栏交互页 + scalars 表达式引擎 |
| `edu-physics-3d` | 必须三维的物理（洛伦兹力/原子轨道/晶体）→ Three.js 3D 画板，与 edu-physics 互补 |
| `edu-plane-geometry` | 平面几何定理 → 浅色课本风画板（几何构造语法 + 直角/等长/角弧标注 + 涂鸦） |

### 科普单文件（零依赖）

| 技能 | 一句话 |
|---|---|
| `edu-sci-viz` | 任何科学概念（日食/潮汐/DNA…）→ 编辑部科学手册风互动科普页，八步法含事实核验 |

## 环境要求

- **解题三件套**：`python3 + sympy`（`python -m pip install sympy`）。缺依赖时 `edulab check` 会如实标出，教程/科普技能不受影响。
- **其余 5 个技能**：python3 仅做字符串替换注入（agent 手写替换也行）；sci-viz 零依赖。
- 课件里的 Three.js / KaTeX / MathJax 走 CDN，**打开课件需要联网**。

## 标准闭环

```
发起制作（面板或对话）→ edulab check → 按技能生成 HTML → edulab validate → edulab save → edulab serve start → 面板回看
```

- `validate` 是**机械事故安检**：只拦占位符残留（`__LESSON_DATA__` 等注入没完成）、坏 JSON 数据岛、文件截断；创作内容零检查。
- `save` 存证到 `~/.dsh/dsh-edulab/courseware/<id>/`，删除留快照可恢复。
- `serve` 在 `127.0.0.1:5200`（Config 可改）挂静态预览，面板 iframe 直接嵌入真实课件。

## 面板「课件实验室」

- **概览**：统计卡 + 8 技能卡（可用性/触发词）+ 最近动态
- **发起制作**：选学科 + 填主题/题目 → 一键带指令开新对话（主题留空则让 agent 出典型题）
- **课件档案**：列表 + 真实课件 iframe 预览 + 源码回看 + 删除
- **动态历史**：save/删除/恢复全程留痕；删除的记录在这里点「恢复」从快照还原

## 架构

```
src/host.js      装配：edulab 工具 + 技能快照 provider + 看板数据面
lib/tools.js     edulab 工具（check/list/validate/save/serve/archive/...）
lib/audit.js     机械事故安检（占位符/JSON 数据岛/CDN 白名单/截断）
lib/env.js       python3 / py -3 / sympy 探测（execFile 防注入）
lib/data.js      存证持久化（$DSH_HOME/dsh-edulab/，原子写，上限管理）
lib/serve.js     预览静态服务（挂 courseware/，插件进程内 http server）
lib/skills.js    技能 provider + DSH 环境说明 addendum 注入
client.js        侧栏入口 + iframe + 主题桥 + 开新对话桥
lab/             面板前端（原生 SPA，编辑部科学手册风）
skills/          8 个学科技能原样快照（SKILL.md + template + references + scripts + lib/*.py）
```

创作归 agent 按 skill 完成；程序只拦机械事故（warn 不阻塞、无黑名单词、宁可漏报不可误报）。

## License

Apache-2.0（沿用 edulab 原始许可，出处见 LICENSE）
