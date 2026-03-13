package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand/v2"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"nhooyr.io/websocket"
)

// RelayConfig 中转 Agent 配置
type RelayConfig struct {
	InstallID string `json:"install_id"` // 中转机唯一标识
	WSURL     string `json:"ws_url"`     // 面板 WebSocket 地址
	LogLevel  string `json:"log_level"`  // 日志等级
}

// ServerCommand 面板下发的命令
type ServerCommand struct {
	Type       string `json:"type"`
	CommandID  string `json:"command_id"`
	Action     string `json:"action"` // "add-forward" / "remove-forward" / "list-forwards"
	ListenPort int    `json:"listen_port,omitempty"`
	TargetIP   string `json:"target_ip,omitempty"`
	TargetPort int    `json:"target_port,omitempty"`
}

// CommandResult 回传结果
type CommandResult struct {
	Type      string `json:"type"`
	CommandID string `json:"command_id"`
	Status    string `json:"status"`
	Message   string `json:"message"`
}

const defaultConfigPath = "/etc/nodectl-relay-agent/config.json"

func main() {
	configPath := flag.String("config", defaultConfigPath, "配置文件路径")
	showVersion := flag.Bool("version", false, "显示版本号")
	flag.Parse()

	if *showVersion {
		fmt.Println("nodectl-relay-agent v0.1.0")
		os.Exit(0)
	}

	log.SetFlags(log.Ldate | log.Ltime)

	// 日志文件
	logPath := "/var/log/nodectl-relay-agent.log"
	if dir := filepath.Dir(logPath); dir != "" {
		os.MkdirAll(dir, 0755)
	}
	if lf, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644); err == nil {
		log.SetOutput(io.MultiWriter(os.Stdout, lf))
	}

	// 加载配置
	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatalf("[RelayAgent] 加载配置失败: %v", err)
	}

	log.Printf("[RelayAgent] 已加载配置: install_id=%s, ws_url=%s", cfg.InstallID, cfg.WSURL)

	// 信号处理
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		sig := <-sigCh
		log.Printf("[RelayAgent] 收到信号 %v，正在退出...", sig)
		cancel()
	}()

	// 主循环：连接 + 重连
	run(ctx, cfg)
}

func loadConfig(path string) (*RelayConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置文件失败 [%s]: %w", path, err)
	}

	var cfg RelayConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("解析配置文件失败: %w", err)
	}

	if strings.TrimSpace(cfg.InstallID) == "" {
		return nil, fmt.Errorf("install_id 不能为空")
	}
	if strings.TrimSpace(cfg.WSURL) == "" {
		return nil, fmt.Errorf("ws_url 不能为空")
	}

	return &cfg, nil
}

func run(ctx context.Context, cfg *RelayConfig) {
	reconnectCount := 0
	maxBackoff := 60 * time.Second

	for {
		if ctx.Err() != nil {
			return
		}

		conn, err := connect(ctx, cfg)
		if err != nil {
			reconnectCount++
			backoff := time.Duration(1<<uint(reconnectCount-1)) * time.Second
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
			backoff += time.Duration(rand.IntN(int(backoff/4) + 1))
			log.Printf("[RelayAgent] 连接失败 (第%d次): %v, 等待 %v 后重试", reconnectCount, err, backoff)

			timer := time.NewTimer(backoff)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
			continue
		}

		reconnectCount = 0
		log.Printf("[RelayAgent] 已连接到面板")

		// 发送身份识别消息
		identity := map[string]string{"install_id": cfg.InstallID}
		identityData, _ := json.Marshal(identity)
		writeCtx, writeCancel := context.WithTimeout(ctx, 5*time.Second)
		conn.Write(writeCtx, websocket.MessageText, identityData)
		writeCancel()

		// 消息循环
		handleMessages(ctx, conn, cfg)

		log.Printf("[RelayAgent] 连接断开，准备重连...")
		time.Sleep(1 * time.Second)
	}
}

func connect(ctx context.Context, cfg *RelayConfig) (*websocket.Conn, error) {
	dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(dialCtx, cfg.WSURL, &websocket.DialOptions{
		Subprotocols: []string{"nodectl-relay-agent"},
	})
	if err != nil {
		return nil, err
	}
	return conn, nil
}

