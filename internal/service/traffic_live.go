// 路径: internal/service/traffic_live.go
// WebSocket 实时流量中枢：Agent 上报 + 前端订阅
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"nodectl/internal/database"
	"nodectl/internal/logger"

	"nhooyr.io/websocket"
)

// ============================================================
//  数据结构
// ============================================================

// AgentTrafficMsg Agent 上报的动态 JSON 消息
type AgentTrafficMsg struct {
	InstallID string `json:"install_id"`
	TS        int64  `json:"ts"`
	RXRateBps int64  `json:"rx_rate_bps"`
	TXRateBps int64  `json:"tx_rate_bps"`
	// 可选字段：仅快照消息包含
	RXBytes *int64 `json:"rx_bytes,omitempty"`
	TXBytes *int64 `json:"tx_bytes,omitempty"`
}

// NodeLiveState 节点实时内存态
type NodeLiveState struct {
	InstallID  string    `json:"install_id"`
	NodeUUID   string    `json:"node_uuid"`
	RXRateBps  int64     `json:"rx_rate_bps"`
	TXRateBps  int64     `json:"tx_rate_bps"`
	LastLiveAt time.Time `json:"last_live_at"`
}

// FrontendPushMsg 推送给前端的实时消息
type FrontendPushMsg struct {
	InstallID  string `json:"install_id"`
	NodeUUID   string `json:"node_uuid"`
	RXRateBps  int64  `json:"rx_rate_bps"`
	TXRateBps  int64  `json:"tx_rate_bps"`
	LastLiveAt int64  `json:"last_live_at"` // Unix 秒
}

// ============================================================
//  全局 Hub（生命周期在路由器外，热重启不丢失）
// ============================================================

// AgentCommand 后端→Agent 下发命令结构
type AgentCommand struct {
	Type      string      `json:"type"`       // 固定 "command"
	CommandID string      `json:"command_id"` // 幂等键
	Action    string      `json:"action"`     // "reset-links" / "reinstall-singbox"
	Payload   interface{} `json:"payload,omitempty"`
}

// AgentCommandResult Agent 回传命令执行结果
type AgentCommandResult struct {
	Type      string `json:"type"` // "accepted" / "progress" / "result"
	CommandID string `json:"command_id"`
	Status    string `json:"status,omitempty"` // "ok" / "error"
	Message   string `json:"message,omitempty"`
	Stage     string `json:"stage,omitempty"` // 执行阶段描述
}

// TrafficHub 实时流量中枢：管理 Agent 连接与前端订阅
type TrafficHub struct {
	mu sync.RWMutex

	// install_id → 实时内存态
	nodes map[string]*NodeLiveState

	// install_id → install_id 到 node_uuid 的映射缓存
	idCache map[string]string

	// 前端订阅者：node_uuid → [subscriber channels]
	subscribers map[string]map[chan FrontendPushMsg]struct{}
	subMu       sync.Mutex

	// Agent 活跃连接：install_id → websocket.Conn（用于命令下发）
	agentConns map[string]*websocket.Conn
	agentMu    sync.RWMutex

	// 命令结果回调通道：command_id → channel
	cmdResults map[string]chan AgentCommandResult
	cmdMu      sync.Mutex
}

// globalHub 全局单例（在 for 循环外持有生命周期）
var globalHub *TrafficHub
var hubOnce sync.Once

// GetTrafficHub 返回全局 TrafficHub 单例
func GetTrafficHub() *TrafficHub {
	hubOnce.Do(func() {
		globalHub = &TrafficHub{
			nodes:       make(map[string]*NodeLiveState),
			idCache:     make(map[string]string),
			subscribers: make(map[string]map[chan FrontendPushMsg]struct{}),
			agentConns:  make(map[string]*websocket.Conn),
			cmdResults:  make(map[string]chan AgentCommandResult),
		}
	})
	return globalHub
}

// ============================================================
//  install_id → node_uuid 缓存
// ============================================================

