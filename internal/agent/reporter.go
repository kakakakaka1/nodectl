// 路径: internal/agent/reporter.go
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

// TrafficMessage WebSocket 上报消息结构（动态 JSON）
type TrafficMessage struct {
	InstallID string `json:"install_id"`
	TS        int64  `json:"ts"`
	RXRateBps int64  `json:"rx_rate_bps"`
	TXRateBps int64  `json:"tx_rate_bps"`
	// 可选字段：仅在快照消息中包含
	RXBytes *int64 `json:"rx_bytes,omitempty"`
	TXBytes *int64 `json:"tx_bytes,omitempty"`
}

// ServerCommand 后端下发的命令结构
type ServerCommand struct {
	Type      string          `json:"type"`       // 固定 "command"
	CommandID string          `json:"command_id"` // 幂等键
	Action    string          `json:"action"`     // "reset-links" / "reinstall-singbox"
	Payload   json.RawMessage `json:"payload,omitempty"`
}

// CommandResult Agent 回传命令执行结果
type CommandResult struct {
	Type      string `json:"type"` // "accepted" / "progress" / "result"
	CommandID string `json:"command_id"`
	Status    string `json:"status,omitempty"` // "ok" / "error"
	Message   string `json:"message,omitempty"`
	Stage     string `json:"stage,omitempty"` // 执行阶段描述
}

// CommandHandler 命令处理函数签名
type CommandHandler func(cmd ServerCommand, reply func(CommandResult))

// Reporter WebSocket 上报器
type Reporter struct {
	mu              sync.Mutex
	cfg             *Config
	conn            *websocket.Conn
	connected       bool
	reconnectCount  int
	maxBackoff      time.Duration
	lastConnectedAt time.Time
	commandHandler  CommandHandler
	readCtxCancel   context.CancelFunc
}

// NewReporter 创建上报器实例
func NewReporter(cfg *Config) *Reporter {
	return &Reporter{
		cfg:        cfg,
		maxBackoff: 60 * time.Second,
	}
}

// SetCommandHandler 注册命令处理器（应在 Connect 前调用）
func (r *Reporter) SetCommandHandler(handler CommandHandler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.commandHandler = handler
}

// Connect 建立 WebSocket 连接（带超时）
func (r *Reporter) Connect(ctx context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(dialCtx, r.cfg.WSURL, &websocket.DialOptions{
		Subprotocols: []string{"nodectl-agent"},
	})
	if err != nil {
		r.connected = false
		return fmt.Errorf("WebSocket 连接失败 [%s]: %w", r.cfg.WSURL, err)
	}

	// 关闭旧连接和读协程，防止泄漏
	if r.readCtxCancel != nil {
		r.readCtxCancel()
		r.readCtxCancel = nil
	}
	if r.conn != nil {
		r.conn.Close(websocket.StatusGoingAway, "reconnecting")
		r.conn = nil
	}

	r.conn = conn
	r.connected = true
	r.reconnectCount = 0
	r.lastConnectedAt = time.Now()

	// 启动读协程（接收服务端下发的命令）
	readCtx, readCancel := context.WithCancel(ctx)
	r.readCtxCancel = readCancel
	go r.startReadLoop(readCtx, conn)

	log.Printf("[Agent] WebSocket 已连接: %s", r.cfg.WSURL)
	return nil
}

// startReadLoop 读取后端下发的消息（命令）
func (r *Reporter) startReadLoop(ctx context.Context, conn *websocket.Conn) {
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return // 上下文取消，正常退出
			}
			log.Printf("[Agent] WS 读取异常: %v", err)
			r.mu.Lock()
			r.connected = false
			r.mu.Unlock()
			return
		}

		// 尝试解析命令
		var rawMsg map[string]interface{}
		if err := json.Unmarshal(data, &rawMsg); err != nil {
			continue
		}

		msgType, _ := rawMsg["type"].(string)
		if msgType != "command" {
			continue
		}

		var cmd ServerCommand
		if err := json.Unmarshal(data, &cmd); err != nil {
			log.Printf("[Agent] 命令解析失败: %v", err)
			continue
		}

		log.Printf("[Agent] 收到命令: action=%s, command_id=%s", cmd.Action, cmd.CommandID)

		r.mu.Lock()
		handler := r.commandHandler
		r.mu.Unlock()

		if handler == nil {
			log.Printf("[Agent] 未注册命令处理器，忽略命令 %s", cmd.CommandID)
			continue
		}

		// 创建回复函数
		replyFunc := func(result CommandResult) {
			result.CommandID = cmd.CommandID
			r.sendResult(ctx, result)
		}

		// 异步执行命令
		go handler(cmd, replyFunc)
	}
}

