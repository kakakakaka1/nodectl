# NodeCTL 架构文档

> 节点部署 · 中转面板 · 订阅管理 一体化面板

---

## 目录

1. [项目概览](#1-项目概览)
2. [目录结构](#2-目录结构)
3. [技术栈](#3-技术栈)
4. [分层架构](#4-分层架构)
5. [数据库模型](#5-数据库模型)
6. [API 路由总览](#6-api-路由总览)
7. [核心业务流程](#7-核心业务流程)
8. [Agent 通信体系](#8-agent-通信体系)
9. [中转系统详解](#9-中转系统详解)
10. [订阅生成流程](#10-订阅生成流程)
11. [Cloudflare 集成](#11-cloudflare-集成)
12. [前端模板结构](#12-前端模板结构)
13. [配置体系](#13-配置体系)
14. [构建与部署](#14-构建与部署)

---

## 1. 项目概览

NodeCTL 是一个用 Go 编写的**节点管理与加速控制面板**，核心功能：

- **节点部署管理**：集中管理分布式代理节点，支持 15+ 协议
- **中转转发面板**：iptables 转发 + 手动录入双模式，自动生成直连节点
- **订阅分发系统**：Clash Meta / V2Ray / Raw 多格式订阅生成
- **流量监控**：实时流量统计、限额、阈值告警
- **Cloudflare 集成**：Tunnel 隧道、SSL 证书、IP 优选
- **机场订阅管理**：导入第三方机场订阅，测速筛选

---

## 2. 目录结构

```
nodectl/
├── main.go                          # 程序入口
├── go.mod / go.sum                  # Go 模块依赖
│
├── cmd/                             # 独立二进制
│   ├── nodectl-agent/main.go        # 节点 Agent（部署在落地/直连机上）
│   └── nodectl-relay-agent/main.go  # 中转 Agent（部署在中转机上）
│
├── internal/                        # 内部包（不对外暴露）
│   ├── agent/                       # Agent 运行时组件
│   │   ├── collector.go             # 网络流量采集器
│   │   ├── reporter.go              # WebSocket 上报器
│   │   ├── runtime.go               # Agent 主循环
│   │   ├── updater.go               # 自更新机制
│   │   ├── updater_stub.go          # 更新桩实现
│   │   ├── config.go                # Agent 配置加载
│   │   ├── agentversion.go          # 版本管理
│   │   └── logdedup.go              # 日志去重
│   │
│   ├── database/                    # 数据层
│   │   ├── database.go              # 数据库初始化、模型定义、迁移
│   │   ├── defaults.go              # 默认配置初始化（100+ SysConfig 键）
│   │   └── relay.go                 # 中转机 & 转发规则模型
│   │
│   ├── logger/                      # 日志系统
│   │   └── logger.go                # slog 结构化日志 + lumberjack 轮转
│   │
│   ├── middleware/                   # HTTP 中间件
│   │   └── auth.go                  # JWT 认证 + IP 限频
│   │
│   ├── server/                      # HTTP 处理层
│   │   ├── server.go                # 路由注册、热重启、TLS
│   │   ├── handlers.go              # 公共工具函数（sendJSON 等）
│   │   ├── auth_handler.go          # 登录/登出/改密
│   │   ├── node_handler.go          # 节点 CRUD + 控制命令
│   │   ├── relay_handler.go         # 中转机 & 转发规则 API
│   │   ├── traffic_handler.go       # 流量查询 API
│   │   ├── subscription_handler.go  # 订阅分发端点
│   │   ├── airport_handler.go       # 机场订阅管理
│   │   ├── settings_handler.go      # 全局设置
│   │   ├── system_handler.go        # 系统监控
│   │   ├── database_handler.go      # 数据库管理
│   │   ├── cf_handlers.go           # Cloudflare Tunnel/DNS
│   │   └── cf_ipopt_handlers.go     # Cloudflare IP 优选
│   │
│   ├── service/                     # 业务逻辑层
│   │   ├── service.go               # 节点管理核心
│   │   ├── relay.go                 # 中转匹配引擎 & 直连节点同步
│   │   ├── relay_agent.go           # 中转 Agent WebSocket Hub
│   │   ├── subscription.go          # 订阅生成（Clash/V2Ray/Raw）
│   │   ├── links.go                 # 协议链接解析与生成
│   │   ├── airport.go               # 机场订阅解析
│   │   ├── clash.go                 # Clash 配置构建
│   │   ├── cf_tunnel.go             # Cloudflare Tunnel 管理
│   │   ├── cf_cert.go               # TLS 证书（ACME）
│   │   ├── cf_ipopt.go              # IP 优选调度
│   │   ├── mihomo.go                # Mihomo 核心管理
│   │   ├── geo.go                   # GeoIP 数据库
│   │   ├── traffic_stats.go         # 流量统计聚合
│   │   ├── traffic_live.go          # 实时流量 WebSocket
│   │   ├── traffic_limit.go         # 流量限额执行
│   │   ├── traffic_threshold.go     # 流量阈值告警
│   │   ├── telegram_bot.go          # Telegram 通知机器人
│   │   ├── logs.go                  # 日志管理
│   │   ├── cert.go                  # 证书工具
│   │   ├── auto_update.go           # 自动更新调度
│   │   ├── update_check.go          # 版本检查
│   │   └── agent_startup_update.go  # Agent 启动更新检查
│   │
│   └── version/                     # 版本信息
│       └── version.go               # 编译时注入的版本号
│
└── templates/                       # HTML 模板
    ├── index.html                   # 主面板页面
    ├── login.html                   # 登录页
    └── components/                  # UI 组件（17 个）
        ├── relay_manager.html       # 中转管理面板
        ├── add_node_modal.html      # 添加节点弹窗
        ├── edit_node_modal.html     # 编辑节点弹窗
        ├── delete_node_modal.html   # 删除确认弹窗
        ├── airport_sub_modal.html   # 机场订阅管理
        ├── cf_modal.html            # Cloudflare 设置
        ├── traffic_stats_panel.html # 流量统计面板
        ├── traffic_stats_panel_v2.html
        ├── system_settings_modal.html
        ├── global_settings_modal.html
        ├── logs_modal.html
        ├── update_modal.html
        ├── install_script_modal.html
        ├── clash_template_modal.html
        ├── custom_rules_modal.html
        ├── sub_links_modal.html
        └── pwd_modal.html
```

---

## 3. 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | Go 1.25+ |
| Web 框架 | net/http (标准库) |
| ORM | GORM v1.31 |
| 数据库 | SQLite (默认) / PostgreSQL |
| WebSocket | nhooyr.io/websocket v1.8 |
| 认证 | JWT (golang-jwt/jwt/v5) + bcrypt |
| 日志 | slog + lumberjack 轮转 |
| 证书 | lego v4 (ACME) |
| GeoIP | oschwald/geoip2 |
| Telegram | go-telegram-bot-api v5 |
| 前端 | 原生 HTML/JS/CSS (Go embed) |

**主要依赖**：
```
gorm.io/gorm               - ORM 框架
github.com/glebarez/sqlite  - SQLite 驱动
nhooyr.io/websocket         - WebSocket
github.com/golang-jwt/jwt/v5 - JWT 令牌
github.com/google/uuid       - UUID 生成
github.com/go-acme/lego/v4  - ACME 证书
github.com/oschwald/geoip2-golang - GeoIP 查询
golang.org/x/crypto          - bcrypt 密码哈希
gopkg.in/yaml.v3             - YAML 解析
gopkg.in/natefinch/lumberjack.v2 - 日志轮转
```

---

## 4. 分层架构

```
┌─────────────────────────────────────────────────┐
│                   前端 (templates/)              │
│          index.html + 17 组件模板                │
│          原生 JS fetch() + WebSocket             │
└──────────────────────┬──────────────────────────┘
                       │ HTTP / WS
┌──────────────────────▼──────────────────────────┐
│              中间件 (middleware/auth.go)          │
│           JWT 校验 · IP 限频 · Cookie 管理       │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              处理层 (internal/server/)            │
│    auth_handler · node_handler · relay_handler   │
│    traffic_handler · cf_handlers · ...           │
│    路由注册 · 请求解析 · 响应格式化               │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              业务层 (internal/service/)           │
│    service.go · relay.go · subscription.go       │
│    cf_tunnel.go · traffic_*.go · links.go        │
│    核心业务逻辑 · 匹配引擎 · 订阅生成            │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              数据层 (internal/database/)          │
│    GORM 模型 · SQLite/PostgreSQL · 自动迁移      │
│    NodePool · RelayServer · ForwardRule          │
│    SysConfig · AirportSub · TrafficStat          │
└─────────────────────────────────────────────────┘
```

**数据流方向**：
- **用户请求**：浏览器 → HTTP → middleware → handler → service → database
- **Agent 上报**：Agent → WebSocket → handler → service → database
- **订阅拉取**：客户端 → /sub/* → subscription_handler → subscription.go → database

---

## 5. 数据库模型

### 5.1 NodePool（节点池）

> 表名：`node_pool`

| 字段 | 类型 | 说明 |
|------|------|------|
| uuid | varchar(36) PK | 节点唯一标识 |
| install_id | varchar(12) UNIQUE | Agent 安装标识 |
| name | varchar(128) | 节点名称 |
| routing_type | int | 1=直连, 2=落地 |
| is_blocked | bool | 是否屏蔽 |
| links | JSON | 协议→链接映射 `{"vmess":"vmess://...","hy2":"hy2://..."}` |
| link_ip_modes | JSON | 各协议 IP 模式 |
| disabled_links | JSON | 已禁用协议列表 |
| ipv4 / ipv6 | varchar(45) | IP 地址 |
| region | varchar(8) | GeoIP 国家码 |
| ip_mode | int | 0=跟随/1=v4/2=v6/3=双栈 |
| sort_index | int | 排序序号 |
| traffic_up / traffic_down | bigint | 当期上下行流量(字节) |
| traffic_limit | bigint | 流量配额(0=无限) |
| traffic_limit_type | string | 计算方式: total/max/min/up/down |
| traffic_threshold_enabled | bool | 启用阈值停机 |
| traffic_threshold_percent | int | 阈值百分比 |
| reset_day | int | 月度重置日(1-31) |
| agent_version | string | Agent 版本号 |
| tunnel_enabled | bool | Tunnel 加速开关 |
| tunnel_id / tunnel_token / tunnel_name / tunnel_domain | string | Tunnel 相关 |
| **relay_generated** | **bool** | **是否由中转规则自动生成** |
| **source_relay_uuid** | **varchar(36)** | **来源中转机 UUID** |
| **source_landing_uuid** | **varchar(36)** | **来源落地节点 UUID** |
| offline_notify_enabled | bool | 离线通知开关 |
| offline_notify_grace_sec | int | 宽限期(秒) |
| created_at / updated_at | datetime | 时间戳 |

### 5.2 RelayServer（中转机）

> 表名：`relay_servers`

| 字段 | 类型 | 说明 |
|------|------|------|
| uuid | varchar(36) PK | 中转机唯一标识 |
| name | varchar(128) | 名称 |
| ip | varchar(45) | IP 地址 |
| mode | int | 1=Agent 模式, 2=手动模式 |
| install_id | varchar(12) UNIQUE | Agent 安装标识 |
| status | int | 0=离线, 1=在线 |
| remark | text | 备注 |
| created_at / updated_at | datetime | 时间戳 |

### 5.3 ForwardRule（转发规则）

> 表名：`forward_rules`

| 字段 | 类型 | 说明 |
|------|------|------|
| uuid | varchar(36) PK | 规则唯一标识 |
| relay_server_uuid | varchar(36) FK | 所属中转机 |
| listen_port | int | 中转机监听端口 |
| target_ip | varchar(45) | 目标 IP |
| target_port | int | 目标端口 |
| matched_node_uuid | varchar(36) | 匹配到的落地节点 UUID |
| matched_protocol | varchar(32) | 匹配到的协议名 |
| status | int | 1=运行中, 2=已停止, 3=手动模式 |
| created_at / updated_at | datetime | 时间戳 |

### 5.4 SysConfig（系统配置）

> 表名：`sys_config`，键值对存储

| 分类 | 示例键 | 说明 |
|------|--------|------|
| 认证 | `admin_username`, `admin_password`, `jwt_secret` | 管理员凭证 |
| 面板 | `panel_url`, `sub_token`, `sub_custom_name` | 面板地址与订阅令牌 |
| 协议端口 | `proxy_port_ss`, `proxy_port_hy2`, `proxy_port_vmess_tcp`... | 各协议监听端口 |
| 协议配置 | `proxy_ss_method`, `proxy_hy2_sni`, `proxy_socks5_user`... | 协议参数 |
| Cloudflare | `cf_email`, `cf_api_key`, `cf_domain`, `cf_tunnel_*` | CF 集成配置 |
| IP 优选 | `cf_ipopt_schedule_interval`, `cf_ipopt_manual_ips` | IP 优选调度 |
| 流量 | `pref_traffic_stats_retention_days` | 流量统计保留天数 |
| Telegram | `tg_bot_enabled`, `tg_bot_token`, `tg_bot_whitelist` | TG 机器人 |
| Clash | `clash_active_modules`, `clash_custom_modules` | Clash 规则模块 |
| 安全 | `login_ip_max_retries`, `login_ip_block_ttl_sec` | 登录安全策略 |

### 5.5 其他表

| 表 | 说明 |
|----|------|
| `node_traffic_stats` | 流量统计记录（按小时/双小时/天聚合） |
| `airport_subs` | 机场订阅信息（URL、流量、到期时间） |
| `airport_nodes` | 机场节点列表（协议、链接、路由类型） |
| `airport_speed_test_histories` | 测速历史批次 |
| `airport_speed_test_results` | 测速结果明细 |

---

## 6. API 路由总览

### 6.1 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/login` | 登录页 |
| GET | `/` | 主面板（需认证） |
| GET | `/logout` | 登出 |
| POST | `/api/change-password` | 改密 |
| POST | `/api/reset-jwt` | 重置 JWT |

### 6.2 节点管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/get-nodes` | 获取节点列表 |
| POST | `/api/add-node` | 添加节点 |
| POST | `/api/update-node` | 更新节点 |
| POST | `/api/delete-node` | 删除节点 |
| POST | `/api/reorder-nodes` | 排序节点 |
| GET/POST | `/api/offline-notify/*` | 离线通知设置 |
| GET/POST | `/api/tunnel-node/*` | Tunnel 节点设置 |

### 6.3 节点控制（Agent 命令）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/node/control/reset-links` | 重置协议链接 |
| POST | `/api/node/control/reinstall-singbox` | 重装 sing-box |
| POST | `/api/node/control/check-agent-update` | 检查 Agent 更新 |
| POST | `/api/node/control/tunnel-start` | 启动 Tunnel |
| POST | `/api/node/control/tunnel-stop` | 停止 Tunnel |
| GET | `/api/node/control/stream` | 命令执行 SSE 流 |
| GET | `/api/node/online-status` | 节点在线状态 |

### 6.4 中转管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/relay/servers` | 中转机列表 |
| POST | `/api/relay/server/add` | 添加中转机 |
| POST | `/api/relay/server/update` | 更新中转机 |
| POST | `/api/relay/server/delete` | 删除中转机 |
| GET | `/api/relay/rules` | 转发规则列表 |
| POST | `/api/relay/rule/add` | 添加转发规则 |
| POST | `/api/relay/rule/update` | 更新转发规则 |
| POST | `/api/relay/rule/delete` | 删除转发规则 |
| POST | `/api/relay/rule/start` | 启动转发(Agent) |
| POST | `/api/relay/rule/stop` | 停止转发(Agent) |
| WS | `/api/callback/relay/ws` | 中转 Agent WebSocket |

### 6.5 流量

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/traffic/landing-nodes` | 落地节点流量 |
| GET | `/api/traffic/series` | 流量时序数据 |
| GET | `/api/traffic/consumption-rank` | 流量排行 |
| WS | `/api/traffic/live` | 实时流量 WebSocket |

### 6.6 订阅分发（公开）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/sub/clash` | Clash Meta 订阅 |
| GET | `/sub/v2ray` | V2Ray Base64 订阅 |
| GET | `/sub/raw/1` | Raw 格式 1 |
| GET | `/sub/raw/2` | Raw 格式 2 |
| GET | `/sub/rules/direct` | 直连规则 |
| GET | `/sub/rules/proxy/` | 代理规则 |

### 6.7 机场订阅

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/airport/list` | 订阅列表 |
| POST | `/api/airport/add` | 添加订阅 |
| POST | `/api/airport/update` | 同步订阅 |
| POST | `/api/airport/delete` | 删除订阅 |
| GET | `/api/airport/nodes` | 节点列表 |
| POST | `/api/airport/test/start` | 开始测速 |
| POST | `/api/airport/test/stop` | 停止测速 |
| GET | `/api/airport/test/history` | 测速历史 |

### 6.8 Cloudflare

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/cf/token/verify` | 验证 Token 权限 |
| POST | `/api/cf/tunnel/create` | 创建 Tunnel |
| POST | `/api/cf/tunnel/run` | 启动 Tunnel |
| POST | `/api/cf/tunnel/stop` | 停止 Tunnel |
| POST | `/api/cf/cert/apply` | 申请 SSL 证书 |
| POST | `/api/cf/ipopt/start` | 启动 IP 优选 |
| GET | `/api/cf/ipopt/result` | 优选结果 |

### 6.9 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/restart` | 热重启 |
| GET | `/api/system-monitor` | 系统监控 |
| GET | `/api/recent-logs` | 最近日志 |
| WS | `/api/recent-logs/stream` | 日志流 |
| GET/POST | `/api/db/*` | 数据库管理 |
| POST | `/api/check-update` | 检查更新 |

### 6.10 Agent 回调（内部）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/callback/report` | Agent 流量上报 |
| WS | `/api/callback/traffic/ws` | Agent WebSocket 通道 |
| GET | `/api/public/install-script` | 安装脚本生成 |

---

## 7. 核心业务流程

### 7.1 节点部署流程

```
管理员添加节点
     │
     ▼
面板生成 install_id + 安装脚本
     │
     ▼
在目标机器执行安装脚本
     │  ┌─ 安装 sing-box (代理核心)
     │  ├─ 安装 nodectl-agent
     │  └─ 写入 /etc/nodectl-agent/config.json
     │
     ▼
nodectl-agent 启动
     │  ┌─ WebSocket 连接到面板 /api/callback/traffic/ws
     │  ├─ 每 N 秒上报 rx/tx 流量
     │  └─ 接收面板下发命令 (reset-links, reinstall, tunnel-start/stop)
     │
     ▼
面板收到首次上报 → 识别 install_id → 节点上线
     │
     ▼
协议链接自动生成/手动配置 → 纳入订阅分发
```

### 7.2 流量监控流程

```
Agent 采集器 (collector.go)
  │  读取 /sys/class/net/{iface}/statistics/{rx,tx}_bytes
  │  计算瞬时速率 (bytes/sec)
  │
  ▼
Reporter (reporter.go)
  │  每 push_interval_sec 上报一次
  │  TrafficMessage { install_id, rx_rate_bps, tx_rate_bps, counter_* }
  │
  ▼ WebSocket
面板 handler (traffic_handler.go)
  │  ├─ 更新 NodePool.TrafficUp/Down
  │  ├─ 写入 NodeTrafficStat (按小时/天聚合)
  │  ├─ 检查流量限额 → 触发阈值停机
  │  └─ 广播到 /api/traffic/live WebSocket 客户端
  │
  ▼
前端实时图表 (traffic_stats_panel_v2.html)
```

### 7.3 节点更新同步

```
管理员更新落地节点 (Links / IP 变更)
     │
     ▼
node_handler.go → apiUpdateNode()
     │
     ├─ 保存到数据库
     │
     └─ if RoutingType == 2 (落地节点):
          go service.SyncByLandingNode(uuid)
               │
               ├─ 查找所有指向此落地节点的 ForwardRule
               ├─ 按 (中转机, 落地节点) 分组
               ├─ 重新解析 Links 中的 IP:Port
               ├─ 替换为中转机 IP + 监听端口
               └─ 更新/创建/删除对应的直连节点 (NodePool)
```

---

## 8. Agent 通信体系

### 8.1 节点 Agent (`nodectl-agent`)

```
Agent                                     面板
  │                                        │
  │──── WebSocket 连接 ──────────────────►│ /api/callback/traffic/ws
  │                                        │
  │──── 身份识别 {install_id} ──────────►│
  │                                        │
  │──── 定时上报 TrafficMessage ────────►│ (每 N 秒)
  │     { install_id, rx_rate, tx_rate,    │
  │       counter_rx, counter_tx,          │
  │       boot_id, agent_version }         │
  │                                        │
  │◄──── 下发命令 ServerCommand ────────│
  │     { type:"command", action:"...",    │
  │       command_id, params... }          │
  │                                        │
  │──── 回传结果 CommandResult ────────►│
  │     { type:"result", command_id,       │
  │       status, output }                 │
```

**支持的命令**：
- `reset-links` - 重新生成协议链接
- `reinstall-singbox` - 重装 sing-box
- `check-agent-update` - 检查 Agent 更新
- `tunnel-start` / `tunnel-stop` - Tunnel 控制

**Agent 特性**：
- 内存限制 5 MiB, GC 10%（轻量级）
- 自动更新 + 崩溃循环检测（5 分钟内 3 次回滚）
- 指数退避重连

### 8.2 中转 Agent (`nodectl-relay-agent`)

```
Relay Agent                                面板
  │                                         │
  │──── WebSocket 连接 ──────────────────►│ /api/callback/relay/ws
  │                                         │
  │──── 身份识别 {install_id} ──────────►│
  │                                         │ relay_agent.go 维护
  │                                         │ connMap[install_id]
  │                                         │
  │◄──── 转发命令 ─────────────────────│
  │     { type:"command",                   │
  │       action:"add-forward",             │
  │       listen_port, target_ip,           │
  │       target_port }                     │
  │                                         │
  │──── 执行 iptables ────────            │
  │     DNAT + MASQUERADE                   │
  │                                         │
  │──── 回传结果 ──────────────────────►│
```

**支持的命令**：
- `add-forward` - 添加 iptables 转发 (TCP+UDP DNAT + MASQUERADE)
- `remove-forward` - 删除 iptables 转发
- `list-forwards` - 列出当前 PREROUTING 规则

---

## 9. 中转系统详解

### 9.1 双模式架构

```
┌──────────────────────────────────────────────────────┐
│                    中转机 (RelayServer)                │
│                                                       │
│  模式 1: Agent 模式                                   │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 安装 nodectl-relay-agent                         │ │
│  │ 面板通过 WebSocket 远程控制 iptables             │ │
│  │ 状态: 运行中(1) / 已停止(2)                      │ │
│  │ 适用: 有 root 权限的中转机                       │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  模式 2: 手动模式                                     │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 用户自行在中转机上配置转发                        │ │
│  │ 面板只记录规则, 不实际执行                        │ │
│  │ 状态: 手动(3)                                     │ │
│  │ 适用: 无 root 权限 / 非 Linux 中转               │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 9.2 匹配引擎

> 代码位置：`internal/service/relay.go`

**核心函数**：`MatchForwardRuleToLandingNode(targetIP, targetPort)`

```
输入: 转发规则的 target_ip + target_port
  │
  ▼
遍历所有 RoutingType==2 的落地节点
  │
  ▼ 对每个落地节点:
  ├─ 检查 IPV4/IPV6 是否 == targetIP
  │
  ├─ 若 IP 匹配, 解析 Links 中每个协议链接:
  │   ├─ VMess: base64 解码 JSON → 取 port 字段
  │   ├─ 其他协议: 解析 URI → 取 host:port
  │   └─ 提取出的端口 == targetPort ?
  │
  ├─ 若匹配 → 返回 (落地节点UUID, 协议名)
  │
  └─ 未匹配 → 继续下一个节点

输出: (matchedNodeUUID, matchedProtocol) 或 ("", "")
```

### 9.3 直连节点同步

> 核心函数：`SyncRelayGeneratedNodes(relayUUID)`

```
                  触发时机
┌──────────────────────────────────────┐
│ · 添加/更新/删除转发规则              │
│ · 更新落地节点 (Links/IP 变更)        │
│ · 更新中转机 (IP 变更)               │
│ · 删除落地节点 (清理)                 │
│ · 程序启动 (全量同步)                 │
└──────────────────┬───────────────────┘
                   │
                   ▼
     获取中转机信息 + 该中转机所有转发规则
                   │
                   ▼
     按 matched_node_uuid 分组
     (多条规则可能指向同一落地节点)
                   │
                   ▼
     对每组 (中转机, 落地节点):
     ┌─────────────────────────────────┐
     │ 1. 获取落地节点的 Links          │
     │ 2. 遍历该组所有规则:             │
     │    对每个匹配的协议链接:          │
     │    ├─ 替换 IP → 中转机 IP        │
     │    └─ 替换 Port → 监听端口       │
     │ 3. 合并所有改写后的链接           │
     │ 4. 查找已有直连节点:             │
     │    (source_relay_uuid + source_landing_uuid) │
     │ 5. 存在 → 更新 Links             │
     │    不存在 → 创建新 NodePool       │
     │    命名: "[中转机名] 落地节点名"  │
     └─────────────────────────────────┘
                   │
                   ▼
     清理: 删除不再有规则匹配的直连节点
```

### 9.4 节点命名规则

```
直连节点名称 = "[中转机名称] 落地节点名称"

例:
  中转机: "香港HKT"
  落地节点: "东京NTT"
  生成: "[香港HKT] 东京NTT"
```

### 9.5 iptables 转发规则

```bash
# Agent 执行的 iptables 命令

# 启用 IP 转发
sysctl -w net.ipv4.ip_forward=1

# TCP DNAT (入站流量重定向)
iptables -t nat -A PREROUTING -p tcp --dport {listen_port} \
  -j DNAT --to-destination {target_ip}:{target_port}

# UDP DNAT
iptables -t nat -A PREROUTING -p udp --dport {listen_port} \
  -j DNAT --to-destination {target_ip}:{target_port}

# MASQUERADE (回程流量源地址伪装)
iptables -t nat -A POSTROUTING -d {target_ip} -j MASQUERADE
```

### 9.6 转发规则状态机

```
添加规则
  │
  ├─ Agent 模式 (relay.Mode==1):
  │    status = 2 (已停止)
  │    │
  │    ├── 点击"启动" → Agent 执行 add-forward → status = 1 (运行中)
  │    └── 点击"停止" → Agent 执行 remove-forward → status = 2 (已停止)
  │
  └─ 手动模式 (relay.Mode==2):
       status = 3 (手动)
       (面板不控制实际转发, 仅记录)
```

---

## 10. 订阅生成流程

### 10.1 订阅格式

| 端点 | 格式 | 说明 |
|------|------|------|
| `/sub/clash` | Clash Meta YAML | 含代理组、规则、DNS |
| `/sub/v2ray` | Base64 编码链接列表 | 每行一个协议链接 |
| `/sub/raw/1` | 纯链接列表 | 原始协议链接 |
| `/sub/raw/2` | 纯链接列表(备选) | 同上 |

### 10.2 生成流程

```
客户端请求 /sub/clash?token=xxx
     │
     ▼
subscription_handler.go
     │  验证 sub_token
     │
     ▼
subscription.go → GenerateClashConfig()
     │
     ├─ 1. 获取所有可用节点 (未屏蔽 + 已启用链接)
     │     包括: 直连节点 + 中转生成的直连节点 + 机场节点
     │
     ├─ 2. 对每个节点的每个协议链接:
     │     ├─ 检查 IP 模式 (IPv4/IPv6/双栈)
     │     ├─ 检查优选 IP (若启用 cf_ipopt → 替换地址)
     │     └─ ParseLinkToClashNode() → 转为 Clash 代理节点
     │
     ├─ 3. 构建代理组
     │     ├─ "Proxy" 选择组 (所有节点)
     │     ├─ "Auto" 自动测速组
     │     └─ 自定义分组 (按标签/地区)
     │
     ├─ 4. 加载规则模块
     │     ├─ 内置规则集
     │     └─ 自定义规则 (clash_custom_proxy_rules)
     │
     └─ 5. 输出 YAML
```

### 10.3 支持的协议

```
VMess:    vmess_tcp, vmess_ws, vmess_http, vmess_quic, vmess_wst, vmess_hut
VLESS:    vless, vless_wst, vless_hut
Trojan:   trojan, trojan_wst, trojan_hut
其他:     ss, hy2, tuic, socks5, anytls, ssr
```

### 10.4 链接格式

```
VMess:   vmess://base64({json: {v,ps,add,port,id,aid,net,type,host,path,tls}})
VLESS:   vless://uuid@host:port?security=...&type=...#name
Trojan:  trojan://password@host:port?security=...#name
SS:      ss://base64(method:password)@host:port#name
HY2:     hy2://password@host:port?sni=...#name
TUIC:    tuic://uuid:password@host:port?...#name
```

---

## 11. Cloudflare 集成

### 11.1 模块概览

```
┌─────────────────────────────────────────────┐
│                Cloudflare 集成               │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Tunnel   │ │ SSL/TLS  │ │ IP 优选      │ │
│  │ 隧道管理  │ │ 证书管理  │ │ CloudflareST │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
│                                              │
│  cf_tunnel.go  cf_cert.go   cf_ipopt.go     │
└─────────────────────────────────────────────┘
```

### 11.2 Tunnel 流程

```
验证 CF Token → 创建 Tunnel → 绑定 DNS CNAME
     │
     ▼
下载 cloudflared → 生成配置 → 启动进程
     │
     ▼
节点级 Tunnel:
  为每个落地节点单独创建 Tunnel
  配置 ingress 规则映射到本地协议端口
```

### 11.3 IP 优选

```
下载 CloudflareST 工具 → 延迟测试 + 速度测试
     │
     ▼
结果排序 → 选取最优 IP → 替换订阅中的地址
     │
     ▼
手动 IP 列表: 允许手动添加/管理优选 IP
定时调度: 按配置间隔自动执行
```

---

## 12. 前端模板结构

### 12.1 渲染方式

- 使用 Go `html/template` + `embed.FS`
- 模板在编译时嵌入二进制
- `index.html` 通过 `{{template "xxx.html" .}}` 引入 17 个组件

### 12.2 组件列表

| 组件 | 功能 |
|------|------|
| `relay_manager.html` | 中转管理（紫色主题 #6c5ce7） |
| `add_node_modal.html` | 添加节点弹窗 |
| `edit_node_modal.html` | 编辑节点弹窗 |
| `delete_node_modal.html` | 删除确认 |
| `airport_sub_modal.html` | 机场订阅管理 |
| `cf_modal.html` | Cloudflare 设置 |
| `traffic_stats_panel_v2.html` | 流量统计图表 |
| `system_settings_modal.html` | 系统设置 |
| `global_settings_modal.html` | 全局设置 |
| `logs_modal.html` | 日志查看器 |
| `update_modal.html` | 更新管理 |
| `install_script_modal.html` | 安装脚本 |
| `clash_template_modal.html` | Clash 模板 |
| `custom_rules_modal.html` | 自定义规则 |
| `sub_links_modal.html` | 订阅链接 |
| `pwd_modal.html` | 修改密码 |

### 12.3 前端通信

```javascript
// REST API 调用
fetch('/api/relay/servers')
  .then(r => r.json())
  .then(data => renderRelayServers(data.data.servers))

// WebSocket 实时数据
const ws = new WebSocket('ws://host/api/traffic/live')
ws.onmessage = (e) => updateTrafficChart(JSON.parse(e.data))
```

---

## 13. 配置体系

### 13.1 面板配置

```
data/dbconfig.json    - 数据库连接配置
data/nodectl.db       - SQLite 数据库文件
sys_config 表         - 100+ 运行时配置键
```

### 13.2 Agent 配置

```json
// /etc/nodectl-agent/config.json
{
  "install_id": "abc123def456",
  "ws_url": "ws://panel.example.com:8080/api/callback/traffic/ws",
  "ws_push_interval_sec": 2,
  "interface": "auto",
  "log_level": "info"
}
```

### 13.3 中转 Agent 配置

```json
// /etc/nodectl-relay-agent/config.json
{
  "install_id": "relay001abc",
  "ws_url": "ws://panel.example.com:8080/api/callback/relay/ws",
  "log_level": "info"
}
```

---

## 14. 构建与部署

### 14.1 编译

```bash
# 面板主程序
cd /root/claude/nodectl
go build -o nodectl .

# 节点 Agent
go build -o nodectl-agent ./cmd/nodectl-agent/

# 中转 Agent
go build -o nodectl-relay-agent ./cmd/nodectl-relay-agent/
```

### 14.2 运行

```bash
# 面板 (默认 :8080)
./nodectl

# Agent (部署在节点机器上)
./nodectl-agent -config /etc/nodectl-agent/config.json

# 中转 Agent (部署在中转机上)
./nodectl-relay-agent -config /etc/nodectl-relay-agent/config.json
```

### 14.3 数据持久化

```
data/nodectl.db      - SQLite 数据库
data/dbconfig.json   - 数据库配置
data/certs/          - TLS 证书
/var/log/nodectl.log - 面板日志
/var/log/nodectl-agent.log - Agent 日志
```

### 14.4 热重启

面板支持热重启（`/api/restart`），通过 `exec.Command` 重新启动自身进程，保持数据库连接和 WebSocket 会话的优雅过渡。

---

## 附：数据流全景图

```
                    ┌─────────────┐
                    │   浏览器     │
                    │  (管理员)    │
                    └──────┬──────┘
                           │ HTTP / WS
                    ┌──────▼──────┐
                    │   面板主程序  │
                    │  (nodectl)  │
                    │  :8080      │
                    └──┬───┬───┬──┘
                       │   │   │
           ┌───────────┘   │   └───────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │  节点 Agent  │ │ 中转 Agent  │ │ 订阅客户端  │
    │ (落地/直连)  │ │ (中转机)    │ │ (Clash等)   │
    │             │ │             │ │             │
    │ 流量采集     │ │ iptables   │ │ /sub/clash  │
    │ 命令执行     │ │ 转发控制    │ │ /sub/v2ray  │
    └─────────────┘ └─────────────┘ └─────────────┘

    ┌────────────────────────────────────────────────┐
    │                  SQLite / PostgreSQL             │
    │                                                  │
    │  node_pool · relay_servers · forward_rules      │
    │  sys_config · airport_subs · traffic_stats      │
    └────────────────────────────────────────────────┘
```

---

*文档生成时间: 2026-03-13*
