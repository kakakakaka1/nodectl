package service

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"nodectl/internal/database"
	"nodectl/internal/logger"

	"github.com/go-acme/lego/v4/certcrypto"
	"github.com/go-acme/lego/v4/certificate"
	"github.com/go-acme/lego/v4/lego"
	"github.com/go-acme/lego/v4/providers/dns/cloudflare"
	"github.com/go-acme/lego/v4/registration"
)

var (
	CertDir     = filepath.Join("data", "cert")
	CertFile    = filepath.Join(CertDir, "server.crt")
	KeyFile     = filepath.Join(CertDir, "server.key")
	certMutex   sync.RWMutex
	currentCert *tls.Certificate
)

// CertInfo 这里的结构体用于返回给前端展示
type CertInfo struct {
	Domain string `json:"domain"`
	Expire string `json:"expire"`
	Issuer string `json:"issuer"`
	Valid  bool   `json:"valid"`
}

// ------------------- [基础证书管理功能] -------------------

// InitCertManager 初始化证书目录，并启动后台续期任务
func InitCertManager() {
	if err := os.MkdirAll(CertDir, 0755); err != nil {
		logger.Log.Error("无法创建证书目录", "error", err)
	}

	// 启动证书自动续期后台守护线程
	startAutoRenewalTask()
}

// GetCertificate 用于 http.Server 的 TLSConfig.GetCertificate 回调 (实现热加载核心)
func GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	certMutex.RLock()
	defer certMutex.RUnlock()
	return currentCert, nil
}

// LoadCertificate 从磁盘加载证书到内存
func LoadCertificate() error {
	certMutex.Lock()
	defer certMutex.Unlock()

	if _, err := os.Stat(CertFile); os.IsNotExist(err) {
		return fmt.Errorf("证书文件不存在")
	}

	pair, err := tls.LoadX509KeyPair(CertFile, KeyFile)
	if err != nil {
		return err
	}
	currentCert = &pair
	logger.Log.Info("SSL 证书加载成功")
	return nil
}

// SaveUploadedCert 保存证书 (前端上传或 ACME 申请成功后均调用此函数)
func SaveUploadedCert(certContent, keyContent []byte) error {
	certMutex.Lock()
	defer certMutex.Unlock()

	// 备份旧证书
	os.Rename(CertFile, CertFile+".bak")
	os.Rename(KeyFile, KeyFile+".bak")

	if err := os.WriteFile(CertFile, certContent, 0644); err != nil {
		return err
	}
	if err := os.WriteFile(KeyFile, keyContent, 0600); err != nil {
		return err
	}

	// 尝试加载新证书进行校验
	pair, err := tls.LoadX509KeyPair(CertFile, KeyFile)
	if err != nil {
		// 校验失败，回滚
		os.Rename(CertFile+".bak", CertFile)
		os.Rename(KeyFile+".bak", KeyFile)
		return fmt.Errorf("证书格式错误或密钥不匹配，已回滚: %v", err)
	}

	currentCert = &pair
	return nil
}

// GetCurrentCertInfo 解析当前加载的证书信息，供前端展示
func GetCurrentCertInfo() CertInfo {
	certMutex.RLock()
	defer certMutex.RUnlock()

	info := CertInfo{Valid: false, Domain: "--", Expire: "--", Issuer: "--"}

	if currentCert == nil || len(currentCert.Certificate) == 0 {
		return info
	}

	// 解析 x509 证书数据
	x509Cert, err := x509.ParseCertificate(currentCert.Certificate[0])
	if err != nil {
		return info
	}

	info.Valid = true
	if len(x509Cert.DNSNames) > 0 {
		info.Domain = x509Cert.DNSNames[0]
	} else {
		info.Domain = x509Cert.Subject.CommonName
	}
	info.Expire = x509Cert.NotAfter.Format("2006-01-02 15:04:05")
	info.Issuer = x509Cert.Issuer.CommonName

	// 检查是否过期
	if time.Now().After(x509Cert.NotAfter) {
		info.Expire += " (已过期)"
		info.Valid = false
	}

	return info
}

// CheckRequestSecure 检查请求是否安全 (HTTPS)
func CheckRequestSecure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if r.Header.Get("X-Forwarded-Proto") == "https" {
		return true
	}
	return false
}

// ------------------- [ACME 证书申请与续期核心引擎] -------------------

// acmeUser 结构体实现 lego.registration.User 接口
type acmeUser struct {
	Email        string
	Registration *registration.Resource
	key          crypto.PrivateKey
}

func (u *acmeUser) GetEmail() string                        { return u.Email }
func (u *acmeUser) GetRegistration() *registration.Resource { return u.Registration }
func (u *acmeUser) GetPrivateKey() crypto.PrivateKey        { return u.key }

