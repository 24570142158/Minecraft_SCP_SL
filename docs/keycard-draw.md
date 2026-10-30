# 钥匙卡抽卡动画:问题与实现

> 本文是 `resource_packs/SCPSL` 中钥匙卡抽卡动画系统的**唯一注释源**:仓库内相关 JSON 文件一律保持无注释,任何"这段代码为什么存在"的问题,以本文为准。
> 适用基线:`minecraft:player` 客户端实体基于官方 1.26.50 样本文件;游戏运行版本升级时按[维护守则](#5-维护守则)重新对齐。

## 1. 问题定义

需求:玩家在快捷栏中切换到任意一张钥匙卡的**瞬间**,第一人称播放一次"抽卡"动画;动画结束后卡片保持在一个固定的持卡姿势;第三人称显示卡片但不播放动画;原版"切换物品时手臂下沉再抬起"的手部动作不得与抽卡动作叠加。

直接实现会撞上三个事实:

1. **动画控制器的状态动画只在"进入状态"的那一刻从头播放。** 想让动画重播,必须让状态机真正地"离开再进入"某个状态——仅凭条件恒真无法二次触发;
2. **装备切换在客户端 Molang 里没有现成查询。** 动画控制器每帧能读到的输入——视角、时间、运动速度——都不随"换了手里的物品"而变化,必须自行构造"换卡边沿";
3. **原版的切换下沉是一个常驻动画。** 它不是"切换时播一次",而是每帧都在计算 `-10 × (1 - variable.player_arm_height)` 的手臂位移;切换物品时引擎把这个变量压到 0 再缓动回 1,手就画出"下沉上抬"。不处理它,抽卡动作会和下沉叠加。

由此得出整个系统的总设计原则:**显示与动画分成两条独立通道。**

- **显示通道**只回答"手里是不是卡":第一、第三人称都显示,九张卡按等级即时换贴图、换几何;
- **动画通道**只回答"第一人称里刚发生换卡吗":是则完整播放一次,其余一切情况保持安静。

## 2. 架构总览与文件清单

```
entity/player.entity.json  scripts.pre_animation(每渲染帧执行)
  ├─ variable.keycard_tier      等级检测:1–9 = 九张卡,0 = 未持卡
  ├─ variable.keycard_changed   换卡边沿:等级与上一帧存档比对,切换时恰为一帧为真
  ├─ variable.holding_keycard   显示开关:两个人称都显示卡片
  ├─ variable.keycard_anim      动画开关:holding_keycard && is_first_person
  ├─ variable.keycard_geom      几何选择:竖卡等级(7/8)为 1,横卡为 0
  └─ variable.player_arm_height 钉 1:压制原版切换下沉
        │
        ▼
animation_controllers/scp/card.json  五态状态机
  setup ──(anim && changed)──> draw ⇄ draw2(播放抽卡动画,换卡时互为中继重播)
  draw/draw2 ──(播完)────────> hold_fp(第一人称:静态持卡姿势)
  draw/hold_fp ──(切第三人称)> hold_tp(中立,无动画)
  任何状态 ──(收起卡)──────> setup
        │
        ▼
render_controllers/scp_keycard.json
  条件 variable.holding_keycard,按等级数组选贴图与几何
```

| 文件 | 职责 |
|---|---|
| `entity/player.entity.json` | `minecraft:player` 客户端实体完整覆盖(全文件替换,无合并);承载全部检测变量与资源登记 |
| `animation_controllers/scp/card.json` | 五态动画状态机 |
| `animations/animation.card.json` | 抽卡过程动画(`hold_on_last_frame`,末帧即目标姿势) |
| `animations/scp/card_hold.json` | 持卡姿势(静态循环动画),值须与抽卡动画末帧一致 |
| `render_controllers/scp_keycard.json` | 按等级数组选贴图与几何的条件渲染 |
| `attachables/*.json`(9 个) | **空几何**。唯一职责是压制原版平面手持渲染,自身不绘制任何内容 |

### attachable 消音器原理

物品定义了 attachable 时,原版不再渲染手持的平面物品贴图;没有 attachable 的物品则回到原版平面渲染。`enable_attachables` 是实体级的全有全无开关,无法对单个物品关闭。因此九张卡各保留一个 attachable 注册,但其几何体内不含任何立方体——**存在,但不画**。删除这些 attachable 会让原版平面渲染回归,并与实体渲染叠成双重渲染。

## 3. 分步实现

以下代码块与仓库文件逐字一致(均为无注释的最终形态)。每个小节标题注明代码所属文件与位置。

### 3.1 等级检测

位置:`entity/player.entity.json` → `scripts.pre_animation`(追加在原版条目之后,顺序即依赖顺序)。

```json
"variable.keycard_tier = query.get_equipped_item_name == 'janitor_keycard' ? 1.0 : query.get_equipped_item_name == 'scientist_keycard' ? 2.0 : query.get_equipped_item_name == 'research_supervisor_keycard' ? 3.0 : query.get_equipped_item_name == 'security_guard_keycard' ? 4.0 : query.get_equipped_item_name == 'reworked_operative_keycard' ? 5.0 : query.get_equipped_item_name == 'reworked_captain_keycard' ? 6.0 : query.get_equipped_item_name == 'facility_manager_keycard_fixed' ? 7.0 : query.get_equipped_item_name == 'reworked_zone_manager_keycard' ? 8.0 : query.get_equipped_item_name == 'reworked_o5_keycard' ? 9.0 : 0.0;",
"variable.holding_keycard = variable.keycard_tier > 0.0;",
"variable.keycard_geom = variable.keycard_tier == 7.0 || variable.keycard_tier == 8.0 ? 1.0 : 0.0;",
```

要点:

- `query.get_equipped_item_name` 对自定义物品返回**无命名空间短名**(`scp:scientist_keycard` 比较时写作 `'scientist_keycard'`);
- 一个等级变量同时服务显示(贴图/几何索引)与动画(边沿检测),九张卡的接入成本是"数组加一项、三目链加一节";
- 等级即权限位的表达层映射:`1=清洁工 2=科学家 3=研究主管 4=警卫 5=MTF特工 6=MTF指挥官 7=设施总监(竖卡) 8=区域总监(竖卡) 9=O5;0=未持卡`。

### 3.2 换卡边沿

位置:`scripts.initialize`(一行)与 `scripts.pre_animation`(两行,紧跟等级检测之后;**先比对、后存档,顺序不可交换**)。

```json
"variable.last_keycard_tier = 0.0;"
```

```json
"variable.keycard_changed = variable.keycard_tier != variable.last_keycard_tier;",
"variable.last_keycard_tier = variable.keycard_tier;",
```

要点:

- `pre_animation` 每轮**顺序求值**:第一行拿当前等级与上一帧存档比对,第二行立即存档,因此 `keycard_changed` 在每次换卡后**恰好一帧**为真——这就是重播边沿;
- 该机制运行在客户端**渲染帧**时钟上(每秒次数随设备而变),与游戏逻辑的每秒 20 刻无关;比对与存档同轮完成,帧率高低不影响触发次数;
- `initialize` 的兜底不可省略:否则进世界首帧读未定义变量,内容日志出现 `unknown variable` 报错。

### 3.3 人称门控

位置:`scripts.pre_animation`(紧跟 `holding_keycard` 之后)。

```json
"variable.keycard_anim = variable.holding_keycard && variable.is_first_person;",
```

要点:

- `variable.is_first_person` 由引擎注入,无需初始化;
- 显示与动画自此分家:渲染控制器读 `holding_keycard`(双人称显示),动画状态机读 `keycard_anim`(仅第一人称)。第三人称切换物品永远不会点亮动画。

### 3.4 切换下沉压制

位置:`scripts.pre_animation`(检测块的最后一行)。

```json
"variable.player_arm_height = variable.holding_keycard ? 1.0 : variable.player_arm_height;",
```

要点:

- 原版第一人称动画 `animation.player.first_person.swap_item` 是常驻循环,对左右臂写入位移 `[0, -10 × (1 - variable.player_arm_height), 0]`;正常时变量为 1(位移零),切换物品时引擎将其压低再缓回,形成下沉;
- 引擎注入的变量可以在 `pre_animation` 中覆写:持卡期间把它**钉在 1**,原版动画照常运行但位移恒为零,抽卡动作在完全静止的手上播放;
- 不持卡时透传引擎值,卡→其他物品的下沉照常出现;
- 该变量在原版第一人称动画中仅此两处消费(左右臂各一),钉住它没有其他副作用;第三人称本就不运行该动画,无需区分人称。

### 3.5 五态动画控制器

位置:`animation_controllers/scp/card.json`(全文)。

```json
{
  "format_version": "1.10.0",
  "animation_controllers": {
    "controller.animation.scp.keycard": {
      "initial_state": "setup",
      "states": {
        "setup": {
          "transitions": [
            { "draw": "variable.keycard_anim && variable.keycard_changed" },
            { "hold_fp": "variable.keycard_anim" }
          ]
        },
        "draw": {
          "animations": ["scp_card_flip"],
          "transitions": [
            { "draw2": "variable.keycard_anim && variable.keycard_changed" },
            { "hold_tp": "variable.holding_keycard && !variable.keycard_anim" },
            { "setup": "!variable.holding_keycard" },
            { "hold_fp": "q.all_animations_finished && variable.keycard_anim" }
          ]
        },
        "draw2": {
          "animations": ["scp_card_flip"],
          "transitions": [
            { "draw": "variable.keycard_anim && variable.keycard_changed" },
            { "hold_tp": "variable.holding_keycard && !variable.keycard_anim" },
            { "setup": "!variable.holding_keycard" },
            { "hold_fp": "q.all_animations_finished && variable.keycard_anim" }
          ]
        },
        "hold_fp": {
          "animations": ["scp_card_hold"],
          "transitions": [
            { "draw": "variable.keycard_anim && variable.keycard_changed" },
            { "hold_tp": "variable.holding_keycard && !variable.keycard_anim" },
            { "setup": "!variable.holding_keycard" }
          ]
        },
        "hold_tp": {
          "transitions": [
            { "hold_fp": "variable.keycard_anim" },
            { "setup": "!variable.holding_keycard" }
          ]
        }
      }
    }
  }
}
```

要点:

- **`draw` 与 `draw2` 互为镜像中继**:换卡边沿点亮时借道对方重播(进入新状态 = 动画从头播放),边沿只亮一帧,不会往复弹跳;
- **转移顺序即优先级**:每个状态先查"重播"(changed),再查"换视角/收卡",最后才查"播完交接"——收卡与切人称永远抢在姿势交接之前生效;
- **`q.all_animations_finished` 交接**:抽卡动画(`hold_on_last_frame`)时间线走完后为真,滑入 `hold_fp`;抽卡动画的时长决定姿势接管时机,缩改时长无需改控制器;
- **`hold_fp` 播放静态循环姿势**,`hold_tp` 不播任何动画(中立姿态)。视角往返只在两个 hold 之间摆渡,姿势永久保持且永不重播;`setup → hold_fp` 的无条件转移让"切回第一人称"同样安静;
- 该控制器作为**独立顶层条目**挂在实体的 `animate` 列表(与原版 `root` 平级),独立条目可以驱动第一人称手臂,无需嵌入原版控制器的 `first_person` 状态。

### 3.6 持卡姿势与末帧同步规则

位置:`animations/scp/card_hold.json`(全文)。

```json
{
	"format_version": "1.8.0",
	"animations": {
		"animation.scp.keycard_hold": {
			"loop": true,
			"animation_length": 0.1,
			"bones": {
				"rightItem": {
					"rotation": {
						"0.0": [27.534, 45.8879, -37.0704]
					},
					"position": {
						"0.0": [-1, 1, 1]
					}
				}
			}
		}
	}
}
```

**同步规则(必守)**:本文件的旋转**与位移**必须逐值等于抽卡动画(`animation.card`)的最后一个关键帧。抽卡动画播完滑入本姿势,任何一处不一致都会在交接瞬间产生可见跳变;抽卡动画若带位移通道而姿势文件未钉住,卡片会在交接瞬间弹回原点。

### 3.7 按等级条件渲染

位置:`render_controllers/scp_keycard.json`(全文)。

```json
{
  "format_version": "1.10.0",
  "render_controllers": {
    "controller.render.scp.keycard": {
      "geometry": "Array.geoms[variable.keycard_geom]",
      "materials": [
        { "*": "Material.default" }
      ],
      "textures": ["Array.cards[variable.keycard_tier - 1.0]"],
      "arrays": {
        "textures": {
          "Array.cards": [
            "Texture.scp_card_janitor",
            "Texture.scp_card_scientist",
            "Texture.scp_card_research",
            "Texture.scp_card_guard",
            "Texture.scp_card_operative",
            "Texture.scp_card_captain",
            "Texture.scp_card_facility",
            "Texture.scp_card_zone",
            "Texture.scp_card_o5"
          ]
        },
        "geometries": {
          "Array.geoms": [
            "Geometry.scp_card_landscape",
            "Geometry.scp_card_vertical"
          ]
        }
      }
    }
  }
}
```

要点:

- 渲染控制器的 `Geometry.* / Texture.*` 大写前缀映射到实体登记表中同名键;数组按下标取值,等级 1–9 对应贴图下标 0–8;
- 两套几何是**完整玩家骨架骨名拷贝**,仅 `rightItem` 骨挂卡片立方体,因此与骨架动画天然同频;
- 渲染条件在实体 `render_controllers` 表中登记为 `variable.holding_keycard`(双人称显示)。

### 3.8 实体文件中的登记点

`entity/player.entity.json` 共五处登记(此处为去除注释后的最终形态):

```json
"textures": {
  "default": "textures/entity/steve",
  "cape": "textures/entity/cape_invisible",
  "scp_card_janitor": "textures/items/janitor_keycard",
  "scp_card_scientist": "textures/items/scientist_keycard",
  "scp_card_research": "textures/items/research_supervisor_keycard",
  "scp_card_guard": "textures/items/security_guard_keycard",
  "scp_card_operative": "textures/items/reworked_operative_keycard",
  "scp_card_captain": "textures/items/reworked_captain_keycard",
  "scp_card_facility": "textures/items/facility_manager_keycard_fixed",
  "scp_card_zone": "textures/items/reworked_zone_manager_keycard",
  "scp_card_o5": "textures/items/reworked_o5_keycard"
}
```

```json
"geometry": {
  "default": "geometry.humanoid.custom",
  "cape": "geometry.cape",
  "scp_card_landscape": "geometry.landscape_card",
  "scp_card_vertical": "geometry.vertical_card"
}
```

```json
"animate": [
  "root",
  "scp_keycard_controller"
]
```

```json
"scp_card_flip": "animation.card",
"scp_card_hold": "animation.scp.keycard_hold",
"scp_keycard_controller": "controller.animation.scp.keycard"
```

```json
{ "controller.render.scp.keycard": "variable.holding_keycard" }
```

要点:实体贴表路径相对资源包根目录且不带扩展名;`animate` 列表中抽卡控制器排在 `root` 之后,同骨骼通道的求值顺序保证姿势覆盖原版动作。

## 4. 行为速查表

| 操作 | 动画 | 卡片显示 |
|---|---|---|
| 第一人称切到任意卡 | 完整播放 → 播完锁进持卡姿势 | 出现,按等级换贴图/几何 |
| 第一人称卡 A ↔ 卡 B(含连续快切) | 每次完整重播 | 即时切换 |
| 第一人称卡 → 非卡物品 | 姿势撤销 | 消失,原版切换下沉恢复 |
| 第三人称任何操作 | 永不播放 | 中立姿态,贴图照常切换 |
| 持卡时 F5 / 开关物品栏 | 挂起,切回不重播 | 姿势经 hold_fp/hold_tp 摆渡,不丢失 |
| 进世界时手持卡(第一人称) | 自动播放一次 | 出现 |
| `/reload` | 状态重置,自动播放一次 | — |
| 不持卡 | 无 | 无,原版行为 100% 原样 |

## 5. 维护守则

1. **游戏版本更新**:用对应版本官方样本仓库的 `player.entity.json` 重做基线(实体定义是整体替换,基线落后会在内容日志产生 `unknown variable` 类报错),再按第 3 节逐步重新套用;新报错的排查方法是先分清"读者"(引用变量的动画/控制器)与"写者"(定义变量的脚本),再决定补定义还是回滚覆盖。
2. **修改抽卡动画末帧**:`animation.card` 最后一个关键帧的旋转**与位移**必须同步进 `card_hold.json`(见 3.6 同步规则)。
3. **两个时钟**:本文所有 Molang(检测、控制器、动画)运行在客户端**渲染帧**时钟;行为包脚本的 `system.runInterval` 运行在每秒 20 **刻**的逻辑时钟。两层只通过物品状态间接耦合,不直接通信。
4. **`player.entity.json` 中有 18 行长矛变量补丁,与钥匙卡系统无关但绝不可删除**:原版玩家实体缺失了长矛动画链引用的 `*melee_spear*` 变量家族(僵尸、猪灵等实体有完整定义块),手持长矛会逐帧刷 `unknown variable` 报错。补丁把 `melee_spear_equipped` 按物品标签语义还原、其余偏移钩子按引擎隐式值补 0,视觉与原版一致,仅消除报错。游戏更新后重对基线时需一并保留。
5. **九个空几何 attachable 是系统的承重件**,不是废弃物:它们压制原版平面手持渲染(见第 2 节),删除即回归双重渲染。
