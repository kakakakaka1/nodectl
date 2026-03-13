package service

import (
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	"nodectl/internal/database"
	"nodectl/internal/logger"
)

// ------------------- [Link IP:端口解析] -------------------

// LinkEndpoint 从 Link 中解析出的 IP 和端口
type LinkEndpoint struct {
	IP   string
	Port int
}

// ExtractLinkEndpoint 从分享链接中提取 IP 和端口
func ExtractLinkEndpoint(link string) *LinkEndpoint {
	lowerLink := strings.ToLower(strings.TrimSpace(link))
	if lowerLink == "" {
		return nil
	}

	// VMess: vmess://base64(json) — 特殊处理
	if strings.HasPrefix(lowerLink, "vmess://") {
		body := safeBase64Decode(link[8:])
		if body == "" {
			return nil
		}
		var vj vmessJSON
		if err := json.Unmarshal([]byte(body), &vj); err != nil {
			return nil
		}
		return &LinkEndpoint{
			IP:   strings.Trim(vj.Add, "[]"),
			Port: parseInt(vj.Port),
		}
	}

	// 其他标准 URI 格式
	u, err := url.Parse(link)
	if err != nil || u.Host == "" {
		return nil
	}

	hostname := u.Hostname()
	port, _ := strconv.Atoi(u.Port())
	if port == 0 {
		return nil
	}

	return &LinkEndpoint{
		IP:   hostname,
		Port: port,
	}
}

// ------------------- [匹配引擎] -------------------

// MatchForwardRuleToLandingNode 尝试将转发规则匹配到一个落地节点的某个协议
// 返回匹配到的节点 UUID 和协议名，未匹配返回空
func MatchForwardRuleToLandingNode(targetIP string, targetPort int) (matchedNodeUUID string, matchedProtocol string) {
	var landingNodes []database.NodePool
	database.DB.Where("routing_type = ?", 2).Find(&landingNodes)

	for _, node := range landingNodes {
		// 检查 IP 是否匹配（IPv4 或 IPv6）
		if !ipMatches(node, targetIP) {
			continue
		}

		// 遍历节点的所有协议 Link，提取端口进行匹配
		for proto, link := range node.Links {
			ep := ExtractLinkEndpoint(link)
			if ep == nil {
				continue
			}
			if ep.Port == targetPort {
				return node.UUID, proto
			}
		}
	}

	return "", ""
}

// ipMatches 检查目标 IP 是否与节点的 IPv4 或 IPv6 匹配
func ipMatches(node database.NodePool, targetIP string) bool {
	targetIP = strings.Trim(targetIP, "[]")
	if targetIP == "" {
		return false
	}

	if node.IPV4 != "" && normalizeIP(node.IPV4) == normalizeIP(targetIP) {
		return true
	}
	if node.IPV6 != "" && normalizeIP(node.IPV6) == normalizeIP(targetIP) {
		return true
	}
	return false
}

// normalizeIP 标准化 IP 地址用于比较
func normalizeIP(ip string) string {
	ip = strings.Trim(ip, "[]")
	parsed := net.ParseIP(ip)
	if parsed != nil {
		return parsed.String()
	}
	return ip
}

// ------------------- [直连节点生成/同步/清理] -------------------

// SyncRelayGeneratedNodes 根据中转机的所有转发规则，生成或更新直连节点
// 按 (中转机, 落地节点) 分组，每组一个直连节点
func SyncRelayGeneratedNodes(relayUUID string) {
	var relay database.RelayServer
	if err := database.DB.Where("uuid = ?", relayUUID).First(&relay).Error; err != nil {
		logger.Log.Warn("同步中转节点失败: 中转机不存在", "relay_uuid", relayUUID)
		return
	}

	// 获取该中转机的所有转发规则
	var rules []database.ForwardRule
	database.DB.Where("relay_server_uuid = ?", relayUUID).Find(&rules)

	// 重新匹配所有规则
	for i := range rules {
		matchedUUID, matchedProto := MatchForwardRuleToLandingNode(rules[i].TargetIP, rules[i].TargetPort)
		rules[i].MatchedNodeUUID = matchedUUID
		rules[i].MatchedProtocol = matchedProto
		database.DB.Model(&rules[i]).Updates(map[string]interface{}{
			"matched_node_uuid": matchedUUID,
			"matched_protocol":  matchedProto,
		})
	}

	// 按落地节点分组：landingUUID → []ForwardRule
	groupedRules := make(map[string][]database.ForwardRule)
	for _, rule := range rules {
		if rule.MatchedNodeUUID == "" {
			continue
		}
		groupedRules[rule.MatchedNodeUUID] = append(groupedRules[rule.MatchedNodeUUID], rule)
	}

	// 获取当前已有的由该中转机生成的直连节点
	var existingNodes []database.NodePool
	database.DB.Where("relay_generated = ? AND source_relay_uuid = ?", true, relayUUID).Find(&existingNodes)

	// 标记哪些已有直连节点仍然有效
	existingMap := make(map[string]*database.NodePool) // key = source_landing_uuid
	for i := range existingNodes {
		existingMap[existingNodes[i].SourceLandingUUID] = &existingNodes[i]
	}

	// 处理每个分组
	processedLandingUUIDs := make(map[string]bool)
	for landingUUID, matchedRules := range groupedRules {
		processedLandingUUIDs[landingUUID] = true

		// 获取落地节点
		var landingNode database.NodePool
		if err := database.DB.Where("uuid = ?", landingUUID).First(&landingNode).Error; err != nil {
			logger.Log.Warn("落地节点不存在，跳过", "landing_uuid", landingUUID)
			continue
		}

		// 构建改写后的 Links
		newLinks := make(map[string]string)
		newLinkIPModes := make(map[string]int)
		for _, rule := range matchedRules {
			proto := rule.MatchedProtocol
			originalLink, ok := landingNode.Links[proto]
			if !ok {
				continue
			}

			// 替换 IP 和端口
			rewrittenLink := ReplaceLinkIP(originalLink, relay.IP)
			rewrittenLink = ReplaceLinkPort(rewrittenLink, rule.ListenPort)
			newLinks[proto] = rewrittenLink

			// 继承协议级 IP 模式
			if mode, ok := landingNode.LinkIPModes[proto]; ok {
				newLinkIPModes[proto] = mode
			}
		}

		if len(newLinks) == 0 {
			continue
		}

		nodeName := fmt.Sprintf("[%s] %s", relay.Name, landingNode.Name)

		// 查找或创建直连节点
		if existingNode, ok := existingMap[landingUUID]; ok {
			// 更新已有节点
			existingNode.Name = nodeName
			existingNode.Links = newLinks
			existingNode.LinkIPModes = newLinkIPModes
			existingNode.IPV4 = relay.IP
			database.DB.Save(existingNode)
			logger.Log.Info("已更新中转直连节点", "name", nodeName, "relay", relay.Name)
		} else {
			// 创建新节点
			newNode := database.NodePool{
				Name:              nodeName,
				RoutingType:       1, // 直连
				Links:             newLinks,
				LinkIPModes:       newLinkIPModes,
				IPV4:              relay.IP,
				RelayGenerated:    true,
				SourceRelayUUID:   relayUUID,
				SourceLandingUUID: landingUUID,
				Region:            GlobalGeoIP.GetCountryIsoCode(relay.IP),
			}
			if err := database.DB.Create(&newNode).Error; err != nil {
				logger.Log.Error("创建中转直连节点失败", "error", err, "name", nodeName)
			} else {
				logger.Log.Info("已创建中转直连节点", "name", nodeName, "relay", relay.Name)
			}
		}
	}

	// 清理不再匹配的直连节点
	for landingUUID, existingNode := range existingMap {
		if !processedLandingUUIDs[landingUUID] {
			database.DB.Where("uuid = ?", existingNode.UUID).Delete(&database.NodePool{})
			logger.Log.Info("已删除失效的中转直连节点", "name", existingNode.Name)
		}
	}
}

