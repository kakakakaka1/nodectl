package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"nodectl/internal/database"
	"nodectl/internal/logger"

	"nhooyr.io/websocket"
)

// ------------------- [中转 Agent WebSocket 管理] -------------------

// RelayAgentCommand 面板下发给中转 Agent 的命令
type RelayAgentCommand struct {
	Type      string `json:"type"`       // "command"
	CommandID string `json:"command_id"` // 幂等键
	Action    string `json:"action"`     // "add-forward" / "remove-forward" / "list-forwards"
	ListenPort int   `json:"listen_port,omitempty"`
	TargetIP   string `json:"target_ip,omitempty"`
	TargetPort int    `json:"target_port,omitempty"`
}

// RelayAgentResult Agent 回传的执行结果
type RelayAgentResult struct {
	Type      string `json:"type"`       // "result"
	CommandID string `json:"command_id"`
	Status    string `json:"status"`  // "ok" / "error"
	Message   string `json:"message"`
}

// relayAgentHub 管理所有中转 Agent 的 WebSocket 连接
type relayAgentHub struct {
	mu    sync.RWMutex
	conns map[string]*websocket.Conn // installID → conn
}

var relayHub = &relayAgentHub{
	conns: make(map[string]*websocket.Conn),
}

// HandleRelayAgentWS 处理中转 Agent 的 WebSocket 连接
func HandleRelayAgentWS(w http.ResponseWriter, r *http.Request) {
	clientIP := r.RemoteAddr

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		Subprotocols:   []string{"nodectl-relay-agent"},
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		logger.Log.Error("中转 Agent WS 握手失败", "error", err, "ip", clientIP)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "connection closed")

	ctx := r.Context()
	var installID string

	for {
		readCtx, readCancel := context.WithTimeout(ctx, 120*time.Second)
		_, data, err := conn.Read(readCtx)
		readCancel()
		if err != nil {
			if installID != "" {
				relayHub.mu.Lock()
				delete(relayHub.conns, installID)
				relayHub.mu.Unlock()
				// 更新中转机状态为离线
				database.DB.Model(&database.RelayServer{}).
					Where("install_id = ?", installID).
					Update("status", 0)
				logger.Log.Info("中转 Agent 已断开", "install_id", installID, "ip", clientIP)
			}
			return
		}

		// 解析消息
		var msg map[string]interface{}
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		// 首次消息识别身份
		if id, ok := msg["install_id"].(string); ok && installID == "" {
			installID = id
			relayHub.mu.Lock()
			relayHub.conns[installID] = conn
			relayHub.mu.Unlock()
			// 更新中转机状态为在线
			database.DB.Model(&database.RelayServer{}).
				Where("install_id = ?", installID).
				Update("status", 1)
			logger.Log.Info("中转 Agent 已连接", "install_id", installID, "ip", clientIP)
		}

		// 处理命令执行结果
		if msgType, ok := msg["type"].(string); ok && msgType == "result" {
			var result RelayAgentResult
			json.Unmarshal(data, &result)
			if result.Status == "ok" {
				logger.Log.Info("中转 Agent 命令执行成功", "command_id", result.CommandID, "message", result.Message)
			} else {
				logger.Log.Warn("中转 Agent 命令执行失败", "command_id", result.CommandID, "message", result.Message)
			}
		}
	}
}

// SendRelayAgentCommand 向指定中转 Agent 发送命令
func SendRelayAgentCommand(installID string, cmd RelayAgentCommand) error {
	relayHub.mu.RLock()
	conn, ok := relayHub.conns[installID]
	relayHub.mu.RUnlock()

	if !ok || conn == nil {
		return fmt.Errorf("中转 Agent 未连接: %s", installID)
	}

	cmd.Type = "command"
	data, err := json.Marshal(cmd)
	if err != nil {
		return fmt.Errorf("序列化命令失败: %w", err)
	}

	writeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return conn.Write(writeCtx, websocket.MessageText, data)
}

// IsRelayAgentOnline 检查中转 Agent 是否在线
func IsRelayAgentOnline(installID string) bool {
	relayHub.mu.RLock()
	_, ok := relayHub.conns[installID]
	relayHub.mu.RUnlock()
	return ok
}

// GetRelayAgentOnlineStatus 批量获取中转机在线状态
func GetRelayAgentOnlineStatus() map[string]bool {
	relayHub.mu.RLock()
	defer relayHub.mu.RUnlock()

	result := make(map[string]bool, len(relayHub.conns))
	for id := range relayHub.conns {
		result[id] = true
	}
	return result
}

// generateRelayCommandID 生成唯一命令 ID
func generateRelayCommandID() string {
	return fmt.Sprintf("relay-%d", time.Now().UnixNano())
}

// ExecuteForwardOnAgent 通过 gost API 在中转机上执行端口转发
func ExecuteForwardOnAgent(relayUUID string, action string, listenPort int, targetIP string, targetPort int) error {
	var relay database.RelayServer
	if err := database.DB.Where("uuid = ?", relayUUID).First(&relay).Error; err != nil {
		return fmt.Errorf("中转机不存在")
	}

	if relay.Mode != 1 {
		return fmt.Errorf("该中转机为手动模式，不支持远程执行")
	}

	switch action {
	case "add-forward":
		return GostAddForward(relay.IP, relay.ApiPort, relay.ApiSecret, listenPort, targetIP, targetPort)
	case "remove-forward":
		return GostRemoveForward(relay.IP, relay.ApiPort, relay.ApiSecret, listenPort)
	default:
		return fmt.Errorf("未知操作: %s", action)
	}
}
