package server

import (
	"encoding/json"
	"net/http"

	"nodectl/internal/database"
	"nodectl/internal/logger"
	"nodectl/internal/service"
)

// ------------------- [中转机管理 API] -------------------

// apiRelayServerList 获取中转机列表
func apiRelayServerList(w http.ResponseWriter, r *http.Request) {
	var servers []database.RelayServer
	if err := database.DB.Order("created_at ASC").Find(&servers).Error; err != nil {
		logger.Log.Error("获取中转机列表失败", "error", err)
		sendJSON(w, "error", "获取中转机列表失败")
		return
	}
	sendJSON(w, "success", map[string]interface{}{"servers": servers})
}

// apiRelayServerAdd 添加中转机
func apiRelayServerAdd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Name    string `json:"name"`
		IP      string `json:"ip"`
		Mode    int    `json:"mode"`
		ApiPort int    `json:"api_port"`
		Remark  string `json:"remark"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, "error", "请求格式错误")
		return
	}

	if req.Name == "" || req.IP == "" {
		sendJSON(w, "error", "名称和 IP 不能为空")
		return
	}

	if req.Mode == 0 {
		req.Mode = 2 // 默认手动模式
	}

	server := database.RelayServer{
		Name:    req.Name,
		IP:      req.IP,
		Mode:    req.Mode,
		ApiPort: req.ApiPort,
		Remark:  req.Remark,
	}

	if err := database.DB.Create(&server).Error; err != nil {
		logger.Log.Error("添加中转机失败", "error", err)
		sendJSON(w, "error", "添加中转机失败")
		return
	}

	logger.Log.Info("中转机已添加", "name", server.Name, "ip", server.IP, "mode", server.Mode)
	sendJSON(w, "success", map[string]interface{}{"server": server})
}

// apiRelayServerUpdate 更新中转机
func apiRelayServerUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		UUID    string `json:"uuid"`
		Name    string `json:"name"`
		IP      string `json:"ip"`
		Mode    int    `json:"mode"`
		ApiPort int    `json:"api_port"`
		Remark  string `json:"remark"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, "error", "请求格式错误")
		return
	}

	var server database.RelayServer
	if err := database.DB.Where("uuid = ?", req.UUID).First(&server).Error; err != nil {
		sendJSON(w, "error", "中转机不存在")
		return
	}

	oldIP := server.IP
	server.Name = req.Name
	server.IP = req.IP
	server.Mode = req.Mode
	if req.ApiPort > 0 {
		server.ApiPort = req.ApiPort
	}
	server.Remark = req.Remark

	if err := database.DB.Save(&server).Error; err != nil {
		logger.Log.Error("更新中转机失败", "error", err)
		sendJSON(w, "error", "更新中转机失败")
		return
	}

	logger.Log.Info("中转机已更新", "name", server.Name, "ip", server.IP)

	// 如果 IP 变了，需要同步更新生成的直连节点
	if oldIP != server.IP {
		go service.SyncRelayGeneratedNodes(server.UUID)
	}

	sendJSON(w, "success", "中转机已更新")
}

// apiRelayServerDelete 删除中转机
func apiRelayServerDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		UUID string `json:"uuid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, "error", "请求格式错误")
		return
	}

	var server database.RelayServer
	if err := database.DB.Where("uuid = ?", req.UUID).First(&server).Error; err != nil {
		sendJSON(w, "error", "中转机不存在")
		return
	}

	// Agent 模式：尝试移除所有转发规则
	if server.Mode == 1 {
		var rules []database.ForwardRule
		database.DB.Where("relay_server_uuid = ? AND status = 1", server.UUID).Find(&rules)
		for _, rule := range rules {
			service.GostRemoveForward(server.IP, server.ApiPort, server.ApiSecret, rule.ListenPort)
		}
	}

	// 先清理关联的直连节点和转发规则
	service.CleanupByRelayServer(server.UUID)

	// 删除中转机记录
	if err := database.DB.Where("uuid = ?", req.UUID).Delete(&database.RelayServer{}).Error; err != nil {
		logger.Log.Error("删除中转机失败", "error", err)
		sendJSON(w, "error", "删除中转机失败")
		return
	}

	logger.Log.Info("中转机已删除", "name", server.Name)
	sendJSON(w, "success", "中转机已删除")
}

// apiRelayServerCheckStatus 检测中转机 gost 在线状态
func apiRelayServerCheckStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		UUID string `json:"uuid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, "error", "请求格式错误")
		return
	}

	var server database.RelayServer
	if err := database.DB.Where("uuid = ?", req.UUID).First(&server).Error; err != nil {
		sendJSON(w, "error", "中转机不存在")
		return
	}

	online := service.GostPing(server.IP, server.ApiPort, server.ApiSecret)
	newStatus := 0
	if online {
		newStatus = 1
	}
	database.DB.Model(&server).Update("status", newStatus)

	sendJSON(w, "success", map[string]interface{}{"online": online})
}