// SyncByLandingNode 当落地节点更新时，同步所有引用它的中转直连节点
func SyncByLandingNode(landingUUID string) {
	// 找到所有匹配该落地节点的转发规则，获取涉及的中转机
	var rules []database.ForwardRule
	database.DB.Where("matched_node_uuid = ?", landingUUID).Find(&rules)

	// 去重中转机 UUID
	relayUUIDs := make(map[string]bool)
	for _, rule := range rules {
		relayUUIDs[rule.RelayServerUUID] = true
	}

	// 逐个中转机同步
	for relayUUID := range relayUUIDs {
		SyncRelayGeneratedNodes(relayUUID)
	}

	// 也可能落地节点 IP 变了，之前没匹配上的规则现在能匹配了
	// 重新扫描所有未匹配的规则
	var unmatchedRules []database.ForwardRule
	database.DB.Where("matched_node_uuid = ''").Find(&unmatchedRules)
	affectedRelays := make(map[string]bool)
	for _, rule := range unmatchedRules {
		matchedUUID, _ := MatchForwardRuleToLandingNode(rule.TargetIP, rule.TargetPort)
		if matchedUUID == landingUUID {
			affectedRelays[rule.RelayServerUUID] = true
		}
	}
	for relayUUID := range affectedRelays {
		if !relayUUIDs[relayUUID] {
			SyncRelayGeneratedNodes(relayUUID)
		}
	}
}

// CleanupByLandingNode 当落地节点被删除时，清理所有由它生成的直连节点
func CleanupByLandingNode(landingUUID string) {
	// 删除所有由该落地节点生成的直连节点
	result := database.DB.Where("relay_generated = ? AND source_landing_uuid = ?", true, landingUUID).
		Delete(&database.NodePool{})
	if result.RowsAffected > 0 {
		logger.Log.Info("已清理落地节点关联的中转直连节点", "landing_uuid", landingUUID, "count", result.RowsAffected)
	}

	// 清除转发规则中的匹配关系
	database.DB.Model(&database.ForwardRule{}).
		Where("matched_node_uuid = ?", landingUUID).
		Updates(map[string]interface{}{
			"matched_node_uuid": "",
			"matched_protocol":  "",
		})
}

// CleanupByRelayServer 当中转机被删除时，清理所有由它生成的直连节点和转发规则
func CleanupByRelayServer(relayUUID string) {
	// 删除所有由该中转机生成的直连节点
	result := database.DB.Where("relay_generated = ? AND source_relay_uuid = ?", true, relayUUID).
		Delete(&database.NodePool{})
	if result.RowsAffected > 0 {
		logger.Log.Info("已清理中转机关联的直连节点", "relay_uuid", relayUUID, "count", result.RowsAffected)
	}

	// 删除该中转机的所有转发规则（外键级联也会删，这里显式删除以确保）
	database.DB.Where("relay_server_uuid = ?", relayUUID).Delete(&database.ForwardRule{})
}

// SyncAllRelayNodes 全量同步所有中转机的直连节点（启动时调用）
func SyncAllRelayNodes() {
	var relays []database.RelayServer
	database.DB.Find(&relays)
	for _, relay := range relays {
		SyncRelayGeneratedNodes(relay.UUID)
	}
}
