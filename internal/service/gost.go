package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"nodectl/internal/logger"
)

// ------------------- [gost API 客户端] -------------------
// gost v3 REST API 用于远程管理中转机上的端口转发

var gostHTTPClient = &http.Client{Timeout: 8 * time.Second}

// gostService gost API 创建转发服务的请求体
type gostService struct {
	Name      string        `json:"name"`
	Addr      string        `json:"addr"`
	Handler   gostHandler   `json:"handler"`
	Listener  gostListener  `json:"listener"`
	Forwarder gostForwarder `json:"forwarder"`
}

type gostHandler struct {
	Type string `json:"type"`
}

type gostListener struct {
	Type string `json:"type"`
}

type gostForwarder struct {
	Nodes []gostNode `json:"nodes"`
}

type gostNode struct {
	Name string `json:"name"`
	Addr string `json:"addr"`
}

// gostAPIURL 构建 gost API 地址
func gostAPIURL(relayIP string, apiPort int, path string) string {
	return fmt.Sprintf("http://%s:%d%s", relayIP, apiPort, path)
}

// gostRequest 发送 gost API 请求
func gostRequest(method, url, apiSecret string, body interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("序列化请求失败: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return fmt.Errorf("创建请求失败: %w", err)
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.SetBasicAuth("gost", apiSecret)

	resp, err := gostHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("gost API 返回 %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// GostAddForward 在中转机上添加 TCP+UDP 转发
func GostAddForward(relayIP string, apiPort int, apiSecret string, listenPort int, targetIP string, targetPort int) error {
	targetAddr := fmt.Sprintf("%s:%d", targetIP, targetPort)
	listenAddr := fmt.Sprintf(":%d", listenPort)
	apiURL := gostAPIURL(relayIP, apiPort, "/api/services")

	// TCP 转发
	tcpSvc := gostService{
		Name:     fmt.Sprintf("relay-tcp-%d", listenPort),
		Addr:     listenAddr,
		Handler:  gostHandler{Type: "tcp"},
		Listener: gostListener{Type: "tcp"},
		Forwarder: gostForwarder{
			Nodes: []gostNode{{Name: "target", Addr: targetAddr}},
		},
	}
	if err := gostRequest("POST", apiURL, apiSecret, tcpSvc); err != nil {
		return fmt.Errorf("添加 TCP 转发失败: %w", err)
	}

	// UDP 转发
	udpSvc := gostService{
		Name:     fmt.Sprintf("relay-udp-%d", listenPort),
		Addr:     listenAddr,
		Handler:  gostHandler{Type: "udp"},
		Listener: gostListener{Type: "udp"},
		Forwarder: gostForwarder{
			Nodes: []gostNode{{Name: "target", Addr: targetAddr}},
		},
	}
	if err := gostRequest("POST", apiURL, apiSecret, udpSvc); err != nil {
		// TCP 已添加成功，UDP 失败只记录警告
		logger.Log.Warn("添加 UDP 转发失败（TCP 已成功）", "port", listenPort, "error", err)
	}

	logger.Log.Info("gost 转发已添加", "relay", relayIP, "listen", listenPort, "target", targetAddr)
	return nil
}

// GostRemoveForward 在中转机上移除转发
func GostRemoveForward(relayIP string, apiPort int, apiSecret string, listenPort int) error {
	// 删除 TCP
	tcpURL := gostAPIURL(relayIP, apiPort, fmt.Sprintf("/api/services/relay-tcp-%d", listenPort))
	if err := gostRequest("DELETE", tcpURL, apiSecret, nil); err != nil {
		logger.Log.Warn("删除 TCP 转发失败", "port", listenPort, "error", err)
	}

	// 删除 UDP
	udpURL := gostAPIURL(relayIP, apiPort, fmt.Sprintf("/api/services/relay-udp-%d", listenPort))
	if err := gostRequest("DELETE", udpURL, apiSecret, nil); err != nil {
		logger.Log.Warn("删除 UDP 转发失败", "port", listenPort, "error", err)
	}

	logger.Log.Info("gost 转发已移除", "relay", relayIP, "listen", listenPort)
	return nil
}

// GostPing 检测中转机 gost 是否在线
func GostPing(relayIP string, apiPort int, apiSecret string) bool {
	url := gostAPIURL(relayIP, apiPort, "/api/config")
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return false
	}
	req.SetBasicAuth("gost", apiSecret)

	resp, err := gostHTTPClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == 200
}