// sendResult 发送命令结果回服务端
func (r *Reporter) sendResult(ctx context.Context, result CommandResult) {
	r.mu.Lock()
	conn := r.conn
	connected := r.connected
	r.mu.Unlock()

	if !connected || conn == nil {
		log.Printf("[Agent] 无法回传命令结果，连接已断开: %s", result.CommandID)
		return
	}

	data, err := json.Marshal(result)
	if err != nil {
		log.Printf("[Agent] 命令结果序列化失败: %v", err)
		return
	}

	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := conn.Write(writeCtx, websocket.MessageText, data); err != nil {
		log.Printf("[Agent] 命令结果发送失败: %v", err)
	}
}

// SendRateMessage 发送实时速率消息 (每 2 秒)
func (r *Reporter) SendRateMessage(ctx context.Context, rxRate, txRate int64) error {
	msg := TrafficMessage{
		InstallID: r.cfg.InstallID,
		TS:        time.Now().Unix(),
		RXRateBps: rxRate,
		TXRateBps: txRate,
	}
	return r.sendJSON(ctx, msg)
}

// SendSnapshotMessage 发送快照消息：实时速率 + 累计流量 (每 5 分钟)
func (r *Reporter) SendSnapshotMessage(ctx context.Context, rxRate, txRate, rxBytes, txBytes int64) error {
	msg := TrafficMessage{
		InstallID: r.cfg.InstallID,
		TS:        time.Now().Unix(),
		RXRateBps: rxRate,
		TXRateBps: txRate,
		RXBytes:   &rxBytes,
		TXBytes:   &txBytes,
	}
	return r.sendJSON(ctx, msg)
}

// sendJSON 内部方法：序列化并发送 JSON 消息
func (r *Reporter) sendJSON(ctx context.Context, msg TrafficMessage) error {
	r.mu.Lock()
	conn := r.conn
	connected := r.connected
	r.mu.Unlock()

	if !connected || conn == nil {
		return fmt.Errorf("WebSocket 未连接")
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("序列化消息失败: %w", err)
	}

	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := conn.Write(writeCtx, websocket.MessageText, data); err != nil {
		r.mu.Lock()
		r.connected = false
		r.mu.Unlock()
		return fmt.Errorf("WebSocket 写入失败: %w", err)
	}

	return nil
}

// Close 关闭 WebSocket 连接
func (r *Reporter) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.readCtxCancel != nil {
		r.readCtxCancel()
		r.readCtxCancel = nil
	}
	if r.conn != nil {
		r.conn.Close(websocket.StatusNormalClosure, "agent shutting down")
		r.conn = nil
		r.connected = false
	}
}

// IsConnected 检查连接状态
func (r *Reporter) IsConnected() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.connected
}

// ReconnectWithBackoff 指数退避重连
// 退避策略：1s → 2s → 4s → ... 上限 60s + 随机抖动
func (r *Reporter) ReconnectWithBackoff(ctx context.Context) error {
	r.mu.Lock()
	r.reconnectCount++
	count := r.reconnectCount
	r.mu.Unlock()

	// 计算退避时间
	backoff := time.Duration(1<<uint(count-1)) * time.Second
	if backoff > r.maxBackoff {
		backoff = r.maxBackoff
	}
	// 添加随机抖动 (0-25% 的退避时间)
	jitter := time.Duration(rand.Int63n(int64(backoff) / 4))
	backoff += jitter

	log.Printf("[Agent] 第 %d 次重连，等待 %v ...", count, backoff)

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(backoff):
	}

	return r.Connect(ctx)
}
