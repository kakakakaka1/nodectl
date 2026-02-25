// 路径: cmd/nodectl-agent/main.go
package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"nodectl/internal/agent"
	"nodectl/internal/version"
)

func main() {
	configPath := flag.String("config", agent.DefaultConfigPath, "配置文件路径")
	showVersion := flag.Bool("version", false, "显示版本号")
	flag.Parse()

	if *showVersion {
		fmt.Printf("nodectl-agent %s\n", version.Version)
		os.Exit(0)
	}

	log.SetFlags(log.Ldate | log.Ltime | log.Lmsgprefix)
	log.SetPrefix("")

	log.Printf("[Agent] nodectl-agent %s 正在启动...", version.Version)

	// 1. 加载配置
	cfg, err := agent.LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("[Agent] 加载配置失败: %v", err)
	}

	log.Printf("[Agent] install_id=%s, ws_url=%s, iface=%s, push=%ds, snapshot=%ds",
		cfg.InstallID, cfg.WSURL, cfg.Interface,
		cfg.WSPushIntervalSec, cfg.SnapshotIntervalSec)

	// 2. 创建并启动运行时
	rt := agent.NewRuntime(cfg)
	if err := rt.Run(); err != nil {
		log.Fatalf("[Agent] 运行时异常退出: %v", err)
	}
}
