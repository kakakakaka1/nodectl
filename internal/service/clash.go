package service

import (
	"bytes"
	_ "embed"
	"fmt"
	"nodectl/internal/database"
	"regexp"
	"strings"
	"text/template"
)

//go:embed clash_meta.tpl
var ClashTemplateStr string

// RuleModule 定义前端展示和后端判断的规则模块
type RuleModule struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

// [修复] 补全所有的 18 个分流模块
var SupportedClashModules = []RuleModule{
	{ID: "XiaoHongShu", Name: "小红书", Icon: "📕"},
	{ID: "DouYin", Name: "抖音", Icon: "🎵"},
	{ID: "BiliBili", Name: "BiliBili", Icon: "📺"},
	{ID: "Steam", Name: "Steam", Icon: "🎮"},
	{ID: "Apple", Name: "Apple", Icon: "🍎"},
	{ID: "Microsoft", Name: "Microsoft", Icon: "🪟"},
	{ID: "Telegram", Name: "Telegram", Icon: "✈️"},
	{ID: "Discord", Name: "Discord", Icon: "💬"},
	{ID: "Spotify", Name: "Spotify", Icon: "🎧"},
	{ID: "TikTok", Name: "TikTok", Icon: "📱"},
	{ID: "YouTube", Name: "YouTube", Icon: "▶️"},
	{ID: "Netflix", Name: "Netflix", Icon: "🎬"},
	{ID: "Google", Name: "Google", Icon: "🔍"},
	{ID: "GoogleFCM", Name: "GoogleFCM", Icon: "🔔"},
	{ID: "Facebook", Name: "Facebook", Icon: "📘"},
	{ID: "OpenAI", Name: "OpenAI", Icon: "🤖"},
	{ID: "GitHub", Name: "GitHub", Icon: "🐙"},
	{ID: "Twitter", Name: "Twitter(X)", Icon: "🐦"},
}

// ClashTemplateData 用于传入模板渲染的数据结构
type ClashTemplateData struct {
	RelaySubURL string          // 中转节点订阅链接
	ExitSubURL  string          // 落地节点订阅链接
	Modules     map[string]bool // 用户启用的规则模块
}

// GetActiveClashModules 从数据库获取用户保存的启用的模块
func GetActiveClashModules() []string {
	var conf database.SysConfig
	err := database.DB.Where("key = ?", "clash_active_modules").First(&conf).Error
	if err != nil || conf.Value == "" {
		return []string{}
	}
	return strings.Split(conf.Value, ",")
}

// SaveActiveClashModules 保存用户选择的模块
func SaveActiveClashModules(modules []string) error {
	val := strings.Join(modules, ",")

	err := database.DB.Where(database.SysConfig{Key: "clash_active_modules"}).
		Assign(database.SysConfig{Value: val}).
		FirstOrCreate(&database.SysConfig{}).Error

	return err
}

// RenderClashConfig 最终生成用户的 YAML 配置
func RenderClashConfig(relayURL, exitURL string) (string, error) {
	activeMods := GetActiveClashModules()
	modMap := make(map[string]bool)
	for _, m := range activeMods {
		modMap[m] = true
	}

	data := ClashTemplateData{
		RelaySubURL: relayURL,
		ExitSubURL:  exitURL,
		Modules:     modMap,
	}

	tmpl, err := template.New("clash").Parse(ClashTemplateStr)
	if err != nil {
		return "", fmt.Errorf("解析 Clash 模板失败: %v", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("渲染 Clash 模板失败: %v", err)
	}

	// [修复] 绝对安全的空行清理逻辑
	// 步骤 1: 将只有空格或制表符的“假空行”清理干净，变为纯粹的换行符
	re1 := regexp.MustCompile(`(?m)^[ \t]+$`)
	step1 := re1.ReplaceAllString(buf.String(), "")

	// 步骤 2: 将连续 3 个及以上的纯换行符，压缩为 2 个换行符 (保留一个正常空隙)
	// 这样绝对不会吃掉带有文字行的前置缩进
	re2 := regexp.MustCompile(`(\r?\n){3,}`)
	cleanYAML := re2.ReplaceAllString(step1, "\n\n")

	return cleanYAML, nil
}
