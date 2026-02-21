# NodeCtl

> 一个轻量、高效的个人订阅与自建节点管理面板。

## 📖 项目简介
NodeCtl 旨在提供一个简洁直观的 Web 界面和稳定安全的 Golang 后台，帮助你集中管理**自建节点**和**机场订阅**。通过默认参数的优化，在保证设置不过于复杂的前提下，既直观易用，又拥有极高的自定义分流与组网能力。

## ✨ 核心特性

### 1. 🚀 自建节点全自动化管理
- **一键安装脚本**：内置节点一键安装脚本，部署节点仅需在 VPS 复制执行一行命令，即可自动配置装机并回传链接到面板。
- **流量与运行监控**：支持自动获取节点的上传/下载流量、流量限额与到期重置日等，实时掌握节点使用状况。
- **协议支持**：支持主流高强度协议。内置 Sing-box 运行环境，下发模板高度可自定义。

### 2. 🛩️ 机场订阅聚合与清洗
- **多格式导入**：支持一键导入多种格式的机场订阅（Clash YAML, Base64 等）自动解析。
- **失效/广告节点过滤**：内置智能防伪过滤引擎，自动通过正则与关键库识别并过滤掉“到期提醒”、“剩余流量”、“官网”等无效占位节点。
- **全自动极速测速**：面板内置 Mihomo (Clash Meta) 调度核心，支持对机场节点进行批量并发真连接测速，WebUI 实时流式传输 (SSE) 测速结果，毫秒级响应。
- **灵活的高级路由调度**：支持将机场节点加入到自建订阅中，允许用户自定义分配每一个机场节点是作为“直连”、“落地”还是“禁用”。

### 3. 🛡️ 智能客户端配置分发
- **多客户端兼容订阅**：面板提供你的专属一键订阅链接，可直接生成并下发 Clash (Meta)、V2Ray/Sing-box (Base64) 等多端订阅格式。
- **自定义分流规则处理**：面板自带可视化自定义直连/代理规则组编辑器，支持集成最新的 GeoIP / Geosite 数据，客户端订阅自带极佳的国内外智能分流。

### 4. ⚙️ 系统与轻量化架构
- **零依赖部署**：后端采用纯 Golang 驱动，搭配嵌入式 SQLite (GORM) 数据库与内嵌 Web 静态资源。拒绝臃肿，极速即开即用。
- **自动 HTTPS 与安全模块**：内置 Cloudflare API 自动签发续签 SSL 证书机制，同时也支持无缝手动传入证书文件。面板由 JWT 令牌保障安全。
- **系统级看板**：主页面板实时监控 CPU、内存分配、Go 协程数统计以及长期运行状态。

---

## 🎨 演示 (Demo)

🔗 **[https://demo.hobin.net/](https://demo.hobin.net/)**

> 账号: `admin`  
> 密码: `admin`  
> *(注: 为保障公共环境安全，演示环境已进入只读演示模式，屏蔽了核心增删与重启操作)*

## 🚀 快速部署

我们推荐使用 Docker 进行部署，这是服务器上最整洁、快捷的部署方案。

### 方式一：Docker Run (快捷命令)

你可以直接运行以下命令拉取并启动容器：

```bash
docker run -d \
  --name nodectl \
  --restart unless-stopped \
  -p 7878:8080 \
  -v /opt/nodectl/data:/app/data \
  ghcr.io/hobin66/nodectl:latest
```

*部署成功后访问 `http://你的IP:7878` 即可加载控制台。*

### 方式二：Docker Compose

如有需要，创建 `docker-compose.yml` 并在同目录下运行 `docker-compose up -d`：

```yaml
version: '3'
services:
  nodectl:
    image: ghcr.io/hobin66/nodectl:latest
    container_name: nodectl
    restart: unless-stopped
    ports:
      - "7878:8080"
    volumes:
      - ./data:/app/data
```

## 💡 高级设置

### 模板与脚本重写 (Override)
NodeCtl 的默认内置安装脚本位于源码中的 `internal/service/singbox.tpl` 等位置。如想替换内置脚本、修改分流模板进行独立适配，可以在宿主机暴露的 `/app/data/debug` (`./data/debug`) 目录中新建同名文件。系统启动时会优先读取并覆盖该处的个性化模板文件。

## 🤝 鸣谢与声明

1. 本项目引用了许多开源工具与库，包括但不限于 Mihomo 测试核心调度逻辑、高效率的路由规则组等。内置部署脚本初版修改自 [caigouzi121380/singbox-deploy](https://github.com/caigouzi121380/singbox-deploy)。在此深表感谢。
2. 本项目所有代码及构建发布流程皆在 GitHub 完全开源，欢迎 Review 代码并提交 PR。
3. 请在遵循您所在国家与地区相关法律法规的前提下使用本项目，作者不对任何滥用行为承担责任。
