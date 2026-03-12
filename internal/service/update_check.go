package service

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"nodectl/internal/logger"
	"nodectl/internal/version"
)

// UpdateCheckResult 存储版本检查的缓存结果
type UpdateCheckResult struct {
	HasUpdate      bool   `json:"has_update"`
	CurrentVersion string `json:"current_version"`
	LatestVersion  string `json:"latest_version"`
	ReleaseURL     string `json:"release_url"`
	PublishedAt    string `json:"published_at"`
	CheckedAt      string `json:"checked_at"`
	Error          string `json:"error,omitempty"`
}

var (
	updateCheckMu     sync.RWMutex
	updateCheckCache  *UpdateCheckResult
	updateCheckLastAt time.Time
	// 缓存有效期：10 分钟（避免频繁请求 GitHub API）
	updateCheckCacheTTL = 10 * time.Minute
)

const githubReleasesAPI = "https://api.github.com/repos/hobin66/nodectl/releases/latest"

// CheckForUpdate 检查是否有新版本可用，带内存缓存
// forceRefresh=true 时忽略缓存强制请求 GitHub
func CheckForUpdate(forceRefresh bool) *UpdateCheckResult {
	updateCheckMu.RLock()
	cached := updateCheckCache
	lastAt := updateCheckLastAt
	updateCheckMu.RUnlock()

	// 如果缓存有效且不强制刷新，直接返回缓存
	if !forceRefresh && cached != nil && time.Since(lastAt) < updateCheckCacheTTL {
		return cached
	}

	// 发起 GitHub API 请求
	result := fetchLatestRelease()

	// 写入缓存
	updateCheckMu.Lock()
	updateCheckCache = result
	updateCheckLastAt = time.Now()
	updateCheckMu.Unlock()

	return result
}

// fetchLatestRelease 从 GitHub API 获取最新 release 信息
func fetchLatestRelease() *UpdateCheckResult {
	currentVer := version.Version
	if currentVer == "" || currentVer == "dev" {
		currentVer = "v0.0.0"
	}

	result := &UpdateCheckResult{
		CurrentVersion: strings.TrimPrefix(currentVer, "v"),
		CheckedAt:      time.Now().Format(time.RFC3339),
	}

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", githubReleasesAPI, nil)
	if err != nil {
		result.Error = fmt.Sprintf("创建请求失败: %v", err)
		logger.Log.Warn("版本更新检查失败", "error", result.Error)
		return result
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "nodectl/"+currentVer)

	resp, err := client.Do(req)
	if err != nil {
		result.Error = fmt.Sprintf("网络请求失败: %v", err)
		logger.Log.Warn("版本更新检查失败", "error", result.Error)
		return result
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		result.Error = fmt.Sprintf("GitHub API 返回 HTTP %d", resp.StatusCode)
		logger.Log.Warn("版本更新检查失败", "error", result.Error)
		return result
	}

	var release struct {
		TagName     string `json:"tag_name"`
		HTMLURL     string `json:"html_url"`
		PublishedAt string `json:"published_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		result.Error = fmt.Sprintf("解析响应失败: %v", err)
		logger.Log.Warn("版本更新检查失败", "error", result.Error)
		return result
	}

	latestVer := strings.TrimPrefix(release.TagName, "v")
	result.LatestVersion = latestVer
	result.ReleaseURL = release.HTMLURL
	result.PublishedAt = release.PublishedAt

	// 版本比对：只要不相等就认为有更新
	cleanCurrent := strings.TrimPrefix(strings.TrimSpace(currentVer), "v")
	cleanLatest := strings.TrimSpace(latestVer)
	if cleanCurrent != "" && cleanLatest != "" && cleanCurrent != cleanLatest {
		result.HasUpdate = true
		logger.Log.Info("检测到新版本可用", "current", cleanCurrent, "latest", cleanLatest)
	}

	return result
}

// StartUpdateCheckBackground 在后台启动定期版本检查（每 30 分钟一次）
// 确保用户打开页面时缓存中已有结果
func StartUpdateCheckBackground() {
	go func() {
		// 启动后延迟 30 秒执行首次检查，避免与其他初始化任务竞争
		time.Sleep(30 * time.Second)
		CheckForUpdate(true)

		ticker := time.NewTicker(30 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			CheckForUpdate(true)
		}
	}()
}