func (h *TrafficHub) resolveNodeUUID(installID string) string {
	h.mu.RLock()
	if uuid, ok := h.idCache[installID]; ok {
		h.mu.RUnlock()
		return uuid
	}
	h.mu.RUnlock()

	// 查库
	var node database.NodePool
	if err := database.DB.Where("install_id = ?", installID).First(&node).Error; err != nil {
		return ""
	}

	h.mu.Lock()
	h.idCache[installID] = node.UUID
	h.mu.Unlock()

	return node.UUID
}

// ============================================================
//  Agent 上报处理 (WS Server Handler)
// ============================================================

// HandleAgentWS 处理 Agent 的 WebSocket 上报连接
// 路由: /api/callback/traffic/ws
// 支持双向通信：Agent→后端上报流量，后端→Agent下发命令
func HandleAgentWS(w http.ResponseWriter, r *http.Request) {
	hub := GetTrafficHub()

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		Subprotocols:   []string{"nodectl-agent"},
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		logger.Log.Error("Agent WS 握手失败", "error", err, "ip", r.RemoteAddr)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "connection closed")

	logger.Log.Info("Agent WS 已连接", "ip", r.RemoteAddr)

	ctx := r.Context()

	// 首个消息用于识别 install_id 并注册连接
	var agentInstallID string

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			// 正常关闭或网络断开
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure {
				logger.Log.Info("Agent WS 正常断开", "ip", r.RemoteAddr, "install_id", agentInstallID)
			} else {
				logger.Log.Warn("Agent WS 读取异常", "error", err, "ip", r.RemoteAddr, "install_id", agentInstallID)
			}
			// 注销 Agent 连接
			if agentInstallID != "" {
				hub.agentMu.Lock()
				delete(hub.agentConns, agentInstallID)
				hub.agentMu.Unlock()
			}
			return
		}

		// 尝试判断消息类型：命令结果 or 流量上报
		var rawMsg map[string]interface{}
		if err := json.Unmarshal(data, &rawMsg); err != nil {
			logger.Log.Warn("Agent WS 消息解析失败", "error", err, "ip", r.RemoteAddr)
			continue
		}

		// 如果包含 type 字段，说明是命令结果回传
		if msgType, ok := rawMsg["type"].(string); ok && (msgType == "accepted" || msgType == "progress" || msgType == "result") {
			var cmdResult AgentCommandResult
			json.Unmarshal(data, &cmdResult)
			hub.cmdMu.Lock()
			if ch, exists := hub.cmdResults[cmdResult.CommandID]; exists {
				select {
				case ch <- cmdResult:
				default:
				}
				// result 类型表示执行完毕，清理通道
				if cmdResult.Type == "result" {
					delete(hub.cmdResults, cmdResult.CommandID)
				}
			}
			hub.cmdMu.Unlock()
			continue
		}

		// 否则按流量上报处理
		var msg AgentTrafficMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			logger.Log.Warn("Agent WS 流量消息解析失败", "error", err, "ip", r.RemoteAddr)
			continue
		}

		installID := strings.TrimSpace(msg.InstallID)
		if installID == "" {
			continue
		}

		// 首次识别到 install_id 时注册连接
		if agentInstallID == "" {
			agentInstallID = installID
			hub.agentMu.Lock()
			hub.agentConns[installID] = conn
			hub.agentMu.Unlock()
			logger.Log.Info("Agent WS 已注册", "install_id", installID, "ip", r.RemoteAddr)
		}

		// 解析 node_uuid
		nodeUUID := hub.resolveNodeUUID(installID)
		if nodeUUID == "" {
			logger.Log.Warn("Agent WS 未知节点", "install_id", installID, "ip", r.RemoteAddr)
			continue
		}

		// 更新内存态
		hub.mu.Lock()
		state, exists := hub.nodes[installID]
		if !exists {
			state = &NodeLiveState{
				InstallID: installID,
				NodeUUID:  nodeUUID,
			}
			hub.nodes[installID] = state
		}
		state.RXRateBps = msg.RXRateBps
		state.TXRateBps = msg.TXRateBps
		state.LastLiveAt = time.Now()
		hub.mu.Unlock()

		// 若包含累计字段 → 写入历史库
		if msg.RXBytes != nil && msg.TXBytes != nil {
			go func(iid string, rx, tx int64) {
				if _, err := SaveNodeTrafficReport(iid, rx, tx, time.Now()); err != nil {
					logger.Log.Error("WS 快照写入失败", "install_id", iid, "error", err)
				}
			}(installID, *msg.RXBytes, *msg.TXBytes)
		}

		// 转发给前端订阅者
		pushMsg := FrontendPushMsg{
			InstallID:  installID,
			NodeUUID:   nodeUUID,
			RXRateBps:  msg.RXRateBps,
			TXRateBps:  msg.TXRateBps,
			LastLiveAt: time.Now().Unix(),
		}
		hub.broadcast(nodeUUID, pushMsg)
	}
}