func handleMessages(ctx context.Context, conn *websocket.Conn, cfg *RelayConfig) {
	defer conn.Close(websocket.StatusNormalClosure, "closing")

	for {
		readCtx, readCancel := context.WithTimeout(ctx, 120*time.Second)
		_, data, err := conn.Read(readCtx)
		readCancel()

		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("[RelayAgent] 读取消息失败: %v", err)
			return
		}

		var cmd ServerCommand
		if err := json.Unmarshal(data, &cmd); err != nil {
			continue
		}

		if cmd.Type != "command" {
			continue
		}

		log.Printf("[RelayAgent] 收到命令: action=%s, command_id=%s", cmd.Action, cmd.CommandID)

		// 执行命令
		result := executeCommand(cmd)
		result.CommandID = cmd.CommandID

		resultData, _ := json.Marshal(result)
		writeCtx, writeCancel := context.WithTimeout(ctx, 5*time.Second)
		conn.Write(writeCtx, websocket.MessageText, resultData)
		writeCancel()
	}
}

func executeCommand(cmd ServerCommand) CommandResult {
	switch cmd.Action {
	case "add-forward":
		return addForward(cmd.ListenPort, cmd.TargetIP, cmd.TargetPort)
	case "remove-forward":
		return removeForward(cmd.ListenPort, cmd.TargetIP, cmd.TargetPort)
	case "list-forwards":
		return listForwards()
	default:
		return CommandResult{Type: "result", Status: "error", Message: "未知命令: " + cmd.Action}
	}
}

// ------------------- [iptables 操作] -------------------

func addForward(listenPort int, targetIP string, targetPort int) CommandResult {
	targetAddr := fmt.Sprintf("%s:%d", targetIP, targetPort)
	listenStr := fmt.Sprintf("%d", listenPort)

	// 启用 IP 转发
	runCmd("sysctl", "-w", "net.ipv4.ip_forward=1")

	// 添加 DNAT 规则（先检查是否已存在）
	checkDNAT := exec.Command("iptables", "-t", "nat", "-C", "PREROUTING",
		"-p", "tcp", "--dport", listenStr,
		"-j", "DNAT", "--to-destination", targetAddr)
	if checkDNAT.Run() != nil {
		// 不存在，添加 TCP DNAT
		if out, err := runCmd("iptables", "-t", "nat", "-A", "PREROUTING",
			"-p", "tcp", "--dport", listenStr,
			"-j", "DNAT", "--to-destination", targetAddr); err != nil {
			return CommandResult{Type: "result", Status: "error", Message: "添加 TCP DNAT 失败: " + out}
		}
	}

	// UDP DNAT
	checkUDP := exec.Command("iptables", "-t", "nat", "-C", "PREROUTING",
		"-p", "udp", "--dport", listenStr,
		"-j", "DNAT", "--to-destination", targetAddr)
	if checkUDP.Run() != nil {
		if out, err := runCmd("iptables", "-t", "nat", "-A", "PREROUTING",
			"-p", "udp", "--dport", listenStr,
			"-j", "DNAT", "--to-destination", targetAddr); err != nil {
			return CommandResult{Type: "result", Status: "error", Message: "添加 UDP DNAT 失败: " + out}
		}
	}

	// 添加 MASQUERADE（确保回程流量正确）
	checkMASQ := exec.Command("iptables", "-t", "nat", "-C", "POSTROUTING",
		"-d", targetIP,
		"-j", "MASQUERADE")
	if checkMASQ.Run() != nil {
		runCmd("iptables", "-t", "nat", "-A", "POSTROUTING",
			"-d", targetIP,
			"-j", "MASQUERADE")
	}

	log.Printf("[RelayAgent] 转发已添加: :%d → %s", listenPort, targetAddr)
	return CommandResult{Type: "result", Status: "ok", Message: fmt.Sprintf("转发已添加: :%d → %s", listenPort, targetAddr)}
}

func removeForward(listenPort int, targetIP string, targetPort int) CommandResult {
	targetAddr := fmt.Sprintf("%s:%d", targetIP, targetPort)
	listenStr := fmt.Sprintf("%d", listenPort)

	// 删除 TCP DNAT
	runCmd("iptables", "-t", "nat", "-D", "PREROUTING",
		"-p", "tcp", "--dport", listenStr,
		"-j", "DNAT", "--to-destination", targetAddr)

	// 删除 UDP DNAT
	runCmd("iptables", "-t", "nat", "-D", "PREROUTING",
		"-p", "udp", "--dport", listenStr,
		"-j", "DNAT", "--to-destination", targetAddr)

	log.Printf("[RelayAgent] 转发已移除: :%d → %s", listenPort, targetAddr)
	return CommandResult{Type: "result", Status: "ok", Message: fmt.Sprintf("转发已移除: :%d → %s", listenPort, targetAddr)}
}

func listForwards() CommandResult {
	out, err := runCmd("iptables", "-t", "nat", "-L", "PREROUTING", "-n", "--line-numbers")
	if err != nil {
		return CommandResult{Type: "result", Status: "error", Message: "查询失败: " + out}
	}
	return CommandResult{Type: "result", Status: "ok", Message: out}
}

func runCmd(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	output, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(output)), err
}
