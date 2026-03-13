package database

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ------------------- [中转管理模型] -------------------

// RelayServer 中转机表
type RelayServer struct {
	UUID      string    `gorm:"primaryKey;column:uuid;type:varchar(36)" json:"uuid"`
	Name      string    `gorm:"column:name;type:varchar(128)" json:"name"`                 // 中转机名称
	IP        string    `gorm:"column:ip;type:varchar(45)" json:"ip"`                      // 中转机 IP
	Mode      int       `gorm:"column:mode;default:2" json:"mode"`                         // 1=agent管控(gost), 2=手动
	InstallID string    `gorm:"column:install_id;type:varchar(12);uniqueIndex" json:"install_id"` // agent 模式标识
	ApiPort   int       `gorm:"column:api_port;default:36601" json:"api_port"`             // gost API 端口
	ApiSecret string    `gorm:"column:api_secret;type:varchar(64)" json:"api_secret"`      // gost API 认证密钥
	Status    int       `gorm:"column:status;default:0" json:"status"`                     // 0=离线, 1=在线
	Remark    string    `gorm:"column:remark;type:text" json:"remark"`                     // 备注
	CreatedAt time.Time `gorm:"column:created_at" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at" json:"updated_at"`
}

func (RelayServer) TableName() string {
	return "relay_servers"
}

func (r *RelayServer) BeforeCreate(tx *gorm.DB) (err error) {
	if r.UUID == "" {
		r.UUID = uuid.New().String()
	}
	if r.InstallID == "" {
		r.InstallID = generateSecureRandomID(12)
	}
	if r.ApiPort == 0 {
		r.ApiPort = 36601
	}
	if r.ApiSecret == "" {
		r.ApiSecret = generateSecureRandomID(32)
	}
	return
}

// ForwardRule 转发规则表
type ForwardRule struct {
	UUID            string    `gorm:"primaryKey;column:uuid;type:varchar(36)" json:"uuid"`
	RelayServerUUID string    `gorm:"column:relay_server_uuid;type:varchar(36);index" json:"relay_server_uuid"` // 所属中转机
	ListenPort      int       `gorm:"column:listen_port" json:"listen_port"`                                   // 中转监听端口
	TargetIP        string    `gorm:"column:target_ip;type:varchar(45)" json:"target_ip"`                      // 目标 IP
	TargetPort      int       `gorm:"column:target_port" json:"target_port"`                                   // 目标端口
	MatchedNodeUUID string    `gorm:"column:matched_node_uuid;type:varchar(36)" json:"matched_node_uuid"`      // 匹配到的落地节点 UUID
	MatchedProtocol string    `gorm:"column:matched_protocol;type:varchar(32)" json:"matched_protocol"`        // 匹配到的协议名
	Status          int       `gorm:"column:status;default:3" json:"status"`                                   // 1=运行中, 2=已停止, 3=手动
	CreatedAt       time.Time `gorm:"column:created_at" json:"created_at"`
	UpdatedAt       time.Time `gorm:"column:updated_at" json:"updated_at"`

	// 关联
	RelayServer RelayServer `gorm:"foreignKey:RelayServerUUID;references:UUID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
}

func (ForwardRule) TableName() string {
	return "forward_rules"
}

func (f *ForwardRule) BeforeCreate(tx *gorm.DB) (err error) {
	if f.UUID == "" {
		f.UUID = uuid.New().String()
	}
	return
}