// ============================================================
//  前端订阅 (WS Server Handler)
// ============================================================

// HandleTrafficLive 处理前端的实时流量订阅连接
// 路由: /api/traffic/live?node_uuid=...
// 若不传 node_uuid，则订阅所有节点
func HandleTrafficLive(w http.ResponseWriter, r *http.Request) {
	hub := GetTrafficHub()

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		logger.Log.Error("前端 Live WS 握手失败", "error", err, "ip", r.RemoteAddr)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "connection closed")

	ctx := r.Context()

	// 必须持续读取以处理客户端 close / ping 帧
	go func() {
		for {
			if _, _, err := conn.Read(ctx); err != nil {
				return
			}
		}
	}()

	nodeUUID := strings.TrimSpace(r.URL.Query().Get("node_uuid"))

	// 订阅 key：空字符串表示订阅全部
	subKey := nodeUUID
	if subKey == "" {
		subKey = "__all__"
	}

	// 创建订阅通道
	ch := make(chan FrontendPushMsg, 64)
	hub.subscribe(subKey, ch)
	defer hub.unsubscribe(subKey, ch)

	// 先推送当前快照（让前端立即看到最新状态）
	hub.mu.RLock()
	for _, state := range hub.nodes {
		if nodeUUID == "" || state.NodeUUID == nodeUUID {
			initMsg := FrontendPushMsg{
				InstallID:  state.InstallID,
				NodeUUID:   state.NodeUUID,
				RXRateBps:  state.RXRateBps,
				TXRateBps:  state.TXRateBps,
				LastLiveAt: state.LastLiveAt.Unix(),
			}
			data, _ := json.Marshal(initMsg)
			conn.Write(ctx, websocket.MessageText, data)
		}
	}
	hub.mu.RUnlock()

	// 持续推送
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			data, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			if err := conn.Write(writeCtx, websocket.MessageText, data); err != nil {
				cancel()
				return
			}
			cancel()
		}
	}
}

// ============================================================
//  Hub 内部方法
// ============================================================

// subscribe 注册前端订阅
func (h *TrafficHub) subscribe(key string, ch chan FrontendPushMsg) {
	h.subMu.Lock()
	defer h.subMu.Unlock()

	if h.subscribers[key] == nil {
		h.subscribers[key] = make(map[chan FrontendPushMsg]struct{})
	}
	h.subscribers[key][ch] = struct{}{}
}

// unsubscribe 注销前端订阅
func (h *TrafficHub) unsubscribe(key string, ch chan FrontendPushMsg) {
	h.subMu.Lock()
	defer h.subMu.Unlock()

	if subs, ok := h.subscribers[key]; ok {
		delete(subs, ch)
		if len(subs) == 0 {
			delete(h.subscribers, key)
		}
	}
	close(ch)
}

