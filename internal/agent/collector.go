// 路径: internal/agent/collector.go
package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// NetStats 网卡流量采集数据
type NetStats struct {
	RXBytes int64 // 累计接收字节数
	TXBytes int64 // 累计发送字节数
}

// Collector 网卡流量采集器
type Collector struct {
	mu       sync.Mutex
	iface    string    // 目标网卡名
	prevRX   int64     // 上次采集的 RX 累计值
	prevTX   int64     // 上次采集的 TX 累计值
	prevTime time.Time // 上次采集时间
	rxRate   int64     // 实时接收速率 (bytes/s)
	txRate   int64     // 实时发送速率 (bytes/s)
	accumRX  int64     // 本周期累计下载量
	accumTX  int64     // 本周期累计上传量
	baseRX   int64     // 启动/重置时的 RX 基线
	baseTX   int64     // 启动/重置时的 TX 基线
	baseSet  bool      // 是否已设置基线
}

// NewCollector 创建采集器实例
func NewCollector(iface string) *Collector {
	return &Collector{
		iface: iface,
	}
}

// detectInterface 自动检测出口网卡
// 优先选择 eth0，其次遍历 /sys/class/net 找第一个非 lo/docker/veth/br 的接口
func detectInterface() (string, error) {
	// 优先检测 eth0
	if _, err := os.Stat("/sys/class/net/eth0/statistics/rx_bytes"); err == nil {
		return "eth0", nil
	}

	entries, err := os.ReadDir("/sys/class/net")
	if err != nil {
		return "", fmt.Errorf("无法读取 /sys/class/net: %w", err)
	}

	for _, e := range entries {
		name := e.Name()
		// 跳过回环、Docker 虚拟接口、veth 对、网桥
		if name == "lo" ||
			strings.HasPrefix(name, "docker") ||
			strings.HasPrefix(name, "veth") ||
			strings.HasPrefix(name, "br-") ||
			strings.HasPrefix(name, "virbr") {
			continue
		}
		// 确认该接口有 statistics 目录
		if _, err := os.Stat(filepath.Join("/sys/class/net", name, "statistics/rx_bytes")); err == nil {
			return name, nil
		}
	}

	return "", fmt.Errorf("未找到可用的网络接口")
}

// readSysCounter 从 sysfs 读取网卡统计计数器
func readSysCounter(iface, counter string) (int64, error) {
	path := filepath.Join("/sys/class/net", iface, "statistics", counter)
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("读取 %s 失败: %w", path, err)
	}
	val, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("解析 %s 值失败: %w", path, err)
	}
	return val, nil
}

// Init 初始化采集器：解析网卡名、读取基线值
func (c *Collector) Init() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	iface := c.iface
	if iface == "" || iface == "auto" {
		detected, err := detectInterface()
		if err != nil {
			return fmt.Errorf("自动检测网卡失败: %w", err)
		}
		iface = detected
	}
	c.iface = iface

	// 读取初始基线
	rx, err := readSysCounter(iface, "rx_bytes")
	if err != nil {
		return err
	}
	tx, err := readSysCounter(iface, "tx_bytes")
	if err != nil {
		return err
	}

	c.baseRX = rx
	c.baseTX = tx
	c.prevRX = rx
	c.prevTX = tx
	c.prevTime = time.Now()
	c.baseSet = true

	return nil
}

// Sample 采集一次数据点：更新速率和累计值
// 处理计数器回绕/重置场景（机器重启、网卡重建）
func (c *Collector) Sample() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	rx, err := readSysCounter(c.iface, "rx_bytes")
	if err != nil {
		return err
	}
	tx, err := readSysCounter(c.iface, "tx_bytes")
	if err != nil {
		return err
	}

	now := time.Now()

	// 检测计数器回绕/重置（当前值 < 上次值）
	if rx < c.prevRX || tx < c.prevTX {
		// 累计值保留已有的差值，用当前值作为新基线
		c.baseRX = rx
		c.baseTX = tx
		c.prevRX = rx
		c.prevTX = tx
		c.prevTime = now
		c.rxRate = 0
		c.txRate = 0
		return nil
	}

	// 计算瞬时速率
	elapsed := now.Sub(c.prevTime).Seconds()
	if elapsed > 0 {
		c.rxRate = int64(float64(rx-c.prevRX) / elapsed)
		c.txRate = int64(float64(tx-c.prevTX) / elapsed)
	}

	// 更新累计值（相对于基线的增量）
	c.accumRX = rx - c.baseRX
	c.accumTX = tx - c.baseTX

	// 保存当前采样作为下一次计算的基准
	c.prevRX = rx
	c.prevTX = tx
	c.prevTime = now

	return nil
}

// GetRates 获取当前实时速率 (bytes/s)
func (c *Collector) GetRates() (rxRate, txRate int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.rxRate, c.txRate
}

// GetAccumulated 获取本周期累计流量
func (c *Collector) GetAccumulated() (accumRX, accumTX int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.accumRX, c.accumTX
}

// ResetAccumulated 重置累计流量（月度重置时调用）
func (c *Collector) ResetAccumulated() {
	c.mu.Lock()
	defer c.mu.Unlock()

	// 重新读取当前计数器值作为新基线
	rx, err1 := readSysCounter(c.iface, "rx_bytes")
	tx, err2 := readSysCounter(c.iface, "tx_bytes")
	if err1 == nil && err2 == nil {
		c.baseRX = rx
		c.baseTX = tx
	}
	c.accumRX = 0
	c.accumTX = 0
}

// GetInterface 返回当前使用的网卡名
func (c *Collector) GetInterface() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.iface
}