// ------------------- [转发规则管理 API] -------------------

// apiForwardRuleList 获取转发规则列表
func apiForwardRuleList(w http.ResponseWriter, r *http.Request) {
	relayUUID := r.URL.Query().Get("relay_uuid")

	var rules []database.ForwardRule
	query := database.DB.Order("created_at ASC")
	if relayUUID != "" {
		query = query.Where("relay_server_uuid = ?", relayUUID)
	}
	if err := query.Find(&rules).Error; err != nil {
		logger.Log.Error("获取转发规则列表失败", "error", err)
		sendJSON(w, "error", "获取转发规则列表失败")
		return
	}

	// 补充落地节点名称信息
	type RuleWithInfo struct {
		database.ForwardRule
		MatchedNodeName string `json:"matched_node_name"`
		RelayServerName string `json:"relay_server_name"`
		RelayServerIP   string `json:"relay_server_ip"`
		RelayServerMode int    `json:"relay_server_mode"`
	}

	var result []RuleWithInfo
	for _, rule := range rules {
		info := RuleWithInfo{ForwardRule: rule}

		if rule.MatchedNodeUUID != "" {
			var node database.NodePool
			if err := database.DB.Select("name").Where("uuid = ?", rule.MatchedNodeUUID).First(&node).Error; err == nil {
				info.MatchedNodeName = node.Name
			}
		}

		var relay database.RelayServer
		if err := database.DB.Select("name, ip, mode").Where("uuid = ?", rule.RelayServerUUID).First(&relay).Error; err == nil {
			info.RelayServerName = relay.Name
			info.RelayServerIP = relay.IP
			info.RelayServerMode = relay.Mode
		}

		result = append(result, info)
	}

	sendJSON(w, "success", map[string]interface{}{"rules": result})
}

// apiForwardRuleAdd 添加转发规则
func apiForwardRuleAdd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		RelayServerUUID string `json:"relay_server_uuid"`
		ListenPort      int    `json:"listen_port"`
		TargetIP        string `json:"target_ip"`
		TargetPort      int    `json:"target_port"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, "error", "请求格式错误")
		return
	}

	if req.RelayServerUUID == "" || req.ListenPort == 0 || req.TargetIP == "" || req.TargetPort == 0 {
		sendJSON(w, "error", "所有字段不能为空")
		return
	}

	// 检查中转机是否存在
	var relay database.RelayServer
	if err := database.DB.Where("uuid = ?", req.RelayServerUUID).First(&relay).Error; err != nil {
		sendJSON(w, "error", "中转机不存在")
		return
	}

	// 自动匹配落地节点
	matchedUUID, matchedProto := service.MatchForwardRuleToLandingNode(req.TargetIP, req.TargetPort)

	rule := database.ForwardRule{
		RelayServerUUID: req.RelayServerUUID,
		ListenPort:      req.ListenPort,
		TargetIP:        req.TargetIP,
		TargetPort:      req.TargetPort,
		MatchedNodeUUID: matchedUUID,
		MatchedProtocol: matchedProto,
		Status:          3, // 手动模式默认
	}

	// Agent 模式：自动尝试启动转发
	if relay.Mode == 1 {
		rule.Status = 2 // 先设为已停止
		if err := database.DB.Create(&rule).Error; err != nil {
			logger.Log.Error("添加转发规则失败", "error", err)
			sendJSON(w, "error", "添加转发规则失败")
			return
		}

		// 自动启动转发
		if err := service.ExecuteForwardOnAgent(relay.UUID, "add-forward", req.ListenPort, req.TargetIP, req.TargetPort); err != nil {
			logger.Log.Warn("自动启动转发失败", "error", err, "listen_port", req.ListenPort)
			// 不阻塞，规则已创建，状态保持已停止
		} else {
			database.DB.Model(&rule).Update("status", 1)
			rule.Status = 1
		}
	} else {
		if err := database.DB.Create(&rule).Error; err != nil {
			logger.Log.Error("添加转发规则失败", "error", err)
			sendJSON(w, "error", "添加转发规则失败")
			return
		}
	}

	logger.Log.Info("转发规则已添加", "relay", relay.Name, "listen_port", req.ListenPort,
		"target_ip", req.TargetIP, "target_port", req.TargetPort,
		"matched_node", matchedUUID, "matched_protocol", matchedProto)

	// 触发同步生成直连节点
	go service.SyncRelayGeneratedNodes(relay.UUID)

	sendJSON(w, "success", map[string]interface{}{"rule": rule})
}

// apiForwardRuleUpdate 更新转发规则
func apiForwardRuleUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		UUID       string `json:"uuid"`
		ListenPort int    `json:"listen_port"`
		TargetIP   string `json:"target_ip"`
		TargetPort int    `json:"target_port"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, "error", "请求格式错误")
		return
	}

	var rule database.ForwardRule
	if err := database.DB.Where("uuid = ?", req.UUID).First(&rule).Error; err != nil {
		sendJSON(w, "error", "转发规则不存在")
		return
	}

	rule.ListenPort = req.ListenPort
	rule.TargetIP = req.TargetIP
	rule.TargetPort = req.TargetPort

	// 重新匹配
	matchedUUID, matchedProto := service.MatchForwardRuleToLandingNode(req.TargetIP, req.TargetPort)
	rule.MatchedNodeUUID = matchedUUID
	rule.MatchedProtocol = matchedProto

	if err := database.DB.Save(&rule).Error; err != nil {
		logger.Log.Error("更新转发规则失败", "error", err)
		sendJSON(w, "error", "更新转发规则失败")
		return
	}

	// 触发同步
	go service.SyncRelayGeneratedNodes(rule.RelayServerUUID)

	logger.Log.Info("转发规则已更新", "uuid", req.UUID)
	sendJSON(w, "success", "转发规则已更新")
}