// broadcast 向对应节点的前端订阅者广播消息
func (h *TrafficHub) broadcast(nodeUUID string, msg FrontendPushMsg) {
	h.subMu.Lock()
	defer h.subMu.Unlock()

	// 推送给订阅了具体节点的前端
	if subs, ok := h.subscribers[nodeUUID]; ok {
		for ch := range subs {
			select {
			case ch <- msg:
			default:
				// 通道满了，跳过（避免阻塞）
			}
		}
	}

	// 推送给订阅了全部节点的前端
	if subs, ok := h.subscribers["__all__"]; ok {
		for ch := range subs {
			select {
			case ch <- msg:
			default:
			}
		}
	}
}

// GetNodeLiveState 获取节点实时状态（供其他模块使用）
func GetNodeLiveState(installID string) *NodeLiveState {
	hub := GetTrafficHub()
	hub.mu.RLock()
	defer hub.mu.RUnlock()

	if state, ok := hub.nodes[installID]; ok {
		copied := *state
		return &copied
	}
	return nil
}

// GetAllNodeLiveStates 获取所有节点实时状态
func GetAllNodeLiveStates() map[string]*NodeLiveState {
	hub := GetTrafficHub()
	hub.mu.RLock()
	defer hub.mu.RUnlock()

	result := make(map[string]*NodeLiveState, len(hub.nodes))
	for k, v := range hub.nodes {
		copied := *v
		result[k] = &copied
	}
	return result
}

// ============================================================
//  命令下发
// ============================================================

// DispatchCommandToNode 向指定节点下发命令，等待结果（带超时）
// 返回执行结果；若节点不在线或超时返回 error
func DispatchCommandToNode(installID string, action string, payload interface{}, timeout time.Duration) (*AgentCommandResult, error) {
	hub := GetTrafficHub()

	// 检查 Agent 是否在线
	hub.agentMu.RLock()
	conn, online := hub.agentConns[installID]
	hub.agentMu.RUnlock()
	if !online || conn == nil {
		return nil, fmt.Errorf("节点 %s 不在线", installID)
	}

	// 生成唯一命令 ID
	commandID := fmt.Sprintf("cmd-%s-%d", installID, time.Now().UnixNano())

	cmd := AgentCommand{
		Type:      "command",
		CommandID: commandID,
		Action:    action,
		Payload:   payload,
	}

	// 注册结果通道
	resultCh := make(chan AgentCommandResult, 8)
	hub.cmdMu.Lock()
	hub.cmdResults[commandID] = resultCh
	hub.cmdMu.Unlock()

	// 清理函数
	defer func() {
		hub.cmdMu.Lock()
		delete(hub.cmdResults, commandID)
		hub.cmdMu.Unlock()
	}()

	// 发送命令到 Agent
	data, err := json.Marshal(cmd)
	if err != nil {
		return nil, fmt.Errorf("命令序列化失败: %w", err)
	}

	writeCtx, writeCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer writeCancel()
	if err := conn.Write(writeCtx, websocket.MessageText, data); err != nil {
		return nil, fmt.Errorf("命令发送失败: %w", err)
	}

	logger.Log.Info("命令已下发", "install_id", installID, "action", action, "command_id", commandID)

	// 等待最终结果（type=result）或超时
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		select {
		case result := <-resultCh:
			if result.Type == "result" {
				return &result, nil
			}
			// accepted / progress 类型继续等待
			logger.Log.Info("命令执行中", "command_id", commandID, "type", result.Type, "stage", result.Stage)
		case <-timer.C:
			return nil, fmt.Errorf("命令执行超时 (%v)", timeout)
		}
	}
}

// IsNodeOnline 检查节点是否有活跃 Agent 连接
func IsNodeOnline(installID string) bool {
	hub := GetTrafficHub()
	hub.agentMu.RLock()
	defer hub.agentMu.RUnlock()
	_, ok := hub.agentConns[installID]
	return ok
}
