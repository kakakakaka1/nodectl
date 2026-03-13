package service

import (
	"fmt"
	"strings"

	"nodectl/internal/database"
)

// RenderRelayInstallScript 生成中转机 gost 安装脚本
func RenderRelayInstallScript(relay database.RelayServer) string {
	var sb strings.Builder

	sb.WriteString(`#!/bin/bash
set -e

# ============================================================
#  NodeCTL 中转机部署脚本 (gost)
#  自动下载并配置 gost 端口转发服务
# ============================================================

`)
	sb.WriteString(fmt.Sprintf("API_PORT=%d\n", relay.ApiPort))
	sb.WriteString(fmt.Sprintf("API_USER=\"gost\"\n"))
	sb.WriteString(fmt.Sprintf("API_PASS=\"%s\"\n", relay.ApiSecret))
	sb.WriteString(fmt.Sprintf("GOST_VERSION=\"3.0.0\"\n"))

	sb.WriteString(`
# ---- 颜色输出 ----
info()  { echo -e "\033[32m[INFO]\033[0m $1"; }
warn()  { echo -e "\033[33m[WARN]\033[0m $1"; }
err()   { echo -e "\033[31m[ERR]\033[0m $1"; exit 1; }

# ---- 检测 root ----
[ "$(id -u)" -ne 0 ] && err "请使用 root 用户运行此脚本"

# ---- 检测架构 ----
ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64)  ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    armv7*)        ARCH="armv7" ;;
    *)             err "不支持的架构: $ARCH" ;;
esac
info "系统架构: $ARCH"

# ---- 停止旧服务 ----
if systemctl is-active --quiet gost 2>/dev/null; then
    info "停止旧的 gost 服务..."
    systemctl stop gost
fi

# ---- 下载 gost ----
DOWNLOAD_URL="https://github.com/go-gost/gost/releases/download/v${GOST_VERSION}/gost_${GOST_VERSION}_linux_${ARCH}.tar.gz"
info "正在下载 gost v${GOST_VERSION} ..."
TMP_DIR=$(mktemp -d)
cd "$TMP_DIR"

if command -v wget &>/dev/null; then
    wget -q --show-progress -O gost.tar.gz "$DOWNLOAD_URL" || err "下载失败"
elif command -v curl &>/dev/null; then
    curl -fSL -o gost.tar.gz "$DOWNLOAD_URL" || err "下载失败"
else
    err "需要 wget 或 curl"
fi

tar xzf gost.tar.gz
cp gost /usr/local/bin/gost
chmod +x /usr/local/bin/gost
cd / && rm -rf "$TMP_DIR"

info "gost 已安装到 /usr/local/bin/gost"
/usr/local/bin/gost -V 2>/dev/null || true

# ---- 创建配置文件 ----
mkdir -p /etc/gost
cat > /etc/gost/config.yaml <<EOF
api:
  addr: ":${API_PORT}"
  auth:
    username: "${API_USER}"
    password: "${API_PASS}"
EOF

info "配置文件已写入 /etc/gost/config.yaml (API 端口: ${API_PORT})"

# ---- 创建 systemd 服务 ----
cat > /etc/systemd/system/gost.service <<EOF
[Unit]
Description=GO Simple Tunnel (gost)
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/gost -C /etc/gost/config.yaml
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable gost
systemctl start gost

# ---- 验证 ----
sleep 1
if systemctl is-active --quiet gost; then
    info "gost 服务已启动！"
    info "API 地址: http://0.0.0.0:${API_PORT}"
    info "部署完成，请回到面板点击「检测状态」确认连接。"
else
    warn "gost 服务启动失败，请检查日志: journalctl -u gost -n 20"
fi
`)

	return sb.String()
}