// apiForwardRuleDelete 删除转发规则
func apiForwardRuleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		UUID string `json:"uuid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, "error", "请求格式错误")
		return
	}

	var rule database.ForwardRule
	if err := database.DB.Where("uuid = ?", req.UUID).First(&rule).Error; err != nil {
		sendJSON(w, "error", "转发规则不存在")
		return
	}

	// Agent 模式且运行中：先停止转发
	if rule.Status == 1 {
		var relay database.RelayServer
		if err := database.DB.Where("uuid = ?", rule.RelayServerUUID).First(&relay).Error; err == nil && relay.Mode == 1 {
			service.GostRemoveForward(relay.IP, relay.ApiPort, relay.ApiSecret, rule.ListenPort)
		}
	}

	relayUUID := rule.RelayServerUUID

	if err := database.DB.Where("uuid = ?", req.UUID).Delete(&database.ForwardRule{}).Error; err != nil {
		logger.Log.Error("删除转发规则失败", "error", err)
		sendJSON(w, "error", "删除转发规则失败")
		return
	}

	// 触发同步（会清理不再匹配的直连节点）
	go service.SyncRelayGeneratedNodes(relayUUID)

	logger.Log.Info("转发规则已删除", "uuid", req.UUID)
	sendJSON(w, "success", "转发规则已删除")
}

// ------------------- [Agent 转发控制 API] -------------------

// apiForwardRuleStart 启动 gost 转发
func apiForwardRuleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		UUID string `json:"uuid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, "error", "请求格式错误")
		return
	}

	var rule database.ForwardRule
	if err := database.DB.Where("uuid = ?", req.UUID).First(&rule).Error; err != nil {
		sendJSON(w, "error", "转发规则不存在")
		return
	}

	if err := service.ExecuteForwardOnAgent(rule.RelayServerUUID, "add-forward", rule.ListenPort, rule.TargetIP, rule.TargetPort); err != nil {
		sendJSON(w, "error", err.Error())
		return
	}

	// 更新状态为运行中
	database.DB.Model(&rule).Update("status", 1)

	sendJSON(w, "success", "转发已启动")
}

// apiForwardRuleStop 停止 gost 转发
func apiForwardRuleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		UUID string `json:"uuid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, "error", "请求格式错误")
		return
	}

	var rule database.ForwardRule
	if err := database.DB.Where("uuid = ?", req.UUID).First(&rule).Error; err != nil {
		sendJSON(w, "error", "转发规则不存在")
		return
	}

	if err := service.ExecuteForwardOnAgent(rule.RelayServerUUID, "remove-forward", rule.ListenPort, rule.TargetIP, rule.TargetPort); err != nil {
		sendJSON(w, "error", err.Error())
		return
	}

	// 更新状态为已停止
	database.DB.Model(&rule).Update("status", 2)

	sendJSON(w, "success", "转发已停止")
}

// ------------------- [安装脚本 & WebSocket] -------------------

// apiRelayInstallScript 生成中转机 gost 安装脚本
func apiRelayInstallScript(w http.ResponseWriter, r *http.Request) {
	installID := r.URL.Query().Get("id")
	if installID == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		return
	}

	var server database.RelayServer
	if err := database.DB.Where("install_id = ?", installID).First(&server).Error; err != nil {
		http.Error(w, "Invalid ID", http.StatusForbidden)
		return
	}

	script := service.RenderRelayInstallScript(server)

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(script))
}

// apiRelayAgentWS 中转 Agent WebSocket 入口 (保留向后兼容)
func apiRelayAgentWS(w http.ResponseWriter, r *http.Request) {
	service.HandleRelayAgentWS(w, r)
}