// ApplyCloudflareCert 使用 Cloudflare DNS 验证申请 Let's Encrypt 证书
func ApplyCloudflareCert(email, apiKey, domain string) error {
	logger.Log.Info("开始执行 ACME 证书申请任务", "domain", domain, "email", email)

	// 1. 生成 ACME 账号私钥
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("生成账号私钥失败: %v", err)
	}

	myUser := acmeUser{
		Email: email,
		key:   privateKey,
	}

	// 2. 初始化 Lego 客户端配置
	config := lego.NewConfig(&myUser)

	// 使用 Let's Encrypt 生产环境 API
	// 如果你频繁测试导致被限制，可以将这里换成 staging API: https://acme-staging-v02.api.letsencrypt.org/directory
	config.CADirURL = lego.LEDirectoryProduction
	config.Certificate.KeyType = certcrypto.RSA2048

	client, err := lego.NewClient(config)
	if err != nil {
		return fmt.Errorf("初始化 ACME 客户端失败: %v", err)
	}

	// 3. 配置 Cloudflare DNS Provider
	cfConfig := cloudflare.NewDefaultConfig()
	cfConfig.AuthEmail = email
	cfConfig.AuthKey = apiKey
	// 避免 DNS 缓存传播延迟导致验证失败，设置等待时间
	cfConfig.PropagationTimeout = 2 * time.Minute

	cfProvider, err := cloudflare.NewDNSProviderConfig(cfConfig)
	if err != nil {
		return fmt.Errorf("配置 CF API 失败: %v", err)
	}

	err = client.Challenge.SetDNS01Provider(cfProvider)
	if err != nil {
		return fmt.Errorf("设置 DNS Provider 失败: %v", err)
	}

	// 4. 注册 ACME 账号 (同意 Let's Encrypt 协议)
	logger.Log.Info("正在向 Let's Encrypt 注册账号...")
	reg, err := client.Registration.Register(registration.RegisterOptions{TermsOfServiceAgreed: true})
	if err != nil {
		return fmt.Errorf("ACME 账号注册失败: %v", err)
	}
	myUser.Registration = reg

	// 5. 发起证书申请
	logger.Log.Info("账号注册成功，正在下发 DNS TXT 记录进行域名验证 (这通常需要几十秒)...")
	request := certificate.ObtainRequest{
		Domains: []string{domain},
		Bundle:  true, // 捆绑颁发机构的证书链
	}
	certificates, err := client.Certificate.Obtain(request)
	if err != nil {
		return fmt.Errorf("证书获取失败: %v", err)
	}

	// 6. 申请成功，复用已有的上传逻辑将证书写入磁盘并热加载
	logger.Log.Info("✅ 证书获取成功！正在写入系统...")
	if err := SaveUploadedCert(certificates.Certificate, certificates.PrivateKey); err != nil {
		return fmt.Errorf("新证书应用失败: %v", err)
	}

	return nil
}

// startAutoRenewalTask 启动后台静默定时续期任务
func startAutoRenewalTask() {
	go func() {
		for {
			// 每天检查一次
			time.Sleep(24 * time.Hour)
			checkAndRenewCert()
		}
	}()
}

// checkAndRenewCert 检查证书有效期，并在不足 30 天时触发自动续期
func checkAndRenewCert() {
	certMutex.RLock()
	if currentCert == nil || len(currentCert.Certificate) == 0 {
		certMutex.RUnlock()
		return
	}
	x509Cert, err := x509.ParseCertificate(currentCert.Certificate[0])
	certMutex.RUnlock()

	if err != nil {
		return
	}

	// 计算剩余有效期，如果大于 30 天则跳过
	daysLeft := time.Until(x509Cert.NotAfter).Hours() / 24
	if daysLeft > 30 {
		return
	}

	logger.Log.Info("SSL 证书剩余有效期不足 30 天，开始后台自动续期...", "days_left", int(daysLeft))

	// 从数据库读取 CF 配置
	var email, apiKey, domain database.SysConfig
	database.DB.Where("key = ?", "cf_email").First(&email)
	database.DB.Where("key = ?", "cf_api_key").First(&apiKey)
	database.DB.Where("key = ?", "cf_domain").First(&domain)

	if email.Value == "" || apiKey.Value == "" || domain.Value == "" {
		logger.Log.Warn("证书自动续期失败: 缺少 Cloudflare 配置信息，请在面板中补全")
		return
	}

	// 触发申请
	if err := ApplyCloudflareCert(email.Value, apiKey.Value, domain.Value); err != nil {
		logger.Log.Error("证书自动续期失败", "error", err)
	} else {
		logger.Log.Info("🎉 证书自动续期成功！新证书已无感热加载生效。")
	}
}
