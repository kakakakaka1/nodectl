// ===== index.html inline scripts =====
document.addEventListener('DOMContentLoaded', loadNodesList);

window.allNodesData = {};

// 备用调色盘 (用于未知的新协议)
const tagColorPalette = [
    { bg: '#dcfce7', text: '#16a34a' }, // Green
    { bg: '#fce7f3', text: '#db2777' }, // Pink
    { bg: '#cffafe', text: '#0d9488' }, // Cyan
    { bg: '#e0f2fe', text: '#2563eb' }, // Blue
    { bg: '#fef9c3', text: '#d97706' }, // Yellow
    { bg: '#f3e8ff', text: '#7c3aed' }, // Purple
    { bg: '#ffedd5', text: '#ca8a04' }, // Orange
    { bg: '#fee2e2', text: '#dc2626' }, // Red
    { bg: '#ccfbf1', text: '#059669' }, // Teal
    { bg: '#e0e7ff', text: '#4f46e5' }  // Indigo
];

// 核心硬编码映射：确保默认的几个主流协议绝不撞色，色彩对比强烈
const fixedProtoColors = {
    'ss': { bg: '#e0f2fe', text: '#2563eb' },      // 经典蓝
    'hy2': { bg: '#ffedd5', text: '#ea580c' },     // 活力橙
    'vless': { bg: '#f3e8ff', text: '#9333ea' },   // 优雅紫
    'tuic': { bg: '#fee2e2', text: '#dc2626' },    // 醒目红
    'socks5': { bg: '#ccfbf1', text: '#0d9488' },  // 青色
    'trojan': { bg: '#fef9c3', text: '#ca8a04' },  // 黄色
    'vmess': { bg: '#dcfce7', text: '#16a34a' }    // 绿色
};

// 增强版色彩分配引擎
function getProtoColor(protoName) {
    const key = protoName.toLowerCase();

    // 1. 优先命中硬编码的预设色彩
    if (fixedProtoColors[key]) {
        return fixedProtoColors[key];
    }

    // 2. 对于未知的新协议，使用增强后的哈希算法防止短字符串碰撞
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        // 引入更复杂的位移扰动，打散短字符串的规律
        hash = key.charCodeAt(i) + ((hash << 5) - hash) + (hash >> 2);
        hash = hash & hash; // 转换为 32位 整数
    }
    return tagColorPalette[Math.abs(hash) % tagColorPalette.length];
}

async function loadNodesList() {
    try {
        const response = await fetch('/api/get-nodes');
        const result = await response.json();

        if (result.status === 'success') {
            window.allNodesData = {};

            const cacheNodes = (nodes) => {
                if (nodes) nodes.forEach(n => window.allNodesData[n.uuid] = n);
            };
            cacheNodes(result.data.direct_nodes);
            cacheNodes(result.data.land_nodes);
            window.panelUrl = result.data.panel_url;

            renderNodes('direct-nodes-list', result.data.direct_nodes, '#34c759');
            renderNodes('land-nodes-list', result.data.land_nodes, '#f5a623');

            initDragAndDrop();
        } else {
            showErrorState('direct-nodes-list');
            showErrorState('land-nodes-list');
        }
    } catch (error) {
        console.error('获取节点列表失败:', error);
        showErrorState('direct-nodes-list');
    }
}

function initDragAndDrop() {
    const directList = document.getElementById('direct-nodes-list');
    const landList = document.getElementById('land-nodes-list');

    const sortableOptions = {
        group: 'active-nodes',
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: function (evt) {
            const toList = evt.to;

            let targetRoutingType = 1;
            if (toList.id === 'land-nodes-list') {
                targetRoutingType = 2;
            }

            const nodeItems = toList.querySelectorAll('.node-item');
            const uuidList = Array.from(nodeItems).map(el => el.getAttribute('data-uuid'));
            const cleanUUIDs = uuidList.filter(id => id);

            saveNodeOrder(targetRoutingType, cleanUUIDs);

            if (evt.from !== evt.to) {
                let sourceRoutingType = 1;
                if (evt.from.id === 'land-nodes-list') sourceRoutingType = 2;

                const sourceItems = evt.from.querySelectorAll('.node-item');
                const sourceUUIDs = Array.from(sourceItems).map(el => el.getAttribute('data-uuid')).filter(id => id);

                setTimeout(() => {
                    saveNodeOrder(sourceRoutingType, sourceUUIDs);
                }, 200);

                if (sourceUUIDs.length === 0) {
                    evt.from.innerHTML = `<div style="text-align: center; color: #999; font-size: 13px; margin-top: 30px;" class="empty-tip">暂无节点数据</div>`;
                }
            }

            Array.from(toList.children).forEach(child => {
                if (!child.classList.contains('node-item') && !child.classList.contains('sortable-ghost')) {
                    child.remove();
                }
            });
        }
    };

    if (directList) new Sortable(directList, sortableOptions);
    if (landList) new Sortable(landList, sortableOptions);
}

async function saveNodeOrder(routingType, uuids) {
    try {
        await fetch('/api/reorder-nodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                target_routing_type: routingType,
                node_uuids: uuids
            })
        });
    } catch (e) { console.error("排序保存失败", e); }
}

function showErrorState(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = `<div style="text-align: center; color: #d74242; font-size: 13px; margin-top: 30px;">数据加载失败</div>`;
    }
}

// =========================================================
// 核心优化：节点列表项渲染逻辑
// =========================================================
function renderNodes(containerId, nodes, dotColor) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    if (!nodes || nodes.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: #999; font-size: 13px; margin-top: 30px;" class="empty-tip">暂无节点数据</div>`;
        return;
    }

    nodes.forEach(node => {
        const item = document.createElement('div');
        item.className = 'node-item';
        item.setAttribute('data-uuid', node.uuid);

        if (node.is_blocked) item.classList.add('is-blocked');
        const finalDotColor = node.is_blocked ? '#d74242' : dotColor;

        // 1. 处理跨平台国旗显示 (调用外部 flagcdn 接口转换图片)
        let flagHTML = `<span style="margin-right: 8px; font-size: 16px; display: inline-block; width: 22px; text-align: center;">🌐</span>`;
        if (node.region && node.region.trim() !== '') {
            const isoCode = node.region.trim().toLowerCase();
            // ✨ 修复 1: 去掉 /w20/ 限制，并将 .png 改为原生矢量 .svg (无限清晰)
            // ✨ 修复 2: 加上 loading="lazy"，不在屏幕视野内的节点国旗不会占用初次加载的网络资源
            flagHTML = `<img src="https://flagcdn.com/${isoCode}.svg" loading="lazy" alt="${isoCode}" style="width: 22px; height: 16px; object-fit: cover; margin-right: 8px; border-radius: 2px; box-shadow: 0 0 2px rgba(0,0,0,0.15);">`;
        }

        // 2. 动态生成启用的协议标签 (应用全新的自动调色盘算法)
        const linksMap = node.links || {};
        const disabledArr = node.disabled_links || [];
        const activeProtos = Object.keys(linksMap).filter(p => !disabledArr.includes(p));

        let tagsHTML = '';
        if (activeProtos.length > 0) {
            tagsHTML = activeProtos.map(proto => {
                const color = getProtoColor(proto);
                return `<span class="proto-tag" style="background-color: ${color.bg}; color: ${color.text};">${proto}</span>`;
            }).join('');
        } else {
            tagsHTML = `<span style="font-size:11px; color:#ccc;">暂无有效协议</span>`;
        }

        // 3. 拖拽手柄
        let dragHandleHTML = `
                    <div class="drag-handle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                    </div>
                `;

        let ipTagsHTML = '';
        if (node.ipv4 && node.ipv4.trim() !== '') {
            ipTagsHTML += `<span style="font-size: 9px; font-weight: 600; background: #f5f5f7; color: #888; padding: 1px 4px; border-radius: 4px; margin-left: 6px; border: 1px solid #e5e5ea; line-height: 1.2;">IPV4</span>`;
        }
        if (node.ipv6 && node.ipv6.trim() !== '') {
            const marginLeft = ipTagsHTML !== '' ? '4px' : '6px';
            ipTagsHTML += `<span style="font-size: 9px; font-weight: 600; background: #f5f5f7; color: #888; padding: 1px 4px; border-radius: 4px; margin-left: ${marginLeft}; border: 1px solid #e5e5ea; line-height: 1.2;">IPV6</span>`;
        }

        // ================== 流量计算与独立底部进度条生成逻辑 ==================
        const usedBytes = (node.traffic_up || 0) + (node.traffic_down || 0);
        const limitBytes = node.traffic_limit || 0;

        let trafficBarHTML = '';

        if (usedBytes > 0 || limitBytes > 0) {
            const formatBytes = (bytes) => {
                if (!bytes) return '0GB';
                const gb = bytes / (1024 ** 3);
                return gb >= 1024 ? (gb / 1024).toFixed(2).replace(/\.00$/, '') + 'TB' : gb.toFixed(2).replace(/\.00$/, '') + 'GB';
            };

            const usedStr = formatBytes(usedBytes);
            const limitStr = limitBytes > 0 ? formatBytes(limitBytes) : '∞';
            const trafficText = `${usedStr}${limitBytes > 0 ? ' / ' + limitStr : ''}`;

            if (limitBytes > 0) {
                let pct = (usedBytes / limitBytes) * 100;
                if (pct > 100) pct = 100;

                let barColor = '#34c759'; // 健康: 绿色
                if (pct >= 75) barColor = '#f5a623'; // 预警: 橙色
                if (pct >= 90) barColor = '#ff3b30'; // 危险: 红色

                // 独立出来的厚进度条，采用相对定位，文字绝对居中并带有发光阴影以提高可读性
                // 独立出来的厚进度条，采用相对定位，文字绝对居中并带有发光阴影以提高可读性
                trafficBarHTML = `
                            <div style="position: relative; flex-shrink: 0; width: 100%; height: 16px; background-color: #f0f0f5; border-radius: 8px; overflow: hidden; margin-top: 2px;">
                                <div style="position: absolute; top: 0; left: 0; height: 100%; width: ${pct}%; background-color: ${barColor}; transition: width 0.5s ease;"></div>
                                <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #1d1d1f; text-shadow: 0 0 4px rgba(255,255,255,0.9);">
                                    ${trafficText}
                                </div>
                            </div>
                        `;
            } else {
                // 无限额情况：渲染同等高度的灰色圆角背景带文字
                trafficBarHTML = `
                            <div style="position: relative; flex-shrink: 0; width: 100%; height: 16px; background-color: #f0f0f5; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #666; margin-top: 2px;">
                                已用: ${trafficText}
                            </div>
                        `;
            }
        }
        // ====================================================================

        // 4. 组装 DOM (重构为卡片堆叠式布局)
        item.innerHTML = `
                    <div style="display:flex; align-items:center; justify-content: space-between; width: 100%;">
                        <div style="display:flex; align-items:center;">
                            ${dragHandleHTML}
                            <div class="node-info">
                                <div class="node-name-wrapper">
                                    ${flagHTML}
                                    <span class="node-name">${node.name}</span>
                                    ${ipTagsHTML}
                                </div>
                                <div class="node-tags">${tagsHTML}</div>
                            </div>
                        </div>
                        
                        <div class="node-actions-group">
                            <div class="node-status-dot" style="background: ${finalDotColor}; margin-right: 3px;"></div>
                            
                            <button type="button" onclick="openScriptModal('${node.uuid}')" class="node-action-btn" style="color: #007aff;" title="生成部署脚本">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            </button>

                            <button type="button" onclick="openEditModal('${node.uuid}')" class="node-action-btn" style="color: #007aff;" title="编辑节点">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>

                            <button type="button" onclick="openDeleteModal('${node.uuid}')" class="node-action-btn" style="color: #d74242;" title="删除节点">
                                <svg style="pointer-events: none; width: 18px; height: 18px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                        </div>
                    </div>
                    ${trafficBarHTML}
                `;
        container.appendChild(item);
    });
}

// 打开删除确认弹窗
function openDeleteModal(uuid) {
    currentDeleteUUID = uuid;
    const modal = document.getElementById('deleteModal');
    if (modal) modal.style.display = 'flex';
}

// 关闭删除弹窗
function closeDeleteModal() {
    currentDeleteUUID = null;
    const modal = document.getElementById('deleteModal');
    if (modal) modal.style.display = 'none';
}

// 确认删除
async function confirmDeleteNode() {
    if (!currentDeleteUUID) return;
    try {
        const response = await fetch('/api/delete-node', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid: currentDeleteUUID })
        });
        const result = await response.json();
        if (result.status === 'success') {
            closeDeleteModal();
            loadNodesList();
        } else {
            alert('删除失败: ' + result.message);
        }
    } catch (error) { alert('网络错误，请稍后重试'); }
}



// 页面加载时检查
document.addEventListener('DOMContentLoaded', function () {
    // 只有在非 HTTPS 且 用户未点击过关闭 时才显示
    const isSecure = window.location.protocol === 'https:';
    const isDismissed = localStorage.getItem('hide_security_warn');

    if (!isSecure && !isDismissed) {
        document.getElementById('security-banner').style.display = 'flex';
    }
});

function dismissSecurityBanner() {
    document.getElementById('security-banner').style.display = 'none';
    // 写入本地存储，永久关闭 (除非清除缓存)
    localStorage.setItem('hide_security_warn', 'true');
}

// === pwd_modal.html ===
const pwdModalEl = document.getElementById('pwdModal');

// 点击遮罩层关闭
pwdModalEl.addEventListener('click', function (e) {
    if (e.target === pwdModalEl) closePwdModal();
});

function openPwdModal() {
    pwdModalEl.classList.add('active');
    document.getElementById('pwdForm').reset();
    document.getElementById('pwdIndicator').style.opacity = '0';

    const btn = document.getElementById('pwdSubmitBtn');
    btn.disabled = false;
    btn.innerText = '确认修改';

    // 临时隐藏右上角下拉菜单防止 z-index 遮挡问题
    const dropdown = document.querySelector('.dropdown-content');
    if (dropdown) {
        dropdown.style.display = 'none';
        setTimeout(() => { dropdown.style.display = ''; }, 100);
    }

    setTimeout(() => document.getElementById('oldPwd').focus(), 100);
}

function closePwdModal() {
    pwdModalEl.classList.remove('active');
}

async function submitPwdChange(e) {
    e.preventDefault();
    const btn = document.getElementById('pwdSubmitBtn');
    const indicator = document.getElementById('pwdIndicator');
    const oldPwd = document.getElementById('oldPwd').value;
    const newPwd = document.getElementById('newPwd').value;
    const confirmPwd = document.getElementById('confirmPwd').value;

    indicator.style.opacity = '0'; // 请求前重置状态

    if (newPwd !== confirmPwd) {
        indicator.innerHTML = `<span style="color:#ff3b30;">两次新密码不一致</span>`;
        indicator.style.opacity = '1';
        return;
    }

    btn.disabled = true;
    btn.innerText = '提交中...';

    try {
        const response = await fetch('/api/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_password: oldPwd, new_password: newPwd, confirm_password: confirmPwd })
        });
        const data = await response.json();

        if (data.status === 'success') {
            // 成功时显示绿色打勾并延迟跳转
            indicator.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg> 修改成功，即将登出...`;
            indicator.style.opacity = '1';
            setTimeout(() => { window.location.href = '/login'; }, 1500);
        } else {
            // 失败时直接在右上角显示红色错误文字
            indicator.innerHTML = `<span style="color:#ff3b30;">${data.message || '修改失败'}</span>`;
            indicator.style.opacity = '1';
            btn.disabled = false;
            btn.innerText = '确认修改';
        }
    } catch (err) {
        indicator.innerHTML = `<span style="color:#ff3b30;">网络请求失败</span>`;
        indicator.style.opacity = '1';
        btn.disabled = false;
        btn.innerText = '确认修改';
    }
}

// === add_node_modal.html ===
const addNodeModalEl = document.getElementById('addNodeModal');

// 点击遮罩层关闭
addNodeModalEl.addEventListener('click', function (e) {
    if (e.target === addNodeModalEl) closeAddNodeModal();
});

function openAddNodeModal() {
    addNodeModalEl.classList.add('active');
    document.getElementById('addNodeForm').reset();

    // 重置提示器状态
    document.getElementById('addNodeIndicator').style.opacity = '0';

    // 重置分组选择，默认选中直连
    document.querySelectorAll('#addNodeModal .add-segment-option').forEach(b => b.classList.remove('active'));
    document.querySelector('#addNodeModal .add-segment-option[data-type="1"]').classList.add('active');
    document.getElementById('nodeGroupVal').value = '1';

    const btn = document.getElementById('addNodeSubmitBtn');
    btn.disabled = false;
    btn.innerText = '确认添加';

    // 自动聚焦输入框，提升体验
    setTimeout(() => document.getElementById('nodeNameInput').focus(), 100);
}

function closeAddNodeModal() {
    addNodeModalEl.classList.remove('active');
}

function selectAddGroup(val, el) {
    document.querySelectorAll('#addNodeModal .add-segment-option').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('nodeGroupVal').value = val;
}

async function submitAddNode(e) {
    e.preventDefault();
    const btn = document.getElementById('addNodeSubmitBtn');
    const indicator = document.getElementById('addNodeIndicator');
    const nodeName = document.getElementById('nodeNameInput').value.trim();
    const routingType = parseInt(document.getElementById('nodeGroupVal').value);
    const resetDay = parseInt(document.getElementById('nodeResetDayInput').value) || 0; // 新增获取重置日

    btn.disabled = true;
    btn.innerText = '处理中...';
    indicator.style.opacity = '0'; // 请求前重置状态

    try {
        const response = await fetch('/api/add-node', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // 新增传递 reset_day 参数
            body: JSON.stringify({ name: nodeName, routing_type: routingType, reset_day: resetDay })
        });
        const data = await response.json();

        if (data.status === 'success') {
            // 成功时显示绿色打勾并延迟关闭
            indicator.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg> 添加成功`;
            indicator.style.opacity = '1';
            setTimeout(() => {
                closeAddNodeModal();
                loadNodesList();
            }, 600);
        } else {
            // 失败时直接在右上角显示红色错误文字
            indicator.innerHTML = `<span style="color:#ff3b30;">${data.message || '添加失败'}</span>`;
            indicator.style.opacity = '1';
            btn.disabled = false;
            btn.innerText = '确认添加';
        }
    } catch (err) {
        indicator.innerHTML = `<span style="color:#ff3b30;">网络请求失败</span>`;
        indicator.style.opacity = '1';
        btn.disabled = false;
        btn.innerText = '确认添加';
    }
}

// === edit_node_modal.html ===
const GLOBAL_SUPPORTED_PROTOCOLS = window.__PROTOCOLS__ || {};

// === edit_node_modal.html ===
const editModalEl = document.getElementById('editNodeModal');
const editModalCard = document.getElementById('editModalCard');

let originalRoutingType = 1;
let isInitializingEdit = false;

function openEditModal(uuid) {
    isInitializingEdit = true;
    const node = window.allNodesData[uuid];
    if (!node) { alert('数据加载异常，请刷新'); return; }

    // 1. 基础信息填充
    document.getElementById('editNodeUUID').value = node.uuid;
    document.getElementById('editNodeName').value = node.name;
    document.getElementById('editNodeResetDay').value = node.reset_day || 0;

    // [新增] 处理流量限额回显 (Bytes -> GB/TB)
    const limitBytes = node.traffic_limit || 0;
    let limitVal = "";
    let limitUnit = "GB";

    if (limitBytes > 0) {
        const tb = 1024 * 1024 * 1024 * 1024;
        const gb = 1024 * 1024 * 1024;
        // 如果能整除 1TB，优先显示 TB，否则显示 GB
        if (limitBytes >= tb && limitBytes % tb === 0) {
            limitVal = limitBytes / tb;
            limitUnit = "TB";
        } else {
            // 保留两位小数并去除末尾的 .00
            limitVal = parseFloat((limitBytes / gb).toFixed(2));
            limitUnit = "GB";
        }
    }
    document.getElementById('editNodeTrafficLimit').value = limitVal;
    document.getElementById('editNodeTrafficUnit').value = limitUnit;

    // [新增] 渲染详细流量统计条与更新时间
    const upBytes = node.traffic_up || 0;
    const downBytes = node.traffic_down || 0;
    const totalUsed = upBytes + downBytes;

    const formatBytes = (bytes) => {
        if (!bytes) return '0GB';
        const gb = bytes / (1024 ** 3);
        return gb >= 1024 ? (gb / 1024).toFixed(2).replace(/\.00$/, '') + 'TB' : gb.toFixed(2).replace(/\.00$/, '') + 'GB';
    };

    const trafficDetailsEl = document.getElementById('editNodeTrafficDetails');
    if (totalUsed > 0 || limitBytes > 0) {
        trafficDetailsEl.style.display = 'block';

        // 计算进度条百分比
        // 计算进度条百分比 (以上传和下载总和为 100%，直观展示流量倾向)
        let upPct = 0; let downPct = 0;
        if (totalUsed > 0) {
            upPct = (upBytes / totalUsed) * 100;
            downPct = (downBytes / totalUsed) * 100;
        }

        // 直接赋值真实占比（两个条的占比加起来必定等于 100%）
        document.getElementById('editNodeTrafficUpBar').style.width = upPct + '%';
        document.getElementById('editNodeTrafficDownBar').style.width = downPct + '%';
        document.getElementById('editNodeTrafficUpText').innerText = formatBytes(upBytes);
        document.getElementById('editNodeTrafficDownText').innerText = formatBytes(downBytes);

        // 格式化更新时间
        if (node.traffic_update_at) {
            const d = new Date(node.traffic_update_at);
            const timeStr = d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0') + ' ' +
                String(d.getHours()).padStart(2, '0') + ':' +
                String(d.getMinutes()).padStart(2, '0');
            document.getElementById('editNodeTrafficTime').innerText = `(更新于 ${timeStr})`;
        } else {
            document.getElementById('editNodeTrafficTime').innerText = '';
        }
    } else {
        trafficDetailsEl.style.display = 'none';
    }

    // 2. 路由类型状态
    if (!node.is_blocked) {
        originalRoutingType = node.routing_type;
    } else {
        originalRoutingType = node.routing_type || 1;
    }
    let uiState = node.is_blocked ? 3 : node.routing_type;
    selectEditGroup(uiState, true);

    // 3. IP 信息渲染
    renderIPInputs(node.ipv4, node.ipv6);

    // 4. 协议列表渲染初始化
    const container = document.getElementById('protocolListContainer');
    container.innerHTML = '';
    const disabledSet = new Set(node.disabled_links || []);

    // ================= 安全模式检测 =================
    let isLinksLocked = false;
    if (node.links) {
        // 后端返回的脱敏数据包含 "🔒"
        isLinksLocked = Object.values(node.links).some(v => v && v.includes('🔒'));
    }

    const addSection = document.getElementById('addProtocolSection');

    if (isLinksLocked) {
        // HTTP 模式：显示顶部大警告
        container.innerHTML = `
                <div class="security-warning-bar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                    <span><b>HTTP 安全模式：</b>仅允许写入、管理启停和删除协议。允许在安全证书界面强制开启忽略安全保护。</span>
                </div>
            `;
        if (addSection) addSection.style.display = 'flex';
    } else {
        // HTTPS 模式
        if (addSection) addSection.style.display = 'flex';
    }

    // 5. 循环渲染协议卡片
    if (node.links && Object.keys(node.links).length > 0) {
        // 排序：已启用的在前
        const sortedProtos = Object.keys(node.links).sort((a, b) => {
            const aDis = disabledSet.has(a);
            const bDis = disabledSet.has(b);
            if (aDis === bDis) return 0;
            return aDis ? 1 : -1;
        });

        for (const proto of sortedProtos) {
            const link = node.links[proto];
            const isEnabled = !disabledSet.has(proto);
            // 核心：传入 isLinksLocked 状态
            renderProtocolCard(proto, link, isEnabled, false, isLinksLocked);
        }
    } else if (!isLinksLocked) {
        // 如果不是锁定模式且无数据，显示提示
        // (锁定模式下已经有警告条了，不需要这个提示)
        container.innerHTML += `<div style="text-align:center; color:#999; padding:20px; font-size:12px;">暂无协议节点</div>`;
    }

    updateLayoutState();
    editModalEl.classList.add('active');

    // 强制展开右侧 (HTTP 模式下也要展开，因为有警告条和可能的列表)
    if (isLinksLocked || (node.links && Object.keys(node.links).length > 0)) {
        editModalCard.classList.add('has-content');
    }

    setTimeout(() => { isInitializingEdit = false; }, 100);
}

// 渲染多行协议卡片 (支持折叠)
function renderProtocolCard(proto, link, isEnabled, isNew, isLocked = false) {
    const div = document.createElement('div');
    div.className = 'protocol-card';
    if (isNew) div.classList.add('expanded'); // 新增的协议默认展开
    div.setAttribute('data-proto', proto);
    if (!isEnabled) div.classList.add('disabled');
    if (isLocked) div.classList.add('locked-mode'); // HTTP 模式专用样式类

    // 开关状态
    const checkedState = isEnabled ? 'checked' : '';

    // 协议徽章颜色
    let badgeColor = '#666';
    if (window.getProtoColor) {
        const c = window.getProtoColor(proto);
        badgeColor = c.text;
    }

    // 如果是锁定模式，不显示折叠箭头
    let chevronHtml = isLocked ? '' : `<svg class="proto-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

    // 构建 HTML (注意 actions 阻止冒泡，防止点击开关时触发折叠)
    let html = `
            <div class="proto-header" onclick="toggleProtoBody(this)">
                <div class="proto-title">
                    ${chevronHtml}
                    <span class="proto-badge" style="color:${badgeColor}; border-color:${badgeColor}20; background:${badgeColor}10;">
                        ${proto.toUpperCase()}
                    </span>
                </div>
                <div class="proto-actions" onclick="event.stopPropagation()">
                    <label class="switch-sm">
                        <input type="checkbox" class="proto-switch" ${checkedState} onchange="toggleProtocol(this)">
                        <span class="slider-sm"></span>
                    </label>
                    <button type="button" class="btn-icon delete" onclick="removeProtocolCard(this)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>`;

    // 仅在非锁定(HTTPS)模式下才渲染 Textarea，并用 proto-body 容器包裹以实现折叠
    if (!isLocked) {
        // ✨ 给 textarea 加上 oninput="autoResizeTextarea(this); markAsModified()"
        html += `
            <div class="proto-body">
                <textarea class="link-textarea" placeholder="${proto}://..." oninput="autoResizeTextarea(this); markAsModified()" onchange="markAsModified()">${link}</textarea>
            </div>`;
    }

    div.innerHTML = html;

    const container = document.getElementById('protocolListContainer');
    container.appendChild(div);

    if (!isLocked && isNew) {
        const textarea = div.querySelector('.link-textarea');
        // 使用 setTimeout 确保 DOM 已经完全渲染
        if (textarea) setTimeout(() => autoResizeTextarea(textarea), 10);
    }
}
// 文本框高度自适应计算函数
function autoResizeTextarea(el) {
    el.style.height = '1px';
    let offset = -4.5;

    el.style.height = (el.scrollHeight + offset) + 'px';
}
// 处理面板折叠的函数
function toggleProtoBody(headerEl) {
    const card = headerEl.closest('.protocol-card');
    if (card.classList.contains('locked-mode')) return; // HTTP锁定模式禁止交互

    const isExpanding = card.classList.toggle('expanded');

    // ✨ 新增：如果是展开动作，立即重算一次内部输入框的高度
    if (isExpanding) {
        const textarea = card.querySelector('.link-textarea');
        if (textarea) autoResizeTextarea(textarea);
    }
}

// 标记修改
function markAsModified() {
    triggerNodeAutoSave(false);
}

// 切换协议开关
function toggleProtocol(checkbox) {
    const card = checkbox.closest('.protocol-card');
    if (checkbox.checked) {
        card.classList.remove('disabled');
    } else {
        card.classList.add('disabled');
    }
    triggerNodeAutoSave(true);
}

// 删除协议卡片 (双击确认逻辑)
function removeProtocolCard(btn) {
    if (btn.classList.contains('confirm')) {
        // 第二次点击：执行删除
        const card = btn.closest('.protocol-card');
        card.remove();
        updateLayoutState();
        triggerNodeAutoSave(true);
    } else {
        // 第一次点击：进入确认状态
        btn.classList.add('confirm');
        // 2秒后自动恢复
        setTimeout(() => {
            if (btn) btn.classList.remove('confirm');
        }, 2000);
    }
}

// 自动保存函数 (适配 HTTPS 和 HTTP 模式)
let editNodeAutoSaveTimer = null;
function triggerNodeAutoSave(immediate = false) {
    if (!document.getElementById('editNodeModal').classList.contains('active')) {
        return;
    }

    if (isInitializingEdit) return;

    const uuid = document.getElementById('editNodeUUID').value;
    if (!uuid) return;

    clearTimeout(editNodeAutoSaveTimer);
    const indicator = document.getElementById('editSaveIndicator');
    indicator.innerHTML = '<span style="color:#888;">保存中...</span>';
    indicator.style.opacity = '1';

    const delayMs = immediate ? 0 : 700;

    editNodeAutoSaveTimer = setTimeout(async () => {
        const name = document.getElementById('editNodeName').value;
        const uiState = parseInt(document.getElementById('editNodeUIState').value);
        const resetDay = parseInt(document.getElementById('editNodeResetDay').value) || 0;

        // [新增] 获取流量限额并转为 Bytes
        const limitInput = parseFloat(document.getElementById('editNodeTrafficLimit').value) || 0;
        const limitUnit = document.getElementById('editNodeTrafficUnit').value;
        let trafficLimit = 0;
        if (limitInput > 0) {
            const multiplier = limitUnit === 'TB' ? (1024 ** 4) : (1024 ** 3);
            trafficLimit = Math.floor(limitInput * multiplier);
        }

        const v4El = document.getElementById('editNodeIPV4');
        const v6El = document.getElementById('editNodeIPV6');
        const ipv4 = v4El ? v4El.value.trim() : "";
        const ipv6 = v6El ? v6El.value.trim() : "";

        let finalRoutingType = 1;
        let finalIsBlocked = false;
        if (uiState === 3) {
            finalIsBlocked = true;
            finalRoutingType = originalRoutingType;
        } else {
            finalIsBlocked = false;
            finalRoutingType = uiState;
        }

        const links = {};
        const disabledLinks = [];

        const listContainer = document.getElementById('protocolListContainer');
        const cards = listContainer.querySelectorAll('.protocol-card');

        cards.forEach(card => {
            const proto = card.getAttribute('data-proto');
            // ✨ 核心修复：更新获取输入框的 Class 名称为 .link-textarea
            const input = card.querySelector('.link-textarea');
            const toggle = card.querySelector('.proto-switch');

            // 只要开关存在，就说明协议卡片存在
            if (toggle) { // 只要开关存在，说明卡片未被删除
                if (input) {
                    // 1. 如果有输入框 (HTTPS模式 或 新添加的协议)，正常取值
                    const linkVal = input.value.trim();
                    if (linkVal && !linkVal.includes('🔒')) {
                        links[proto] = linkVal;
                    }
                } else {
                    // 2. [关键修改] HTTP模式下的旧协议没有输入框
                    // 我们传入一个特殊标记，告诉后端保留数据库里的原值
                    links[proto] = "__KEEP_EXISTING__";
                }

                if (!toggle.checked) disabledLinks.push(proto);
            }
        });

        try {
            const response = await fetch('/api/update-node', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uuid, name,
                    routing_type: finalRoutingType,
                    links,
                    is_blocked: finalIsBlocked,
                    disabled_links: disabledLinks,
                    ipv4, ipv6,
                    reset_day: resetDay,
                    traffic_limit: trafficLimit // [新增] 提交限额 (Bytes)
                })
            });
            const res = await response.json();

            if (res.status === 'success') {
                indicator.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg> 已保存`;
                setTimeout(() => indicator.style.opacity = '0', 2000);

                if (typeof loadNodesList === 'function') loadNodesList();
            } else {
                // 🚨关键修复：读取并展示后端的 res.message 错误详情
                indicator.innerHTML = `<span style="color:#ff3b30;">保存失败: ${res.message || '未知错误'}</span>`;
            }
        } catch (err) {
            indicator.innerHTML = '<span style="color:#ff3b30;">网络错误</span>';
        }
    }, delayMs);
}

// IP 渲染相关辅助函数
// IP 渲染相关辅助函数
function renderIPInputs(ipv4, ipv6) {
    const ipContainer = document.getElementById('ipEditContainer');
    const v4 = ipv4 || '';
    const v6 = ipv6 || '';
    let html = '';

    // [修改点] 将 v4Html 更改为 Flex 横向布局，标签限宽，输入框居中
    const v4Html = `
            <div class="edit-section" id="section-ipv4" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                <label class="section-label" style="margin-bottom: 0; white-space: nowrap; width: 70px;">IPv4 地址</label>
                <input type="text" id="editNodeIPV4" class="ip-input" value="${v4}" placeholder="x.x.x.x" oninput="triggerNodeAutoSave()" style="flex: 1; text-align: center;">
            </div>`;

    // [修改点] 将 v6Html 更改为 Flex 横向布局，标签限宽，输入框居中
    const v6Html = `
            <div class="edit-section" id="section-ipv6" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                <label class="section-label" style="margin-bottom: 0; white-space: nowrap; width: 70px;">IPv6 地址</label>
                <input type="text" id="editNodeIPV6" class="ip-input" value="${v6}" placeholder="::1" oninput="triggerNodeAutoSave()" style="flex: 1; text-align: center;">
            </div>`;

    if (v4 && v6) {
        html = v4Html + v6Html;
    } else if ((v4 && !v6) || (!v4 && !v6)) {
        // [逻辑未变] 保留原有的 IPv6 隐藏折叠逻辑
        html = v4Html + `<div style="text-align:right; margin-top:-5px; margin-bottom: 15px;"><a class="add-ip-link" onclick="appendIPField('v6')">+ 补充 IPv6</a></div>`;
    } else if (!v4 && v6) {
        html = v6Html + `<div style="text-align:right; margin-top:-5px; margin-bottom: 15px;"><a class="add-ip-link" onclick="appendIPField('v4')">+ 补充 IPv4</a></div>`;
    }
    ipContainer.innerHTML = html;
}

function appendIPField(type) {
    const ipContainer = document.getElementById('ipEditContainer');
    const links = ipContainer.querySelectorAll('.add-ip-link');
    links.forEach(l => l.parentElement.remove());

    // [修改点] 同步更新追加的输入框样式为横向 Flex 布局
    if (type === 'v6' && !document.getElementById('editNodeIPV6')) {
        const v6Html = `
                <div class="edit-section" id="section-ipv6" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; animation: fadeIn 0.3s;">
                    <label class="section-label" style="margin-bottom: 0; white-space: nowrap; width: 70px;">IPv6 地址</label>
                    <input type="text" id="editNodeIPV6" class="ip-input" value="" placeholder="::1" oninput="triggerNodeAutoSave()" style="flex: 1; text-align: center;">
                </div>`;
        ipContainer.insertAdjacentHTML('beforeend', v6Html);
    } else if (type === 'v4' && !document.getElementById('editNodeIPV4')) {
        const v4Html = `
                <div class="edit-section" id="section-ipv4" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; animation: fadeIn 0.3s;">
                    <label class="section-label" style="margin-bottom: 0; white-space: nowrap; width: 70px;">IPv4 地址</label>
                    <input type="text" id="editNodeIPV4" class="ip-input" value="" placeholder="x.x.x.x" oninput="triggerNodeAutoSave()" style="flex: 1; text-align: center;">
                </div>`;
        ipContainer.insertAdjacentHTML('afterbegin', v4Html);
    }
}

function closeEditModal() {
    editModalEl.classList.remove('active');
    setTimeout(() => { editModalCard.classList.remove('has-content'); }, 300);
}

function updateLayoutState() {
    const container = document.getElementById('protocolListContainer');
    if (container.children.length > 0) {
        editModalCard.classList.add('has-content');
    } else {
        editModalCard.classList.remove('has-content');
    }

    const existingProtos = new Set();
    container.querySelectorAll('.protocol-card').forEach(card => {
        existingProtos.add(card.getAttribute('data-proto'));
    });
    const availableProtos = GLOBAL_SUPPORTED_PROTOCOLS.filter(p => !existingProtos.has(p));

    const addSection = document.getElementById('addProtocolSection');
    if (addSection) {
        if (availableProtos.length === 0) addSection.style.display = 'none';
        else addSection.style.display = 'block';
    }
}

function selectEditGroup(val, skipSave = false) {
    document.getElementById('editNodeUIState').value = val;
    document.querySelectorAll('.segment-option').forEach(el => {
        el.classList.remove('active');
        if (parseInt(el.getAttribute('data-type')) === val) el.classList.add('active');
    });
    if (val === 1 || val === 2) originalRoutingType = val;
    if (!skipSave) triggerNodeAutoSave(true);
}

function showAddProtocolMenu() {
    const container = document.getElementById('protocolListContainer');
    const listEl = document.getElementById('protoSelectList');
    listEl.innerHTML = '<div style="font-size:11px; color:#999; margin-bottom:6px; padding-left:6px; font-weight: 600;">选择协议类型</div>';

    const existingProtos = new Set();
    container.querySelectorAll('.protocol-card').forEach(card => {
        existingProtos.add(card.getAttribute('data-proto'));
    });

    const availableProtos = GLOBAL_SUPPORTED_PROTOCOLS.filter(p => !existingProtos.has(p));

    if (availableProtos.length === 0) {
        alert('所有支持的协议均已添加');
        return;
    }

    availableProtos.forEach(proto => {
        const item = document.createElement('div');
        item.innerText = proto.toUpperCase();
        item.style.padding = '8px 12px';
        item.style.cursor = 'pointer';
        item.style.borderRadius = '6px';
        item.style.fontSize = '13px';
        item.style.fontWeight = '600';
        item.style.color = '#333';
        item.onmouseover = () => item.style.background = '#f0f7ff';
        item.onmouseout = () => item.style.background = 'white';
        item.onclick = () => {
            insertProtocolCard(proto);
            document.getElementById('protoSelectOverlay').style.display = 'none';
        };
        listEl.appendChild(item);
    });

    document.getElementById('protoSelectOverlay').style.display = 'flex';
}

function insertProtocolCard(proto) {
    renderProtocolCard(proto, '', true, true);
    updateLayoutState();
    triggerNodeAutoSave();
}

// === install_script_modal.html ===
const scriptModal = document.getElementById('installScriptModal');
const cmdDisplay = document.getElementById('installCmdDisplay');
const checkboxContainer = document.getElementById('protocolCheckboxes');
let currentScriptNode = null;

// 协议名称映射与展示名
const protocolArgMap = {
    "vless": { arg: "vless", label: "VLESS Reality" },
    "ss": { arg: "shadowsocks", label: "Shadowsocks" },
    "hy2": { arg: "hysteria2", label: "Hysteria2" },
    "tuic": { arg: "tuic", label: "TUIC" },
    "socks": { arg: "socks5", label: "SOCKS5" }
};

function openScriptModal(uuid) {
    currentScriptNode = window.allNodesData[uuid];
    if (!currentScriptNode) return;

    if (!currentScriptNode.install_id) {
        alert("该节点未生成 InstallID，请先编辑保存一次");
        return;
    }

    // 解析当前节点已开启的协议，默认勾选
    let activeProtocols = [];
    if (currentScriptNode.links) {
        const allProtos = Object.keys(currentScriptNode.links);
        const disabledSet = new Set(currentScriptNode.disabled_links || []);
        activeProtocols = allProtos.filter(p => !disabledSet.has(p));
    }

    // 渲染复选框
    checkboxContainer.innerHTML = '';
    for (const [key, info] of Object.entries(protocolArgMap)) {
        const isChecked = activeProtocols.includes(key) ? 'checked' : '';
        checkboxContainer.innerHTML += `
                <label>
                    <input type="checkbox" value="${info.arg}" ${isChecked} onchange="updateScriptCmd()">
                    <div class="protocol-label-btn">${info.label}</div>
                </label>
            `;
    }

    // 初始化命令内容
    updateScriptCmd();
    scriptModal.classList.add('active');
}

function updateScriptCmd() {
    if (!currentScriptNode) return;

    let host = window.panelUrl || window.location.origin;
    host = host.replace(/\/+$/, "");

    const checkedBoxes = checkboxContainer.querySelectorAll('input[type="checkbox"]:checked');
    const selectedArgs = Array.from(checkedBoxes).map(cb => cb.value);

    const protocolsArgHtml = selectedArgs.map(p => `<span class="hl-proto">${p}</span>`).join(" ");
    const protocolsArgRaw = selectedArgs.join(" ");

    // URL 已经包含了 id 参数，后端可通过它获取该节点所有信息
    const scriptUrl = `${host}/api/public/install-script?id=${currentScriptNode.install_id}`;

    // 构建带有高亮的 HTML 命令展示 (极致精简，仅传协议参数)
    const cmdHtml =
        `<span class="hl-cmd">bash</span> <span class="hl-param">-c</span> <span class="hl-string">"$(curl -fsSL ${scriptUrl})"</span> <span class="hl-param">--</span> ${protocolsArgHtml}`;

    // 构建纯文本用于剪贴板 (极致精简)
    const rawCmd = `bash -c "$(curl -fsSL ${scriptUrl})" -- ${protocolsArgRaw}`;

    cmdDisplay.innerHTML = cmdHtml;
    cmdDisplay.setAttribute('data-clipboard-text', rawCmd);
}

function closeScriptModal() {
    scriptModal.classList.remove('active');
}

function copyScriptCmd() {
    const text = cmdDisplay.getAttribute('data-clipboard-text');
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.querySelector('.btn-script-copy');
        const originalHtml = btn.innerHTML;
        btn.style.background = '#34c759'; // 浅色UI中更柔和的绿色
        btn.style.borderColor = '#34c759';
        btn.innerHTML = '复制成功!';
        setTimeout(() => {
            btn.style.background = '#007aff';
            btn.style.borderColor = 'transparent';
            btn.innerHTML = originalHtml;
        }, 1500);
    });
}

// === global_settings_modal.html ===
const gsModal = document.getElementById('globalSettingsModal');
const gsModalCard = document.getElementById('gsModalCard');

function selectGsProto(protoId, cardElement) {
    const isAlreadyActive = cardElement.classList.contains('active');
    const isMobile = window.innerWidth <= 768;

    document.querySelectorAll('.proto-nav-card').forEach(c => {
        c.classList.remove('active', 'mobile-expanded');
    });
    document.querySelectorAll('.proto-form').forEach(f => {
        f.style.display = 'none';
        f.classList.remove('mobile-inline-form');
        document.getElementById('gsRightCol').appendChild(f);
    });

    if (isAlreadyActive && isMobile) {
        gsModalCard.classList.remove('has-content');
        return;
    }

    cardElement.classList.add('active');
    const protoName = cardElement.querySelector('.proto-name').innerText;
    document.getElementById('gsRightTitle').innerText = protoName + ' 额外配置';

    const formEl = document.getElementById('gs-form-' + protoId);

    if (isMobile) {
        cardElement.classList.add('mobile-expanded');
        formEl.classList.add('mobile-inline-form');
        cardElement.parentNode.insertBefore(formEl, cardElement.nextSibling);
        gsModalCard.classList.remove('has-content');
    } else {
        document.getElementById('gsRightCol').appendChild(formEl);
        gsModalCard.classList.add('has-content');
    }

    formEl.style.display = 'block';

    if (isMobile) {
        setTimeout(() => {
            cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
}

function adjustGsLayout() {
    const isMobile = window.innerWidth <= 768;
    const activeCard = document.querySelector('.proto-nav-card.active');

    if (!activeCard) {
        if (!isMobile) {
            const firstCard = document.querySelector('.proto-nav-card');
            if (firstCard) selectGsProto(firstCard.getAttribute('data-proto-id'), firstCard);
        }
        return;
    }

    const protoId = activeCard.getAttribute('data-proto-id');
    const formEl = document.getElementById('gs-form-' + protoId);

    if (isMobile) {
        activeCard.classList.add('mobile-expanded');
        formEl.classList.add('mobile-inline-form');
        activeCard.parentNode.insertBefore(formEl, activeCard.nextSibling);
        gsModalCard.classList.remove('has-content');
    } else {
        activeCard.classList.remove('mobile-expanded');
        formEl.classList.remove('mobile-inline-form');
        document.getElementById('gsRightCol').appendChild(formEl);
        gsModalCard.classList.add('has-content');
    }
}

let gsLastIsMobile = window.innerWidth <= 768;
window.addEventListener('resize', () => {
    const currentIsMobile = window.innerWidth <= 768;
    if (currentIsMobile !== gsLastIsMobile) {
        gsLastIsMobile = currentIsMobile;
        if (gsModal.classList.contains('active')) {
            adjustGsLayout();
        }
    }
});

async function openGlobalSettingsModal() {
    document.querySelectorAll('.proto-nav-card').forEach(c => c.classList.remove('active', 'mobile-expanded'));
    document.querySelectorAll('.proto-form').forEach(f => {
        f.style.display = 'none';
        f.classList.remove('mobile-inline-form');
        document.getElementById('gsRightCol').appendChild(f);
    });

    if (window.innerWidth > 768) {
        gsModalCard.classList.add('has-content');
        const firstCard = document.querySelector('.proto-nav-card');
        firstCard.classList.add('active');
        document.getElementById('gsRightTitle').innerText = 'VLESS Reality 额外配置';
        document.getElementById('gs-form-reality').style.display = 'block';
    } else {
        gsModalCard.classList.remove('has-content');
    }

    gsModal.classList.add('active');
    document.getElementById('gsSaveIndicator').style.opacity = '0';

    try {
        const res = await fetch('/api/get-settings');
        const result = await res.json();
        if (result.status === 'success') {
            const data = result.data;
            document.getElementById('gs_proxy_port_ss').value = data.proxy_port_ss || '';

            const ssMethodSelect = document.getElementById('gs_proxy_ss_method');
            if (data.proxy_ss_method) {
                const optionExists = Array.from(ssMethodSelect.options).some(opt => opt.value === data.proxy_ss_method);
                if (!optionExists) {
                    ssMethodSelect.add(new Option(data.proxy_ss_method, data.proxy_ss_method));
                }
                ssMethodSelect.value = data.proxy_ss_method;
            }

            document.getElementById('gs_proxy_port_hy2').value = data.proxy_port_hy2 || '';
            document.getElementById('gs_proxy_port_tuic').value = data.proxy_port_tuic || '';
            document.getElementById('gs_proxy_port_reality').value = data.proxy_port_reality || '';
            document.getElementById('gs_proxy_reality_sni').value = data.proxy_reality_sni || '';
            document.getElementById('gs_proxy_port_socks5').value = data.proxy_port_socks5 || '';
            document.getElementById('gs_proxy_socks5_user').value = data.proxy_socks5_user || '';
            document.getElementById('gs_proxy_socks5_pass').value = data.proxy_socks5_pass || '';
        }
    } catch (e) { console.error("加载配置失败", e); }
}

function closeGlobalSettingsModal() {
    gsModal.classList.remove('active');
    setTimeout(() => gsModalCard.classList.remove('has-content'), 300);
}

let gsAutoSaveTimer = null;
function triggerGsAutoSave() {
    if (!document.getElementById('globalSettingsModal').classList.contains('active')) {
        return;
    }

    clearTimeout(gsAutoSaveTimer);
    const indicator = document.getElementById('gsSaveIndicator');
    indicator.innerHTML = '<span style="color:#888;">保存中...</span>';
    indicator.style.opacity = '1';

    gsAutoSaveTimer = setTimeout(async () => {
        const payload = {
            "proxy_port_ss": document.getElementById('gs_proxy_port_ss').value,
            "proxy_ss_method": document.getElementById('gs_proxy_ss_method').value,
            "proxy_port_hy2": document.getElementById('gs_proxy_port_hy2').value,
            "proxy_port_tuic": document.getElementById('gs_proxy_port_tuic').value,
            "proxy_port_reality": document.getElementById('gs_proxy_port_reality').value,
            "proxy_reality_sni": document.getElementById('gs_proxy_reality_sni').value,
            "proxy_port_socks5": document.getElementById('gs_proxy_port_socks5').value,
            "proxy_socks5_user": document.getElementById('gs_proxy_socks5_user').value,
            "proxy_socks5_pass": document.getElementById('gs_proxy_socks5_pass').value
        };

        try {
            const response = await fetch('/api/update-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (response.ok) {
                indicator.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg> 已保存`;
                setTimeout(() => indicator.style.opacity = '0', 2000);
            }
        } catch (error) {
            indicator.innerHTML = '<span style="color:#ff3b30;">保存失败</span>';
        }
    }, 600);
}

// === system_settings_modal.html ===
const sysModal = document.getElementById('systemSettingsModal');
const sysModalCard = document.getElementById('sysModalCard');
let hasCheckedGeo = false;
let geoState = 'checking';
let hasCheckedMihomo = false;
let mihomoState = 'checking';
let sysMonitorTimer = null; // 监控定时器

// 手风琴/分栏切换核心逻辑
function selectSysCategory(catId, cardElement) {
    const isAlreadyActive = cardElement.classList.contains('active');
    const isMobile = window.innerWidth <= 768;

    // 停止之前的监控
    stopSysMonitor();

    document.querySelectorAll('.sys-nav-card').forEach(c => c.classList.remove('active', 'mobile-expanded'));
    document.querySelectorAll('.sys-form-section').forEach(f => {
        f.style.display = 'none';
        f.classList.remove('sys-mobile-inline-form');
        document.getElementById('sysRightCol').appendChild(f);
    });

    if (isAlreadyActive && isMobile) {
        sysModalCard.classList.remove('has-content');
        return;
    }

    cardElement.classList.add('active');
    // const catName = cardElement.querySelector('.sys-nav-name').innerText.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '').trim();
    // document.getElementById('sysRightTitle').innerText = catName;

    const formEl = document.getElementById('sys-form-' + catId);

    if (catId === 'geo' && !hasCheckedGeo) {
        checkGeoStatus();
    } else if (catId === 'mihomo' && !hasCheckedMihomo) {
        checkMihomoStatus();
    } else if (catId === 'monitor') {
        startSysMonitor(); // ✨ 开启系统实时监控
    }

    if (isMobile) {
        cardElement.classList.add('mobile-expanded');
        formEl.classList.add('sys-mobile-inline-form');
        cardElement.parentNode.insertBefore(formEl, cardElement.nextSibling);
        sysModalCard.classList.remove('has-content');
    } else {
        document.getElementById('sysRightCol').appendChild(formEl);
        sysModalCard.classList.add('has-content');
    }

    formEl.style.display = 'block';

    if (isMobile) {
        setTimeout(() => cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }

    // 核心修复：将 id 改为 catId
    if (catId === 'cert') {
        loadCertInfo(); // 加载证书信息
    }
}

function adjustSysLayout() {
    const isMobile = window.innerWidth <= 768;
    const activeCard = document.querySelector('.sys-nav-card.active');

    if (!activeCard) {
        if (!isMobile) {
            const firstCard = document.querySelector('.sys-nav-card');
            if (firstCard) selectSysCategory(firstCard.getAttribute('data-sys-id'), firstCard);
        }
        return;
    }

    const catId = activeCard.getAttribute('data-sys-id');
    const formEl = document.getElementById('sys-form-' + catId);

    if (isMobile) {
        activeCard.classList.add('mobile-expanded');
        formEl.classList.add('sys-mobile-inline-form');
        activeCard.parentNode.insertBefore(formEl, activeCard.nextSibling);
        sysModalCard.classList.remove('has-content');
    } else {
        activeCard.classList.remove('mobile-expanded');
        formEl.classList.remove('sys-mobile-inline-form');
        document.getElementById('sysRightCol').appendChild(formEl);
        sysModalCard.classList.add('has-content');
    }
}

let sysLastIsMobile = window.innerWidth <= 768;
window.addEventListener('resize', () => {
    const currentIsMobile = window.innerWidth <= 768;
    if (currentIsMobile !== sysLastIsMobile) {
        sysLastIsMobile = currentIsMobile;
        if (sysModal.classList.contains('active')) adjustSysLayout();
    }
});

function generateNewSubToken() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById('sys_sub_token').value = token;
    triggerSysAutoSave();
}

// 功能：拉取所有后端设置，并渲染到表单和证书状态 UI 中
async function loadAllSystemSettings() {
    try {
        const res = await fetch('/api/get-settings');
        const result = await res.json();
        if (result.status === 'success') {
            const data = result.data;
            const certInfo = result.cert_info;

            // 1. 基础配置
            document.getElementById('sys_panel_url').value = data.panel_url || '';
            document.getElementById('sys_sub_token').value = data.sub_token || '';
            document.getElementById('sys_pref_flag').checked = data.pref_use_emoji_flag !== 'false';
            document.getElementById('sys_pref_ip_strategy').value = data.pref_ip_strategy || 'ipv4_prefer';
            document.getElementById('sys_airport_filter_invalid').checked = (data.airport_filter_invalid === 'true');
            document.getElementById('sys_pref_speed_test_mode').value = data.pref_speed_test_mode || 'ping_speed';
            document.getElementById('sys_pref_speed_test_file_size').value = data.pref_speed_test_file_size || '50';
            document.getElementById('sys_clash_proxies_update_interval').value = data.clash_proxies_update_interval || '300';
            document.getElementById('sys_clash_rules_update_interval').value = data.clash_rules_update_interval || '3600';
            document.getElementById('sys_clash_public_rules_update_interval').value = data.clash_public_rules_update_interval || '86400';


            // TG Bot 配置
            document.getElementById('sys_tg_bot_token').value = data.tg_bot_token || '';
            document.getElementById('sys_tg_bot_enabled').checked = (data.tg_bot_enabled === 'true');
            document.getElementById('sys_tg_bot_register_commands').checked = (data.tg_bot_register_commands === 'true');

            // 解析白名单并渲染
            const wListStr = data.tg_bot_whitelist || '';
            tgBotWhitelistItems = wListStr.split(',').filter(Boolean).map(s => {
                const parts = s.split('=');
                return { id: parts[0], remark: parts[1] || '' };
            });
            renderTgWhitelist();

            // 2. 证书与高级配置
            document.getElementById('sys_force_http').checked = (data.sys_force_http === 'true');
            // ✨ 新增：判断当前协议，若是 HTTP 则隐藏部分证书状态栏
            const isHttp = window.location.protocol === 'http:';
            document.getElementById('rowCertDomain').style.display = isHttp ? 'none' : 'flex';
            document.getElementById('rowCertExpire').style.display = isHttp ? 'none' : 'flex';
            document.getElementById('rowCertValid').style.display = isHttp ? 'none' : 'flex';

            // ✨ 新增：HTTPS 模式下直接隐藏“强制 HTTP”风险开关
            const forceHttpRow = document.getElementById('rowForceHttp');
            if (forceHttpRow) forceHttpRow.style.display = isHttp ? 'flex' : 'none';

            document.getElementById('sys_cf_email').value = data.cf_email || '';
            document.getElementById('sys_cf_api_key').value = data.cf_api_key || '';
            document.getElementById('sys_cf_domain').value = data.cf_domain || '';
            // ✨ 新增：读取自动续期状态 (默认开启)
            document.getElementById('sys_cf_auto_renew').checked = (data.cf_auto_renew !== 'false');

            // 3. 渲染证书有效性及重启按钮控制
            const restartBtn = document.getElementById('btnRestartCore');
            const restartDesc = document.getElementById('restartCoreDesc');
            const validDisplay = document.getElementById('certValidDisplay');

            if (certInfo && certInfo.valid) {
                document.getElementById('certDomainDisplay').innerText = certInfo.domain || '--';
                document.getElementById('certExpireDisplay').innerText = certInfo.expire || '--';

                validDisplay.innerText = '✅ 有效';
                validDisplay.className = 'cert-val secure';

                restartBtn.disabled = false;
                restartBtn.style.cursor = 'pointer';

                // ✨ 核心优化：根据当前协议状态智能切换按钮颜色和文案
                if (isHttp) {
                    // HTTP 模式：依然保持红色警告色，催促用户切换到安全的 HTTPS
                    restartBtn.innerHTML = '✅ 证书已就绪，立即重启核心切换 HTTPS';
                    restartBtn.style.background = '#fff0f0';
                    restartBtn.style.borderColor = '#ffcdd2';
                    restartBtn.style.color = '#d32f2f';
                    restartDesc.innerText = '注意：成功配置证书后，必须点击此按钮重启网络核心，HTTPS 才会真正生效。';
                    restartDesc.style.color = '#d32f2f';
                    restartDesc.style.background = '#fff5f5';
                } else {
                    // HTTPS 模式：改为让人安心的绿色，并优化提示语
                    restartBtn.innerHTML = '🔄 立即重启面板核心';
                    restartBtn.style.background = '#eafff1';
                    restartBtn.style.borderColor = '#bbf7d0';
                    restartBtn.style.color = '#16a34a';
                    restartDesc.innerText = '当前已在 HTTPS 安全模式下运行。如您更换了新证书，点击此处重启即可应用生效。';
                    restartDesc.style.color = '#15803d';
                    restartDesc.style.background = '#fafffc';
                }
            } else {
                document.getElementById('certDomainDisplay').innerText = '--';
                document.getElementById('certExpireDisplay').innerText = '--';

                validDisplay.innerText = '❌ 无效或未配置';
                validDisplay.className = 'cert-val warning';

                restartBtn.disabled = true;
                restartBtn.innerHTML = '🚫 证书无效或未就绪，禁止切换';
                restartBtn.style.background = '#f5f5f5';
                restartBtn.style.borderColor = '#ddd';
                restartBtn.style.color = '#999';
                restartBtn.style.cursor = 'not-allowed';
                restartDesc.innerText = '检测到证书缺失或已过期。必须上传有效证书后才能重启切换。';
                restartDesc.style.color = '#666';
                restartDesc.style.background = '#f9f9fc';
            }
        }
    } catch (e) { console.error("加载配置失败", e); }
}

async function openSystemSettingsModal() {
    document.querySelectorAll('.sys-nav-card').forEach(c => c.classList.remove('active', 'mobile-expanded'));
    document.querySelectorAll('.sys-form-section').forEach(f => {
        f.style.display = 'none';
        f.classList.remove('sys-mobile-inline-form');
        document.getElementById('sysRightCol').appendChild(f);
    });

    if (window.innerWidth > 768) {
        sysModalCard.classList.add('has-content');
        const firstCard = document.querySelector('.sys-nav-card');
        firstCard.classList.add('active');
        document.getElementById('sys-form-basic').style.display = 'block';
    } else {
        sysModalCard.classList.remove('has-content');
    }

    sysModal.classList.add('active');
    hasCheckedGeo = false;
    renderGeoBtn('checking');
    hasCheckedMihomo = false;
    renderMihomoBtn('checking');
    document.getElementById('sysSaveIndicator').style.opacity = '0';

    // 弹窗打开时，调用重构后的方法加载所有配置项
    await loadAllSystemSettings();
}

function closeSystemSettingsModal() {
    sysModal.classList.remove('active');
    stopSysMonitor(); // 确保关闭弹窗时停止监控
    setTimeout(() => sysModalCard.classList.remove('has-content'), 300);
}

let sysAutoSaveTimer = null;
function triggerSysAutoSave() {
    if (!document.getElementById('systemSettingsModal').classList.contains('active')) {
        return;
    }

    clearTimeout(sysAutoSaveTimer);
    const indicator = document.getElementById('sysSaveIndicator');
    indicator.innerHTML = '<span style="color:#888;">保存中...</span>';
    indicator.style.opacity = '1';

    sysAutoSaveTimer = setTimeout(async () => {
        const payload = {
            "panel_url": document.getElementById('sys_panel_url').value.trim(),
            "sub_token": document.getElementById('sys_sub_token').value.trim(),
            "pref_use_emoji_flag": document.getElementById('sys_pref_flag').checked ? "true" : "false",
            "pref_ip_strategy": document.getElementById('sys_pref_ip_strategy').value,
            "airport_filter_invalid": document.getElementById('sys_airport_filter_invalid').checked ? "true" : "false", // ✨ 新增：提交剔除无效节点开关
            "pref_speed_test_mode": document.getElementById('sys_pref_speed_test_mode').value,
            "pref_speed_test_file_size": document.getElementById('sys_pref_speed_test_file_size').value,
            "clash_proxies_update_interval": document.getElementById('sys_clash_proxies_update_interval').value,
            "clash_rules_update_interval": document.getElementById('sys_clash_rules_update_interval').value,
            "clash_public_rules_update_interval": document.getElementById('sys_clash_public_rules_update_interval').value,
            "sys_force_http": document.getElementById('sys_force_http').checked ? 'true' : 'false',
            "cf_email": document.getElementById('sys_cf_email').value,
            "cf_api_key": document.getElementById('sys_cf_api_key').value,
            "cf_domain": document.getElementById('sys_cf_domain').value,
            "cf_auto_renew": document.getElementById('sys_cf_auto_renew').checked ? 'true' : 'false', // ✨ 新增
            "tg_bot_enabled": document.getElementById('sys_tg_bot_enabled').checked ? 'true' : 'false',
            "tg_bot_token": document.getElementById('sys_tg_bot_token').value.trim(),
            "tg_bot_whitelist": tgBotWhitelistItems.filter(item => item.id.trim() !== '').map(item => item.id.trim() + (item.remark.trim() ? '=' + item.remark.trim() : '')).join(','),
            "tg_bot_register_commands": document.getElementById('sys_tg_bot_register_commands').checked ? 'true' : 'false'
        };

        if (!payload.sub_token) {
            indicator.innerHTML = '<span style="color:#ff3b30;">Token 不能为空</span>';
            return;
        }

        try {
            const response = await fetch('/api/update-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (response.ok) {
                window.panelUrl = payload.panel_url;
                indicator.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg> 已保存`;

                // ✨ 核心修复：设置保存后静默刷新主页节点列表
                // 这样当你刚开启“强制 HTTP”，内存里的 🔒 就会立刻被替换为真实的链接
                if (typeof loadNodesList === 'function') {
                    loadNodesList();
                }

                setTimeout(() => indicator.style.opacity = '0', 2000);
            } else {
                indicator.innerHTML = '<span style="color:#ff3b30;">保存失败</span>';
            }
        } catch (error) {
            indicator.innerHTML = '<span style="color:#ff3b30;">保存失败</span>';
        }
    }, 600);
}

// ================= Geo API 相关逻辑 =================
// ... 省略了保持不变的 Geo 相关函数 (checkGeoStatus, handleGeoBtnClick, updateGeoDatabase, renderGeoBtn)
async function checkGeoStatus() {
    hasCheckedGeo = true;
    renderGeoBtn('checking');
    try {
        const res = await fetch('/api/get-geo-status');
        const result = await res.json();
        if (result.status === 'success') {
            const data = result.data;
            document.getElementById('sysGeoLocalVersion').innerText = data.local_version || '未下载';
            document.getElementById('sysGeoRemoteVersion').innerText = data.remote_version || '未知';
            let uiState = 'error';
            if (data.state === 'latest') uiState = 'latest';
            else if (data.state === 'update_available' || data.state === 'not_found') uiState = 'update';
            renderGeoBtn(uiState, data.state === 'not_found');
        } else { throw new Error(result.message); }
    } catch (e) {
        document.getElementById('sysGeoRemoteVersion').innerText = "网络错误";
        renderGeoBtn('error');
    }
}
function handleGeoBtnClick() { if (geoState === 'update') updateGeoDatabase(); else if (geoState === 'error') checkGeoStatus(); }

async function updateGeoDatabase() {
    renderGeoBtn('updating');
    try {
        const response = await fetch('/api/update-geoip', { method: 'POST' });
        const result = await response.json();
        if (result.status === 'success') {
            let attempts = 0;
            // 开启轮询，每 2 秒查一次状态
            const pollInterval = setInterval(async () => {
                attempts++;
                if (attempts > 60) { // 约 2 分钟超时 (防止网络卡死无限轮询)
                    clearInterval(pollInterval);
                    checkGeoStatus(); // 超时后恢复常规检查状态
                    return;
                }
                try {
                    const res = await fetch('/api/get-geo-status');
                    const statusData = await res.json();
                    // 只有当后端真实下发了 'latest'，才意味着后台下载并入库完毕了
                    if (statusData.status === 'success' && statusData.data.state === 'latest') {
                        clearInterval(pollInterval); // 停止轮询
                        document.getElementById('sysGeoLocalVersion').innerText = statusData.data.local_version || '--';
                        renderGeoBtn('latest');
                    }
                } catch (e) { }
            }, 2000);
        }
        else { alert("指令发送失败: " + result.message); renderGeoBtn('update'); }
    } catch (e) { alert("请求错误"); renderGeoBtn('update'); }
}

function renderGeoBtn(state, isNotFound = false) {
    geoState = state;
    const btn = document.getElementById('btnSysGeoUpdate');
    const desc = document.getElementById('sysGeoActionDesc');
    const rVer = document.getElementById('sysGeoRemoteVersion');
    if (state === 'checking') {
        btn.className = 'btn-sys-geo-action btn-sys-geo-loading';
        btn.innerHTML = '<svg class="sys-spin" style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> 正在比对版本...';
        desc.innerText = '正在连接 GitHub API 获取版本信息...';
        if (rVer.innerText === '--') rVer.innerText = '检查中...';
    } else if (state === 'updating') {
        btn.className = 'btn-sys-geo-action btn-sys-geo-loading';
        btn.innerHTML = '<svg class="sys-spin" style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> 正在后台下载更新...';
        btn.style.cursor = 'default';
        desc.innerText = '后端正在执行下载和解压任务，请稍候...';
    } else if (state === 'latest') {
        btn.className = 'btn-sys-geo-action btn-sys-geo-latest';
        btn.innerHTML = '<svg style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg> 已是最新版本';
        desc.innerText = '当前数据库已是最新版本，无需执行任何操作。';
    } else if (state === 'update') {
        btn.className = 'btn-sys-geo-action btn-sys-geo-update';
        const actionText = isNotFound ? '立即下载数据库' : '立即更新数据库';
        btn.innerHTML = `<svg style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> ${actionText}`;
        desc.innerText = isNotFound ? '本地未找到数据库文件，请下载以启用 IP 归属地解析。' : '检测到新版本，建议更新以获得更准确的解析。';
    } else if (state === 'error') {
        btn.className = 'btn-sys-geo-action btn-sys-geo-error';
        btn.innerHTML = '<svg style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg> 检查失败，点击重试';
        desc.innerText = '无法获取版本信息，请检查网络连接或稍后重试。';
    }
}

// ================= Mihomo 核心管理 =================
async function checkMihomoStatus() {
    hasCheckedMihomo = true;
    renderMihomoBtn('checking');
    try {
        const res = await fetch('/api/get-mihomo-status');
        const result = await res.json();
        if (result.status === 'success') {
            const data = result.data;
            document.getElementById('sysMihomoLocalVersion').innerText = data.local_version || '未下载';
            document.getElementById('sysMihomoRemoteVersion').innerText = data.remote_version || '未知';
            let uiState = 'error';
            if (data.state === 'latest') uiState = 'latest';
            else if (data.state === 'update_available' || data.state === 'not_found') uiState = 'update';
            renderMihomoBtn(uiState, data.state === 'not_found');
        } else { throw new Error(result.message); }
    } catch (e) {
        document.getElementById('sysMihomoRemoteVersion').innerText = "网络错误";
        renderMihomoBtn('error');
    }
}

function handleMihomoBtnClick() {
    if (mihomoState === 'update') updateMihomoCore();
    else if (mihomoState === 'error') checkMihomoStatus();
}

async function updateMihomoCore() {
    renderMihomoBtn('updating');
    try {
        const response = await fetch('/api/update-mihomo', { method: 'POST' });
        const result = await response.json();
        if (result.status === 'success') {
            let attempts = 0;
            // 开启轮询，每 2 秒查一次状态
            const pollInterval = setInterval(async () => {
                attempts++;
                if (attempts > 60) { // 约 2 分钟超时
                    clearInterval(pollInterval);
                    checkMihomoStatus();
                    return;
                }
                try {
                    const res = await fetch('/api/get-mihomo-status');
                    const statusData = await res.json();
                    // 当状态更新为 latest 时，说明后台任务圆满完成
                    if (statusData.status === 'success' && statusData.data.state === 'latest') {
                        clearInterval(pollInterval);
                        document.getElementById('sysMihomoLocalVersion').innerText = statusData.data.local_version || '--';
                        renderMihomoBtn('latest');
                    }
                } catch (e) { }
            }, 2000);
        } else {
            alert("指令发送失败: " + result.message);
            renderMihomoBtn('update');
        }
    } catch (e) {
        alert("请求错误");
        renderMihomoBtn('update');
    }
}

function renderMihomoBtn(state, isNotFound = false) {
    mihomoState = state;
    const btn = document.getElementById('btnSysMihomoUpdate');
    const desc = document.getElementById('sysMihomoActionDesc');
    const rVer = document.getElementById('sysMihomoRemoteVersion');
    if (state === 'checking') {
        btn.className = 'btn-sys-geo-action btn-sys-geo-loading';
        btn.innerHTML = '<svg class="sys-spin" style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> 正在比对版本...';
        desc.innerText = '正在连接 GitHub API 获取核心版本信息...';
        if (rVer.innerText === '--') rVer.innerText = '检查中...';
    } else if (state === 'updating') {
        btn.className = 'btn-sys-geo-action btn-sys-geo-loading';
        btn.innerHTML = '<svg class="sys-spin" style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> 正在后台下载更新...';
        btn.style.cursor = 'default';
        desc.innerText = '后端正在执行下载和解压核心任务，请稍候...';
    } else if (state === 'latest') {
        btn.className = 'btn-sys-geo-action btn-sys-geo-latest';
        btn.innerHTML = '<svg style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg> 已是最新版本';
        desc.innerText = '当前核心已是最新版本，无需执行任何操作。';
    } else if (state === 'update') {
        btn.className = 'btn-sys-geo-action btn-sys-geo-update';
        const actionText = isNotFound ? '立即下载核心' : '立即更新核心';
        btn.innerHTML = `<svg style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> ${actionText}`;
        desc.innerText = isNotFound ? '本地未找到核心文件，请下载以启用测速及其他核心功能。' : '检测到新版本，建议更新以获得最新的特性。';
    } else if (state === 'error') {
        btn.className = 'btn-sys-geo-action btn-sys-geo-error';
        btn.innerHTML = '<svg style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg> 检查失败，点击重试';
        desc.innerText = '无法获取版本信息，请检查网络连接或稍后重试。';
    }
}

// ================= ✨ 系统监控拉取与渲染 =================
function formatBytes(bytes) {
    if (bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(2) + ' MB';
}

async function fetchSystemMonitor() {
    try {
        const res = await fetch('/api/system-monitor');
        const result = await res.json();
        if (result.status === 'success') {
            const d = result.data;

            // 顶部基础信息
            document.getElementById('sysMonOsArch').innerText = d.os_arch;
            document.getElementById('sysMonGoVer').innerText = d.go_version;

            // 堆内存卡片
            document.getElementById('sysMonHeapInuse').innerText = formatBytes(d.heap_inuse);
            document.getElementById('sysMonHeapSys').innerText = formatBytes(d.heap_sys);
            let heapPct = d.heap_sys > 0 ? ((d.heap_inuse / d.heap_sys) * 100).toFixed(1) : 0;
            document.getElementById('sysMonHeapPct').innerText = heapPct + '%';
            document.getElementById('sysMonHeapBar').style.width = heapPct + '%';

            // CPU 卡片
            document.getElementById('sysMonCpuCores').innerText = d.num_cpu;
            document.getElementById('sysMonCpuMaxProcs').innerText = d.go_max_procs;

            // Goroutines 卡片
            document.getElementById('sysMonGoroutines').innerText = d.num_goroutine;
            document.getElementById('sysMonCgo').innerText = d.num_cgo_call;

            // 运行时间卡片
            document.getElementById('sysMonUptime').innerText = d.uptime;
            document.getElementById('sysMonStart').innerText = d.start_time;

            // 底部详情
            document.getElementById('sysMonGcNum').innerText = d.num_gc;
            document.getElementById('sysMonGcPause').innerText = d.pause_total_ms.toFixed(2) + ' ms';
            document.getElementById('sysMonGcCpu').innerText = (d.gc_cpu_fraction * 100).toFixed(4) + ' %';
            document.getElementById('sysMonSysMem').innerText = formatBytes(d.sys_mem);
            document.getElementById('sysMonTotalAlloc').innerText = formatBytes(d.total_alloc);
            document.getElementById('sysMonStack').innerText = formatBytes(d.stack_inuse);
        }
    } catch (e) {
        console.error("无法获取系统监控数据", e);
    }
}

function startSysMonitor() {
    fetchSystemMonitor(); // 立即执行一次
    if (!sysMonitorTimer) {
        sysMonitorTimer = setInterval(fetchSystemMonitor, 2000); // 每 2 秒拉取一次
    }
}

function stopSysMonitor() {
    if (sysMonitorTimer) {
        clearInterval(sysMonitorTimer);
        sysMonitorTimer = null;
    }
}

// [新增] 证书信息加载逻辑 (仅前端状态)
function loadCertInfo() {
    const proto = window.location.protocol === 'https:' ? 'HTTPS (安全)' : 'HTTP (不安全)';
    const elProto = document.getElementById('certProtoDisplay');
    elProto.innerText = proto;
    elProto.className = window.location.protocol === 'https:' ? 'cert-val secure' : 'cert-val warning';
}

// 当前激活的上传方式 ('file' 或 'text')
let currentCertTab = 'file';

function switchCertTab(tab) {
    currentCertTab = tab;
    document.getElementById('tabBtnFile').className = tab === 'file' ? 'sys-tab-btn active' : 'sys-tab-btn';
    document.getElementById('tabBtnText').className = tab === 'text' ? 'sys-tab-btn active' : 'sys-tab-btn';
    document.getElementById('certTabFile').className = tab === 'file' ? 'sys-tab-content active' : 'sys-tab-content';
    document.getElementById('certTabText').className = tab === 'text' ? 'sys-tab-content active' : 'sys-tab-content';
}

// 统一处理手动配置证书的保存（兼容文件和文本）
async function saveManualCert() {
    const formData = new FormData();

    if (currentCertTab === 'file') {
        const fileCrt = document.getElementById('fileCrt').files[0];
        const fileKey = document.getElementById('fileKey').files[0];
        if (!fileCrt || !fileKey) {
            alert("请同时选择 CRT/PEM 文件和 KEY 文件！");
            return;
        }
        formData.append('cert_file', fileCrt);
        formData.append('key_file', fileKey);
    } else {
        const textCrt = document.getElementById('textCrt').value.trim();
        const textKey = document.getElementById('textKey').value.trim();
        if (!textCrt || !textKey) {
            alert("公钥和私钥文本内容均不能为空！");
            return;
        }
        // 将文本转换为伪装的 File 对象，兼容后端 API
        formData.append('cert_file', new Blob([textCrt], { type: 'text/plain' }), "server.crt");
        formData.append('key_file', new Blob([textKey], { type: 'text/plain' }), "server.key");
    }

    const btn = document.getElementById('btnSaveCert');
    btn.innerText = '验证中...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/save-cert', { method: 'POST', body: formData });
        const json = await res.json();

        if (json.status === 'success') {
            // 等待后端配置拉取并重新渲染 UI 完毕后，再弹窗提示
            await loadAllSystemSettings();
            alert("证书已通过验证并保存！\n\n重启面板核心后生效。");
        } else {
            alert("证书保存失败：\n" + json.message);
        }
    } catch (e) {
        alert("请求失败，请检查网络连接");
    } finally {
        btn.innerText = '📤 保存并验证证书';
        btn.disabled = false;
    }
}

// 执行核心重启的函数 (修复了 DOM 清空导致的空指针异常)
async function triggerCoreRestart() {
    if (!confirm("确定要重启系统核心吗？\n如果已正确配置证书，面板将自动切换到 HTTPS。")) return;

    try {
        const res = await fetch('/api/restart', { method: 'POST' });
        const json = await res.json();

        // ✨ [修复] 在清空页面 DOM 之前，先将强制 HTTP 的状态保存到变量中
        const isForceHttp = document.getElementById('sys_force_http').checked;

        // 覆盖页面，展示重启中的动画效果
        document.body.innerHTML = `
                <div style="display:flex; height:100vh; align-items:center; justify-content:center; flex-direction:column; font-family:sans-serif; background:#f5f5f7;">
                    <div style="font-size: 40px; margin-bottom: 20px;">🔄</div>
                    <h2 style="color:#333; margin-bottom:10px;">${json.message || '系统核心正在重启...'}</h2>
                    <p style="color:#666; font-size:14px;">页面即将自动刷新，并尝试使用配置的安全协议...</p>
                </div>
            `;

        // 延迟两秒后执行智能跳转逻辑
        setTimeout(() => {
            let currentUrl = window.location.href;
            // 使用刚刚保存的变量 isForceHttp 进行判断
            if (window.location.protocol === 'http:' && !isForceHttp) {
                window.location.href = currentUrl.replace('http:', 'https:');
            } else {
                window.location.reload();
            }
        }, 2000);

    } catch (e) {
        alert("指令发送失败，nodectl 面板可能已断开，请手动刷新页面。");
    }
}

// [新增] CF 申请逻辑 (1Panel 风格的真实日志流式拉取)
let logPollInterval;
async function applyCfCert() {
    const email = document.getElementById('sys_cf_email').value;
    const key = document.getElementById('sys_cf_api_key').value;
    const domain = document.getElementById('sys_cf_domain').value;

    if (!email || !key || !domain) {
        alert("请完整填写 Cloudflare 信息");
        return;
    }

    if (!confirm(`确认使用域名 ${domain} 申请证书吗？\n这可能需要几十秒时间，请耐心等待。`)) return;

    const btn = document.getElementById('btnApplyCf');
    const logBox = document.getElementById('cfLogBox');

    btn.innerText = '⏳ 正在处理中...';
    btn.disabled = true;

    logBox.style.display = 'block';
    logBox.innerHTML = '<div><span style="color:#888;">正在连接核心终端拉取日志...</span></div>';

    // 核心轮询器：每秒去后端取一次最新数组并渲染
    const fetchLogs = async () => {
        try {
            const res = await fetch('/api/cert-logs');
            const json = await res.json();
            if (json.status === 'success' && json.data) {
                let html = '';
                json.data.forEach(line => {
                    let colorClass = 'log-info';
                    // 智能赋予颜色
                    if (line.includes('[ERROR]') || line.includes('失败')) colorClass = 'log-err';
                    else if (line.includes('成功！！')) colorClass = 'log-info'; // 沿用原本绿色

                    html += `<div><span class="${colorClass}">${line}</span></div>`;
                });
                logBox.innerHTML = html;
                logBox.scrollTop = logBox.scrollHeight; // 保持底部滚动
            }
        } catch (e) { }
    };

    // 启动轮询器 (每 1000 毫秒执行一次)
    logPollInterval = setInterval(fetchLogs, 1000);

    // 发送阻塞的申请请求
    try {
        const res = await fetch('/api/apply-cert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, api_key: key, domain })
        });
        const json = await res.json();

        // 请求结束后清除定时器，并做最后一次拉取以防漏字
        clearInterval(logPollInterval);
        await fetchLogs();

        if (json.status === 'success') {
            logBox.innerHTML += `<div><span style="color:#a6e22e;">[提示] 证书已成功应用！请点击下方的“立即重启面板核心”切换 HTTPS。</span></div>`;
            await loadAllSystemSettings(); // ✨ 核心修复：申请成功后立刻静默拉取最新状态以解锁重启按钮
        } else {
            logBox.innerHTML += `<div><span class="log-err">❌ 任务执行中断: ${json.message}</span></div>`;
        }
        logBox.scrollTop = logBox.scrollHeight;

    } catch (e) {
        clearInterval(logPollInterval);
        logBox.innerHTML += `<div><span class="log-err">❌ 网络请求失败或后端断开连接</span></div>`;
    } finally {
        btn.innerText = '🚀 重新提交申请';
        btn.disabled = false;
    }
}

// ================= ✨ TG Bot 白名单管理 =================
let tgBotWhitelistItems = [];

function renderTgWhitelist() {
    const container = document.getElementById('tgWhitelistContainer');
    if (!container) return;

    if (tgBotWhitelistItems.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #999; font-size: 12px; padding: 10px;">暂无允许查询的白名单用户</div>';
        return;
    }

    container.innerHTML = tgBotWhitelistItems.map((item, index) => `
            <div class="sys-list-row">
                <input type="text" class="sys-list-input" data-idx="${index}" value="${item.remark}" placeholder="备注 (例如: 张三)" style="flex: 1;" oninput="tgBotWhitelistItems[${index}].remark = this.value; triggerSysAutoSave();" onblur="scheduleCleanEmptyTgWhitelist()">
                <input type="text" class="sys-list-input" data-idx="${index}" value="${item.id}" placeholder="TG ID" style="flex: 2; font-family: monospace;" oninput="tgBotWhitelistItems[${index}].id = this.value; triggerSysAutoSave();" onblur="scheduleCleanEmptyTgWhitelist()">
                <div class="sys-list-del" onclick="deleteTgWhitelistItem(${index})" title="删除">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </div>
            </div>
        `).join('');
}

// 失去焦点时自动清理完全为空的白名单项，防止点击添加后不输入残留空行
function scheduleCleanEmptyTgWhitelist() {
    setTimeout(() => {
        const active = document.activeElement;
        const activeIdxStr = active ? active.getAttribute('data-idx') : null;
        const activePlaceholder = active ? active.getAttribute('placeholder') : null;

        let needsClean = false;
        for (let i = 0; i < tgBotWhitelistItems.length; i++) {
            const item = tgBotWhitelistItems[i];
            if (item.id.trim() === '' && item.remark.trim() === '' && String(i) !== activeIdxStr) {
                needsClean = true;
                break;
            }
        }

        if (needsClean) {
            // 计算需要保留焦点的元素的新 index
            let newActiveIdx = -1;
            if (activeIdxStr !== null) {
                const oldIdx = parseInt(activeIdxStr);
                let keptCount = 0;
                for (let i = 0; i < oldIdx; i++) {
                    const item = tgBotWhitelistItems[i];
                    if (item.id.trim() !== '' || item.remark.trim() !== '') keptCount++;
                }
                newActiveIdx = keptCount;
            }

            tgBotWhitelistItems = tgBotWhitelistItems.filter((item, index) => {
                // 保留非空的，以及当前正在聚焦的
                if (item.id.trim() !== '' || item.remark.trim() !== '') return true;
                if (String(index) === activeIdxStr) return true;
                return false;
            });

            renderTgWhitelist();
            triggerSysAutoSave();

            // 恢复焦点，防止渲染打断用户的连续输入体验
            if (newActiveIdx !== -1 && activePlaceholder) {
                const container = document.getElementById('tgWhitelistContainer');
                if (container) {
                    const inputs = container.querySelectorAll(`input[data-idx="${newActiveIdx}"][placeholder="${activePlaceholder}"]`);
                    if (inputs.length > 0) {
                        inputs[0].focus();
                    }
                }
            }
        }
    }, 150);
}

function addTgWhitelistItem() {
    tgBotWhitelistItems.push({ id: '', remark: '' });
    renderTgWhitelist();

    setTimeout(() => {
        const container = document.getElementById('tgWhitelistContainer');
        container.scrollTop = container.scrollHeight;
        const inputs = container.querySelectorAll('.sys-list-input[placeholder="TG ID"]');
        if (inputs.length > 0) {
            inputs[inputs.length - 1].focus();
        }
    }, 50);
}

function deleteTgWhitelistItem(index) {
    tgBotWhitelistItems.splice(index, 1);
    renderTgWhitelist();
    triggerSysAutoSave();
}

// === update_modal.html ===
// GitHub API 配置
const GITHUB_API_BASE = "https://api.github.com/repos/hobin66/nodectl/releases";
const PER_PAGE = 5; // 增加每次加载的数量，确保能撑满高度以触发滚动

let RAW_VERSION = window.__APP_VERSION__ || "dev";
if (RAW_VERSION === "dev" || RAW_VERSION === "") {
    RAW_VERSION = "v1.0.0"; // 默认开发版本号
}
const DISPLAY_VERSION = RAW_VERSION.replace(/^v/, '');

// 状态管理
let currentPage = 1;
let hasMore = true;
let isFetching = false;
let allReleases = [];

// 版本比对工具函数
function isNewVersionAvailable(current, latest) {
    if (!current || !latest) return false;
    const cleanCurrent = current.replace(/^v/, '');
    const cleanLatest = latest.replace(/^v/, '');
    // 简单对比：只要字符串不相等就认为是新版本 (生产环境建议用更严谨的 semver 对比库)
    return cleanCurrent !== cleanLatest;
}

// 加载发布记录的核心函数
async function loadReleases(page) {
    if (isFetching || !hasMore) return;
    isFetching = true;

    const statusEl = document.getElementById('loadingStatus');
    statusEl.style.display = "block";
    statusEl.innerHTML = page === 1 ? "正在拉取最新数据..." : "正在加载更多历史记录...";

    try {
        // 发起请求
        const res = await fetch(`${GITHUB_API_BASE}?per_page=${PER_PAGE}&page=${page}`);

        if (!res.ok) {
            if (res.status === 403) statusEl.innerHTML = "请求过于频繁，请稍后再试 (GitHub API 限制)。";
            else if (res.status === 404) statusEl.innerHTML = "未找到任何发布记录。";
            else statusEl.innerHTML = `数据请求失败 (HTTP ${res.status})`;
            hasMore = false; // 出错后停止继续加载
            return;
        }

        const data = await res.json();
        // 如果返回的数据少于每页数量，说明没有更多数据了
        if (data.length < PER_PAGE) hasMore = false;

        if (page === 1) {
            // 第一页加载时清空现有列表
            document.getElementById('releaseList').innerHTML = "";
            allReleases = [];
            if (data.length === 0) {
                statusEl.innerHTML = `暂无版本更新记录<br><span style="font-size:12px;opacity:0.7;">(GitHub 仓库尚未发布 Release)</span>`;
                hasMore = false;
                return;
            }
        }

        allReleases = allReleases.concat(data);

        // 检查是否有新版本 (仅在第一页检查)
        if (page === 1 && data.length > 0) {
            const latestRelease = data[0];
            if (isNewVersionAvailable(RAW_VERSION, latestRelease.tag_name)) {
                const badge = document.getElementById('topVersionBadge');
                if (badge) {
                    badge.classList.add('has-update');
                    const cleanLatest = latestRelease.tag_name.replace(/^v/, '');
                    badge.title = `发现新版本: ${cleanLatest}，点击查看更新日志`;
                }
            }
        }

        // 渲染数据
        renderAppend(data);

        // 更新底部状态文字
        if (hasMore) {
            statusEl.innerHTML = "下滑加载更多...";
        } else {
            statusEl.innerHTML = "已加载全部历史记录";
            // 延迟隐藏状态条，让用户看到提示
            setTimeout(() => { statusEl.style.display = "none"; }, 2000);
        }
        currentPage++;

    } catch (e) {
        console.error("加载更新失败:", e);
        statusEl.innerHTML = "网络请求失败，无法连接到 GitHub。";
        hasMore = false;
    } finally {
        isFetching = false;
    }
}

// 简单的 Markdown 解析器
function parseReleaseBody(body) {
    if (!body) return "<span style='color:#999;'>此版本无详细说明。</span>";

    // ✨ 核心修复：抹除 Windows 系统的 \r 回车符，防止产生双重换行
    let html = body.replace(/\r/g, '');

    // 转义 HTML 以防止 XSS
    html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // 处理标题
    html = html.replace(/^### (.*$)/gm, '<strong>$1</strong>');
    html = html.replace(/^## (.*$)/gm, '<strong style="font-size:15px;">$1</strong>');

    // 处理列表项 (将 * 或 - 开头的行转换为列表)
    html = html.replace(/^[\*\-] (.*$)/gm, '<div style="display:flex;gap:6px;margin-bottom:4px;"><span style="color:#007aff;">•</span><span>$1</span></div>');

    // 处理强调/加粗
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 处理代码块
    html = html.replace(/`(.*?)`/g, '<code style="background:#f0f0f5;padding:2px 4px;border-radius:4px;font-family:monospace;font-size:13px;">$1</code>');

    // ✨ 核心修复：防止在块级元素 </div> 之后追加 <br> 导致原生无序列表多出空行
    html = html.replace(/<\/div>\n/g, '</div>');

    // 将剩余的换行符转换为 <br>
    return html.replace(/\n/g, '<br>');
}

// 将新数据追加到列表中
function renderAppend(items) {
    const list = document.getElementById('releaseList');
    let html = "";
    items.forEach(release => {
        let dateStr = "未知日期";
        try {
            dateStr = new Date(release.published_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
        } catch (e) { }

        const displayTag = release.tag_name.replace(/^v/, '');

        html += `
                <div class="release-item">
                    <div class="release-header">
                        <span class="release-version">v${displayTag}</span>
                        <span class="release-date">${dateStr}</span>
                    </div>
                    <div class="release-body">${parseReleaseBody(release.body)}</div>
                </div>
            `;
    });
    // 使用 insertAdjacentHTML 在末尾高效插入新内容
    list.insertAdjacentHTML('beforeend', html);
}

// 打开弹窗
function openUpdateModal() {
    const modal = document.getElementById('updateModal');
    modal.classList.add('active');
    // 锁定 body 滚动，防止穿透
    document.body.style.overflow = 'hidden';

    // 如果是第一次打开且没有数据，则开始加载
    if (allReleases.length === 0 && !isFetching && hasMore) {
        loadReleases(1);
    }
}

// 关闭弹窗
function closeUpdateModal() {
    document.getElementById('updateModal').classList.remove('active');
    // 恢复 body 滚动
    document.body.style.overflow = '';
}

// 初始化逻辑
document.addEventListener("DOMContentLoaded", () => {
    // 设置主页版本号显示
    const badgeText = document.getElementById('versionText');
    if (badgeText) {
        badgeText.innerText = DISPLAY_VERSION;
        badgeText.style.opacity = '1';
    }

    const badge = document.getElementById('topVersionBadge');
    if (badge && !badge.classList.contains('has-update')) {
        badge.title = "当前版本: " + DISPLAY_VERSION + " (点击查看历史)";
    }

    // 绑定无限滚动事件
    const bodyContainer = document.getElementById('updateBody');
    if (bodyContainer) {
        bodyContainer.addEventListener('scroll', function () {
            // 滚动条距离底部小于 30px 时触发加载
            const isNearBottom = this.scrollTop + this.clientHeight >= this.scrollHeight - 30;
            if (isNearBottom && hasMore && !isFetching) {
                loadReleases(currentPage);
            }
        });
    }
});

// === clash_template_modal.html ===
const clashModal = document.getElementById('clashTemplateModal');
let cacheBuiltin = [];
let cacheCustom = [];
let cachePresets = [];
let activeSet = new Set();
let editingCustomName = null;
let deleteTimeoutMap = {};

// 手机端折叠切换逻辑
function toggleMobileAddCustom() {
    if (window.innerWidth > 768) return; // 仅手机端生效
    document.getElementById('clashLeftCol').classList.toggle('expanded');
}

async function openClashModal() {
    clashModal.classList.add('active');
    document.getElementById('builtinModulesContainer').innerHTML = '<div style="font-size:13px; color:#999;">加载中...</div>';

    resetEditState();
    deleteTimeoutMap = {};

    // 手机端初始确保折叠
    document.getElementById('clashLeftCol').classList.remove('expanded');

    try {
        const res = await fetch('/api/clash/settings');
        const result = await res.json();
        if (result.status === 'success') {
            cacheBuiltin = result.data.builtin_modules || [];
            cacheCustom = result.data.custom_modules || [];
            cachePresets = result.data.presets || [];
            activeSet = new Set(result.data.active_modules || []);

            renderPresetsDropdown();
            renderModules();
            matchCurrentStateToPreset();
        }
    } catch (error) { alert('加载配置失败'); }
}

function closeClashModal() {
    clashModal.classList.remove('active');
    resetEditState();
    Object.values(deleteTimeoutMap).forEach(clearTimeout);
    deleteTimeoutMap = {};
}

// ================= ✨ 核心静默保存引擎 =================
let clashAutoSaveTimer = null;
function triggerClashAutoSave(immediate = false) {
    if (!document.getElementById('clashTemplateModal').classList.contains('active')) {
        return;
    }

    clearTimeout(clashAutoSaveTimer);
    const indicator = document.getElementById('clashSaveIndicator');
    indicator.innerHTML = '<span style="color:#888;">保存中...</span>';
    indicator.style.opacity = '1';

    const delayMs = immediate ? 0 : 600;

    clashAutoSaveTimer = setTimeout(async () => {
        const selectedModules = Array.from(activeSet);
        try {
            const res = await fetch('/api/clash/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modules: selectedModules })
            });
            if (res.ok) {
                indicator.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg> 已保存`;
                setTimeout(() => indicator.style.opacity = '0', 2000);
            } else {
                indicator.innerHTML = '<span style="color:#ff3b30;">保存失败</span>';
            }
        } catch (error) {
            indicator.innerHTML = '<span style="color:#ff3b30;">网络错误</span>';
        }
    }, delayMs);
}

// ========================================================

function renderPresetsDropdown() {
    const select = document.getElementById('presetSelect');
    let html = '<option value="-1">自定义配置</option>';
    cachePresets.forEach((p, idx) => {
        html += `<option value="${idx}">${p.name}</option>`;
    });
    select.innerHTML = html;
    select.value = "-1";
}

function matchCurrentStateToPreset() {
    const select = document.getElementById('presetSelect');
    const allAvailableModules = [...cacheBuiltin, ...cacheCustom].map(m => m.name);

    for (let i = 0; i < cachePresets.length; i++) {
        const preset = cachePresets[i];
        const isAll = preset.modules.includes('ALL');
        let isMatch = false;

        if (isAll) {
            isMatch = (activeSet.size === allAvailableModules.length && allAvailableModules.length > 0);
        } else {
            const validPresetModules = preset.modules.filter(m => allAvailableModules.includes(m));
            if (validPresetModules.length === activeSet.size && activeSet.size > 0) {
                isMatch = validPresetModules.every(m => activeSet.has(m));
            }
        }

        if (isMatch) {
            select.value = i.toString();
            return;
        }
    }

    select.value = "-1";
}

function applyPresetFromDropdown(selectEl) {
    const index = selectEl.value;
    if (index === "-1") return;

    const preset = cachePresets[index];
    const isAll = preset.modules.includes('ALL');
    const targetSet = new Set(preset.modules);

    document.querySelectorAll('.clash-module-cb').forEach(cb => {
        if (isAll || targetSet.has(cb.value)) {
            cb.checked = true;
            activeSet.add(cb.value);
        } else {
            cb.checked = false;
            activeSet.delete(cb.value);
        }
        syncLabelStyle(cb);
    });

    matchCurrentStateToPreset();
    triggerClashAutoSave(true); // 切换预设后立即保存
}

function renderModules() {
    const builtinContainer = document.getElementById('builtinModulesContainer');
    const customContainer = document.getElementById('customModulesContainer');
    const customEmptyTip = document.getElementById('customEmptyTip');

    let builtinHtml = '';
    cacheBuiltin.forEach(mod => { builtinHtml += buildModuleHTML(mod, false); });
    builtinContainer.innerHTML = builtinHtml;

    let customHtml = '';
    cacheCustom.forEach(mod => { customHtml += buildModuleHTML(mod, true); });
    customContainer.innerHTML = customHtml;

    if (cacheCustom.length === 0) {
        customEmptyTip.style.display = 'block';
    } else {
        customEmptyTip.style.display = 'none';
    }
}

function buildModuleHTML(mod, isCustom) {
    const isChecked = activeSet.has(mod.name) ? 'checked' : '';
    const activeClass = isChecked ? 'is-checked' : '';
    let iconHtml = (mod.icon && mod.icon.startsWith('http')) ? `<img src="${mod.icon}">` : (mod.icon || '📦');

    let actionsHtml = isCustom ? `
            <div class="custom-actions">
                <button class="btn-edit-custom" onclick="editCustomModule('${mod.name}', event)" title="编辑此自定义规则">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="btn-delete-custom" onclick="deleteCustomModule('${mod.name}', this, event)" title="删除此自定义规则">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            </div>
        ` : '';

    return `
            <label class="clash-module-label ${activeClass}">
                <input type="checkbox" class="clash-module-cb" value="${mod.name}" ${isChecked} style="display:none;" onchange="handleModuleToggle(this)">
                <div class="mod-icon-box">${iconHtml}</div>
                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${mod.name}</span>
                ${actionsHtml}
            </label>
        `;
}

function handleModuleToggle(cb) {
    if (cb.checked) activeSet.add(cb.value);
    else activeSet.delete(cb.value);

    syncLabelStyle(cb);
    matchCurrentStateToPreset();
    triggerClashAutoSave(true); // 手动点击复选框立即保存
}

function syncLabelStyle(cb) {
    const label = cb.closest('.clash-module-label');
    if (cb.checked) label.classList.add('is-checked');
    else label.classList.remove('is-checked');
}

function resetEditState() {
    editingCustomName = null;
    document.getElementById('customModName').value = '';
    document.getElementById('customModIcon').value = '';
    document.getElementById('customModDomain').value = '';
    document.getElementById('customModIP').value = '';
    document.getElementById('customModUrl').value = '';
    document.getElementById('customModType').value = '';

    document.getElementById('editCustomModIPGroup').style.display = 'none';
    document.getElementById('editCustomModUrlGroup').style.display = 'none';

    // 恢复添加链接的按钮
    document.querySelectorAll('.add-ip-link').forEach(link => {
        link.style.display = 'inline-block';
    });

    const btn = document.getElementById('btnAddCustom');
    btn.innerHTML = '<span>+</span> <span>添加并应用配置</span>';
    btn.style.backgroundColor = '';
    btn.classList.remove('editing'); // Reset style appropriately
}

function editCustomModule(name, event) {
    event.preventDefault();
    event.stopPropagation();

    const mod = cacheCustom.find(m => m.name === name);
    if (!mod) return;

    // 手机端如果在编辑时，自动展开左侧抽屉
    if (window.innerWidth <= 768) {
        document.getElementById('clashLeftCol').classList.add('expanded');
    }

    document.getElementById('customModName').value = mod.name || '';
    document.getElementById('customModIcon').value = mod.icon || '';
    document.getElementById('customModDomain').value = mod.domain_url || '';
    document.getElementById('customModIP').value = mod.ip_url || '';
    document.getElementById('customModUrl').value = mod.url || '';
    document.getElementById('customModType').value = mod.type || '';

    // 根据是否有值展开隐藏组
    if (mod.ip_url) {
        document.getElementById('editCustomModIPGroup').style.display = 'block';
        document.querySelector('.add-ip-link[onclick*="IPGroup"]').style.display = 'none';
    } else {
        document.getElementById('editCustomModIPGroup').style.display = 'none';
        document.querySelector('.add-ip-link[onclick*="IPGroup"]').style.display = 'inline-block';
    }

    if (mod.url) {
        document.getElementById('editCustomModUrlGroup').style.display = 'block';
        document.querySelector('.add-ip-link[onclick*="UrlGroup"]').style.display = 'none';
    } else {
        document.getElementById('editCustomModUrlGroup').style.display = 'none';
        document.querySelector('.add-ip-link[onclick*="UrlGroup"]').style.display = 'inline-block';
    }

    editingCustomName = name;
    const btn = document.getElementById('btnAddCustom');
    btn.innerHTML = '<span>✏️</span> <span>保存修改并应用</span>';
    btn.style.backgroundColor = '#f5a623';
    btn.style.borderColor = '#f5a623';
    btn.style.color = '#fff';
}

async function addCustomModule() {
    const name = document.getElementById('customModName').value.trim();
    const icon = document.getElementById('customModIcon').value.trim();
    const domain_url = document.getElementById('customModDomain').value.trim();
    const ip_url = document.getElementById('customModIP').value.trim();
    const url = document.getElementById('customModUrl').value.trim();
    const type = document.getElementById('customModType').value;

    if (!name) return alert('标识名为必填项！');
    if (!domain_url && !ip_url && !url) return alert('请至少填写一种规则集的下载地址！');

    if (editingCustomName) {
        if (name !== editingCustomName && (cacheBuiltin.find(m => m.name === name) || cacheCustom.find(m => m.name === name))) {
            return alert('该名称已存在，请更换！');
        }

        const idx = cacheCustom.findIndex(m => m.name === editingCustomName);
        if (idx !== -1) {
            cacheCustom[idx] = { name, icon, domain_url, ip_url, url, type };
        }

        if (name !== editingCustomName && activeSet.has(editingCustomName)) {
            activeSet.delete(editingCustomName);
            activeSet.add(name);
        } else if (!activeSet.has(name)) {
            activeSet.add(name);
        }

    } else {
        if (cacheBuiltin.find(m => m.name === name) || cacheCustom.find(m => m.name === name)) return alert('该名称已存在，请更换！');
        cacheCustom.push({ name, icon, domain_url, ip_url, url, type });
        activeSet.add(name);
    }

    await syncCustomModulesToBackend();
    triggerClashAutoSave(true); // 添加或修改后自动保存启用状态

    resetEditState();
    renderModules();
    matchCurrentStateToPreset();

    // 手机端添加成功后自动收起左侧表单
    if (window.innerWidth <= 768) {
        document.getElementById('clashLeftCol').classList.remove('expanded');
    }

    const btn = document.getElementById('btnAddCustom');
    // Reset specific inline styles set by editCustomModule back to CSS class defaults
    btn.style.backgroundColor = '';
    btn.style.borderColor = '';
    btn.style.color = '';
}

async function deleteCustomModule(name, btnElement, event) {
    event.preventDefault();
    event.stopPropagation();

    if (btnElement.classList.contains('confirm-state')) {
        clearTimeout(deleteTimeoutMap[name]);
        delete deleteTimeoutMap[name];

        cacheCustom = cacheCustom.filter(m => m.name !== name);
        activeSet.delete(name);

        if (editingCustomName === name) resetEditState();

        await syncCustomModulesToBackend();
        triggerClashAutoSave(true); // 删除后立刻静默保存当前状态
        renderModules();
        matchCurrentStateToPreset();
    } else {
        btnElement.classList.add('confirm-state');
        const originalSvg = btnElement.innerHTML;
        btnElement.innerHTML = '确定删除?';

        deleteTimeoutMap[name] = setTimeout(() => {
            if (btnElement && btnElement.parentNode) {
                btnElement.classList.remove('confirm-state');
                btnElement.innerHTML = originalSvg;
            }
        }, 3000);
    }
}

// 后端同步自定义模块定义
async function syncCustomModulesToBackend() {
    await fetch('/api/clash/custom-modules/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: cacheCustom })
    });
}

// === sub_links_modal.html ===
const subModal = document.getElementById('subLinksModal');
const subModalCard = document.getElementById('subModalCard');

let currentBaseUrl = '';
let currentToken = '';
let currentFormatKey = null;

// 预定义的链接与展示文案数据
const subFormatData = {
    clash: {
        title: "😼 Clash Meta 订阅",
        desc: "推荐使用 <b>Clash Verge Rev</b> 或 <b>OpenClash</b>。<br>手机端可直接扫描下方二维码添加。",
        getLink: () => `${currentBaseUrl}/sub/clash?token=${currentToken}`
    },
    v2ray: {
        title: "🌐 V2Ray / 通用 Base64",
        desc: "适用于 <b>v2rayN</b>、<b>v2rayNG</b>、<b>Shadowrocket</b> 等绝大多数基础代理工具。",
        getLink: () => `${currentBaseUrl}/sub/v2ray?token=${currentToken}`
    }
};

// 辅助函数：根据文字自适应 Textarea 的高度
function resizeSubLinkTextarea() {
    const ta = document.getElementById('currentSubLinkText');
    if (ta && ta.offsetParent !== null) {
        ta.style.height = 'auto'; // 先归零
        ta.style.height = (ta.scrollHeight + 2) + 'px'; // 重新设置计算高度
    }
}

// 监听窗口大小变化
function adjustRightPanelPosition() {
    const rightCol = document.getElementById('subRightCol');
    const body = document.querySelector('.sub-body');

    if (window.innerWidth <= 768) {
        if (!currentFormatKey) {
            rightCol.style.display = 'none';
            if (rightCol.parentNode !== body) body.appendChild(rightCol);
        } else {
            rightCol.style.display = 'flex';
            const wrapper = document.getElementById('wrap_' + currentFormatKey);
            if (wrapper && rightCol.parentNode !== wrapper) {
                wrapper.appendChild(rightCol);
            }
        }
    } else {
        if (currentFormatKey) rightCol.style.display = 'flex';
        if (rightCol.parentNode !== body) {
            body.appendChild(rightCol);
        }
    }
    resizeSubLinkTextarea();
}
let subLastIsMobile = window.innerWidth <= 768;
window.addEventListener('resize', () => {
    const currentIsMobile = window.innerWidth <= 768;
    if (currentIsMobile !== subLastIsMobile) {
        subLastIsMobile = currentIsMobile;
        adjustRightPanelPosition();
    }
});

// 格式卡片点击切换逻辑
function selectSubFormat(formatKey, cardElement) {
    if (currentFormatKey === formatKey) {
        if (window.innerWidth <= 768) {
            currentFormatKey = null;
            cardElement.classList.remove('active');
            subModalCard.classList.remove('has-content');
            adjustRightPanelPosition();
            return;
        }
    }

    document.querySelectorAll('.sub-format-card').forEach(c => c.classList.remove('active'));
    cardElement.classList.add('active');
    currentFormatKey = formatKey;

    renderRightPanel(formatKey);
    adjustRightPanelPosition();

    // 渲染完 DOM 后立即计算高度
    setTimeout(resizeSubLinkTextarea, 20);

    if (window.innerWidth <= 768) {
        setTimeout(() => {
            cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
    }
}

// 核心渲染逻辑：生成一键导入按钮和二维码
// 核心渲染逻辑：生成一键导入按钮和二维码
function renderRightPanel(formatKey) {
    const data = subFormatData[formatKey];
    const link = data.getLink();
    const contentDiv = document.getElementById('subRightContent');
    const subName = document.getElementById('inputSubName').value.trim() || 'NodeCTL';

    let importBtnHtml = '';
    // 默认不加 has-import 类，这样只有复制按钮时会独占一行撑满
    let gridClass = 'sub-actions-grid';

    if (formatKey === 'clash') {
        // 只有 Clash 模式下，加上 has-import 变成左右两列，并生成导入按钮
        gridClass = 'sub-actions-grid has-import';
        const clashUrl = `clash://install-config?url=${encodeURIComponent(link)}&name=${encodeURIComponent(subName)}`;
        importBtnHtml = `
                <a href="${clashUrl}" class="btn-sub-action btn-import">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    导入 Clash
                </a>
            `;
    } else if (formatKey === 'v2ray') {
        // V2Ray 下什么都不做，importBtnHtml 保持为空，界面上只会显示一个宽的复制按钮
    }

    contentDiv.innerHTML = `
            <div class="sub-right-header">
                <div class="sub-right-title">${data.title}</div>
                <div class="sub-right-desc">${data.desc}</div>
            </div>
            
            <div class="qr-wrapper">
                <div class="qr-box" id="qrCodeContainer"></div>
            </div>

            <textarea class="sub-link-textarea" id="currentSubLinkText" readonly onclick="this.select()">${link}</textarea>
            
            <div class="${gridClass}">
                <button class="btn-sub-action btn-copy" id="btnCopySubLink" onclick="copyCurrentSubLink()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    复制链接
                </button>
                ${importBtnHtml}
            </div>
        `;

    const qrContainer = document.getElementById('qrCodeContainer');
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
        text: link,
        width: 140,
        height: 140,
        colorDark: "#1d1d1f",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
    });
}

// 打开弹窗并默认直接展开第一项 (修复动画带来的高度错误)
async function openSubLinksModal() {
    // 先为卡片加上 has-content，让弹窗初始就呈现 800px 宽度
    subModalCard.classList.add('has-content');
    document.getElementById('subRightCol').style.display = 'flex';
    subModal.classList.add('active');
    document.getElementById('subSaveIndicator').style.opacity = '0';

    // 重置状态
    currentFormatKey = null;
    document.querySelectorAll('.sub-format-card').forEach(c => c.classList.remove('active'));

    try {
        const res = await fetch('/api/get-settings');
        const result = await res.json();

        if (result.status === 'success') {
            const data = result.data;
            currentToken = data.sub_token || '';
            currentBaseUrl = data.panel_url ? data.panel_url.replace(/\/+$/, '') : window.location.origin;
            document.getElementById('inputSubName').value = data.sub_custom_name || 'NodeCTL';

            // 数据加载完毕，直接选中 Clash 并渲染
            const clashCard = document.querySelector('#wrap_clash .sub-format-card');
            selectSubFormat('clash', clashCard);
        }
    } catch (e) { console.error("加载配置失败", e); }
}

// 关闭弹窗
function closeSubLinksModal() {
    subModal.classList.remove('active');
    // 延迟移除 has-content，避免关闭淡出时触发突兀的尺寸回缩
    setTimeout(() => {
        subModalCard.classList.remove('has-content');
        currentFormatKey = null;
    }, 300);
}

// 自动静默保存订阅名称 (防抖)，并自动刷新右侧的参数
let subNameSaveTimer = null;
function saveCustomSubNameDebounced() {
    if (!document.getElementById('subLinksModal').classList.contains('active')) {
        return;
    }

    clearTimeout(subNameSaveTimer);
    const indicator = document.getElementById('subSaveIndicator');
    indicator.innerHTML = '<span style="color:#888;">保存中...</span>';
    indicator.style.opacity = '1';

    subNameSaveTimer = setTimeout(async () => {
        const newName = document.getElementById('inputSubName').value.trim() || 'NodeCTL';
        try {
            const res = await fetch('/api/update-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sub_custom_name: newName })
            });
            if (res.ok) {
                indicator.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg> 名称已保存`;
                setTimeout(() => indicator.style.opacity = '0', 2000);

                if (currentFormatKey) {
                    renderRightPanel(currentFormatKey);
                    setTimeout(resizeSubLinkTextarea, 10);
                }
            }
        } catch (e) {
            indicator.innerHTML = '<span style="color:#ff3b30;">保存失败</span>';
        }
    }, 600);
}

// 一键复制链接逻辑
function copyCurrentSubLink() {
    const textarea = document.getElementById('currentSubLinkText');
    const btn = document.getElementById('btnCopySubLink');

    textarea.select();
    textarea.setSelectionRange(0, 99999);

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textarea.value).then(() => {
            showCopySuccess(btn);
        }).catch(() => fallbackCopy(btn));
    } else {
        fallbackCopy(btn);
    }
}

function fallbackCopy(btn) {
    try {
        document.execCommand('copy');
        showCopySuccess(btn);
    } catch (err) {
        alert('复制失败，请直接在上方框内长按手动复制链接');
    }
}

function showCopySuccess(btn) {
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '复制成功!';
    btn.classList.add('copied');

    setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.classList.remove('copied');
    }, 2000);
}

// === custom_rules_modal.html ===
const editSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
const trashSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

let proxyRules = [];
let currentProxyId = null;
let currentProxyItems = [];
let directItems = [];

// --- 文本与结构化数组的双向解析器 ---
function parseContentToItems(content) {
    if (!content) return [];
    const lines = content.split('\n');
    const items = [];
    let currentRemark = '';
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        if (line.startsWith('#') || line.startsWith('//')) {
            let text = line.replace(/^[#\/]+\s*/, '');
            currentRemark = currentRemark ? currentRemark + ' ' + text : text;
        } else {
            // 【修改点】此处调用 cleanDisplayRule，只让用户看到 clean 的内容
            items.push({ remark: currentRemark, rule: cleanDisplayRule(line) });
            currentRemark = '';
        }
    }
    if (currentRemark) items.push({ remark: currentRemark, rule: '' });
    return items;
}

function serializeItemsToContent(items) {
    let lines = [];
    for (let item of items) {
        if (item.remark) lines.push('# ' + item.remark);
        if (item.rule) {
            // 【修改点】此处调用 restoreFullRule，存入数据库前把前缀加回去
            lines.push(restoreFullRule(item.rule));
        }
    }
    return lines.join('\n');
}

// --- [修改] 显示层与输入清洗：移除前缀、端口，并【立即补全】CIDR掩码 ---
function cleanDisplayRule(raw) {
    if (!raw) return '';

    let val = raw.trim();

    // 1. 去除可能误复制的协议头
    val = val.replace(/^[a-zA-Z]+:\/\//, '');

    // 2. 移除规则前缀
    val = val.replace(/^(DOMAIN-SUFFIX|IP-CIDR|IP-CIDR6|DOMAIN|DOMAIN-KEYWORD),/, '');

    // 3. 移除路径但保留 CIDR
    const slashIndex = val.indexOf('/');
    if (slashIndex > -1) {
        const afterSlash = val.substring(slashIndex + 1);
        if (!/^\d+$/.test(afterSlash)) {
            val = val.substring(0, slashIndex); // 是路径，切掉
        }
    }

    // 4. 移除端口 (防止误伤 IPv6)
    if (val.includes('.') && /:\d+$/.test(val)) {
        val = val.replace(/:\d+$/, '');
    }

    // 5. 【核心修复】如果清洗后剩下的是纯 IP，立即补全显示 /32 或 /128
    // 判断 IPv4 (简单正则：四组数字)
    const isIPv4 = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(val);
    // 判断 IPv6 (简单正则：包含冒号且没有点，或者符合IPv6格式)
    const isIPv6 = /^([0-9a-fA-F:]+)$/.test(val) && val.includes(':');

    if (isIPv4) {
        val += '/32';
    } else if (isIPv6) {
        val += '/128';
    }

    return val;
}

function checkDuplicateGlobal(rule, fromTab) {
    // 1. 检查直连列表
    if (directItems.some(item => item.rule === rule)) {
        if (fromTab === 'direct') return "当前组 (全局直连)";
        return "全局直连";
    }

    // 2. 检查所有分流策略组
    for (const group of proxyRules) {
        let isMatch = false;

        // 优先检查内存中正在编辑的数据 (currentProxyItems)
        // 因为 content 字段可能还没更新
        if (currentProxyId && group.id === currentProxyId) {
            if (currentProxyItems.some(item => item.rule === rule)) {
                isMatch = true;
            }
        } else {
            // 其他组检查 content 字符串
            const lines = (group.content || '').split('\n');
            for (const line of lines) {
                if (cleanDisplayRule(line.trim()) === rule) {
                    isMatch = true;
                    break;
                }
            }
        }

        if (isMatch) {
            // 【核心修复】只有当来源是 proxy tab 且 ID 匹配时，才提示 "当前组"
            // 如果是在直连页面触发的查重，即使它被选中，也直接显示组名，不显示 "当前组"
            if (fromTab === 'proxy' && currentProxyId && group.id === currentProxyId) {
                return `当前组 (${group.name})`;
            }
            return group.name;
        }
    }

    return null;
}

// --- [重写] 数据层：保存时自动补全前缀 (替代原 autoFormatRule) ---
function restoreFullRule(raw) {
    raw = raw.trim();
    if (!raw) return '';

    // 如果已经有逗号(用户手动指定了类型)，则保持原样
    if (raw.includes(',')) return raw;

    raw = raw.replace(/^[a-zA-Z]+:\/\//, ''); // 移除 http:// 等协议头

    // 判断是否为 IP
    const isIP = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\/\d{1,2})?$/.test(raw);
    const isIPv6 = /^([0-9a-fA-F:]+)(?:\/\d{1,3})?$/.test(raw);

    if (isIP || isIPv6) {
        if (!raw.includes('/')) raw += raw.includes(':') ? '/128' : '/32'; // 补全掩码
        return 'IP-CIDR,' + raw;
    }

    // 默认为域名后缀
    raw = raw.split('/')[0].split('?')[0];
    return 'DOMAIN-SUFFIX,' + raw;
}

// --- 自动保存防抖引擎 ---
let autoSaveTimer = null;
function triggerAutoSave() {
    if (!document.getElementById('customRulesModal').classList.contains('active')) {
        return;
    }

    if (currentProxyId && currentProxyId !== 'direct') {
        const ruleObj = proxyRules.find(r => r.id === currentProxyId);
        if (ruleObj) ruleObj.content = serializeItemsToContent(currentProxyItems);
    }

    clearTimeout(autoSaveTimer);
    const indicator = document.getElementById('saveIndicator');
    indicator.innerHTML = '<span style="color:#888;">保存中...</span>';
    indicator.style.opacity = '1';

    autoSaveTimer = setTimeout(async () => {
        const payload = {
            direct: serializeItemsToContent(directItems),
            direct_icon: directIcon,
            proxy: proxyRules
        };
        try {
            const res = await fetch('/api/custom-rules/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            if (res.ok) {
                indicator.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg> 已保存`;
                setTimeout(() => indicator.style.opacity = '0', 2000);
            }
        } catch (e) {
            indicator.innerHTML = '<span style="color:#ff3b30;">保存失败</span>';
        }
    }, 600);
}

// --- 弹窗基础交互 ---
async function openCustomRulesModal() {
    document.getElementById('customRulesModal').classList.add('active');
    try {
        const res = await fetch('/api/custom-rules/get');
        const result = await res.json();
        if (result.status === 'success') {
            directItems = parseContentToItems(result.data.direct || '');
            directIcon = result.data.direct_icon || '🌐';
            proxyRules = result.data.proxy || [];
            selectProxyGroup('direct');
        }
    } catch (e) { console.error("加载失败", e); }
}

function closeCustomRulesModal() {
    document.getElementById('customRulesModal').classList.remove('active');
}



// --- [修改] 显示重复警告 (支持显示来源) ---
function showDuplicateTip(sourceName) {
    const indicator = document.getElementById('saveIndicator');

    clearTimeout(autoSaveTimer);

    // 显示具体的来源名称
    indicator.innerHTML = `<span style="color:#ff3b30; display:flex; align-items:center; gap:4px; white-space:nowrap;">⚠️ 已存在: ${sourceName}</span>`;
    indicator.style.opacity = '1';

    setTimeout(() => {
        indicator.style.opacity = '0';
    }, 2500); //稍微延长一点时间让用户看清
}



// --- 【分流 Proxy Tab】核心响应式排版逻辑 ---
function adjustEditorPosition() {
    const editor = document.getElementById('proxyEditorContainer');
    const proxyTab = document.getElementById('cr-tab-proxy');

    if (window.innerWidth <= 768) {
        // 手机端
        if (!currentProxyId) {
            editor.style.display = 'none'; // 收起编辑器
            if (editor.parentNode !== proxyTab) proxyTab.appendChild(editor);
        } else {
            editor.style.display = 'flex';
            const activeItem = document.getElementById('rule_item_' + currentProxyId);
            if (activeItem && editor.parentNode !== activeItem) {
                activeItem.appendChild(editor);
            }
        }
    } else {
        // 电脑端
        editor.style.display = 'flex';
        if (editor.parentNode !== proxyTab) {
            proxyTab.appendChild(editor);
        }
        if (!currentProxyId && editor.innerHTML === '') renderProxyEditor();
    }
}
let crLastIsMobile = window.innerWidth <= 768;
window.addEventListener('resize', () => {
    const currentIsMobile = window.innerWidth <= 768;
    if (currentIsMobile !== crLastIsMobile) {
        crLastIsMobile = currentIsMobile;
        adjustEditorPosition();
    }
});

function renderProxyGroupsList() {
    // 先将编辑器节点安全移出，防止被 innerHTML 覆盖销毁
    const editor = document.getElementById('proxyEditorContainer');
    if (editor && editor.parentNode !== document.getElementById('cr-tab-proxy')) {
        document.getElementById('cr-tab-proxy').appendChild(editor);
    }

    const proxyIcons = ['🎯', '🤖', '🍎', '📺', '🎮', '✈️', '🌍', '🏠', '💬', '🎬', '📚', '💼', '🛒', '💳', '🔒', '☁️', '⚡', '🔥', '🚀', '🐱', '🐶', '🐼', '🌐'];

    const directIconOptions = proxyIcons.map(ic => `<div class="cr-emoji-item" onclick="updateGroupIcon(event, 'direct', '${ic}')">${ic}</div>`).join('');
    const directHtml = `
            <div class="cr-rule-item ${currentProxyId === 'direct' ? 'active' : ''}" id="rule_item_direct">
                <div class="cr-rule-item-header" onclick="selectProxyGroup('direct')">
                    <div class="cr-group-name" id="name_disp_direct">
                        <div class="cr-group-icon-picker" id="picker_direct" onclick="toggleEmojiPicker(event, 'direct')">
                            <span id="icon_disp_direct" style="pointer-events:none;">${directIcon}</span>
                            <div class="cr-emoji-popover" id="emoji_popover_direct" onclick="event.stopPropagation()">
                                ${directIconOptions}
                            </div>
                        </div>
                        <span class="cr-group-name-text">全局直连</span>
                    </div>
                </div>
            </div>
        `;

    const listDiv = document.getElementById('proxyGroupList');
    listDiv.innerHTML = directHtml + proxyRules.map(rule => {
        const currentIcon = rule.icon || '🎯';
        const iconOptions = proxyIcons.map(ic => `<div class="cr-emoji-item" onclick="updateGroupIcon(event, '${rule.id}', '${ic}')">${ic}</div>`).join('');

        return `
            <div class="cr-rule-item ${rule.id === currentProxyId ? 'active' : ''}" id="rule_item_${rule.id}">
                <div class="cr-rule-item-header" onclick="selectProxyGroup('${rule.id}')">
                    <div class="cr-group-name" id="name_disp_${rule.id}">
                        <div class="cr-group-icon-picker" onclick="toggleEmojiPicker(event, '${rule.id}')">
                            <span id="icon_disp_${rule.id}" style="pointer-events:none;">${currentIcon}</span>
                            <div class="cr-emoji-popover" id="emoji_popover_${rule.id}" onclick="event.stopPropagation()">
                                ${iconOptions}
                            </div>
                        </div>
                        <span class="cr-group-name-text">${rule.name || '未命名'}</span>
                    </div>
                    
                    <input type="text" class="cr-group-input" id="name_input_${rule.id}" value="${rule.name || ''}" 
                           style="display:none;" onclick="event.stopPropagation()"
                           onblur="finishRename('${rule.id}')" onkeydown="if(event.key==='Enter') this.blur()">
                    
                    <div class="cr-item-actions" id="actions_${rule.id}">
                        <span class="cr-rule-edit" onclick="startRename(event, '${rule.id}')" title="重命名">${editSvg}</span>
                        <span class="cr-rule-delete" onclick="deleteProxyGroup(event, '${rule.id}')" id="del_btn_${rule.id}" title="删除">${trashSvg}</span>
                    </div>
                </div>
            </div>
            `;
    }).join('');

    adjustEditorPosition();
}

function toggleEmojiPicker(event, id) {
    event.stopPropagation();
    const popover = document.getElementById(`emoji_popover_${id}`);
    const picker = event.currentTarget;
    const isShowing = popover.classList.contains('show');

    // Close all other open popovers and remove active class
    document.querySelectorAll('.cr-emoji-popover').forEach(p => p.classList.remove('show'));
    document.querySelectorAll('.cr-group-icon-picker').forEach(p => p.classList.remove('active'));

    if (!isShowing) {
        popover.classList.add('show');
        picker.classList.add('active');
    }
}

// Close popovers when clicking anywhere else
document.addEventListener('click', (event) => {
    if (!event.target.closest('.cr-group-icon-picker')) {
        document.querySelectorAll('.cr-emoji-popover').forEach(p => p.classList.remove('show'));
        document.querySelectorAll('.cr-group-icon-picker').forEach(p => p.classList.remove('active'));
    }
});

function updateGroupIcon(event, id, newIcon) {
    if (event) event.stopPropagation();

    if (id === 'direct') {
        if (directIcon !== newIcon) {
            directIcon = newIcon;
            triggerAutoSave();
            const iconDisp = document.getElementById(`icon_disp_direct`);
            if (iconDisp) iconDisp.innerText = newIcon;
        }
    } else {
        const rule = proxyRules.find(r => r.id === id);
        if (rule && rule.icon !== newIcon) {
            rule.icon = newIcon;
            triggerAutoSave();
            const iconDisp = document.getElementById(`icon_disp_${id}`);
            if (iconDisp) iconDisp.innerText = newIcon;
        }
    }

    // Close popover
    const popover = document.getElementById(`emoji_popover_${id}`);
    if (popover) {
        popover.classList.remove('show');
        const picker = popover.closest('.cr-group-icon-picker');
        if (picker) picker.classList.remove('active');
    }
}

// 重命名交互
function startRename(event, id) {
    event.stopPropagation();
    document.getElementById(`name_disp_${id}`).style.display = 'none';
    document.getElementById(`actions_${id}`).style.display = 'none';
    const input = document.getElementById(`name_input_${id}`);
    input.style.display = 'block';
    input.focus();
    input.select();
}

function finishRename(id) {
    const input = document.getElementById(`name_input_${id}`);
    const newName = input.value.trim() || '未命名';
    const rule = proxyRules.find(r => r.id === id);
    if (rule && rule.name !== newName) {
        rule.name = newName;
        triggerAutoSave();
    }
    renderProxyGroupsList();
}

// 策略组双重确认删除
let pendingDeleteId = null;
let pendingDeleteTimer = null;

function deleteProxyGroup(event, id) {
    event.stopPropagation();
    const btn = document.getElementById(`del_btn_${id}`);

    if (pendingDeleteId === id) {
        clearTimeout(pendingDeleteTimer);
        pendingDeleteId = null;
        proxyRules = proxyRules.filter(r => r.id !== id);
        if (currentProxyId === id) {
            currentProxyId = null; // 删除后置空，自动收缩
        }
        renderProxyGroupsList();
        renderProxyEditor();
        triggerAutoSave();
    } else {
        pendingDeleteId = id;
        btn.innerHTML = '确认删除?';
        btn.classList.add('confirming');

        clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = setTimeout(() => {
            pendingDeleteId = null;
            renderProxyGroupsList();
        }, 2500);
    }
}

// [修复] 支持手机端点击展开/收起 Toggle 逻辑
function selectProxyGroup(id) {
    if (currentProxyId === id) {
        // 手机端重复点击，则收起 (设为 null)
        if (window.innerWidth <= 768) {
            currentProxyId = null;
            renderProxyGroupsList();
            renderProxyEditor();
            return;
        }
    }
    currentProxyId = id;
    if (id === 'direct') {
        currentProxyItems = directItems;
    } else {
        const ruleObj = proxyRules.find(r => r.id === id);
        currentProxyItems = parseContentToItems(ruleObj.content || '');
    }
    renderProxyGroupsList();
    renderProxyEditor();
}

function addProxyGroup() {
    const newId = 'rule_' + Date.now().toString(36);
    proxyRules.push({ id: newId, name: '新建策略组', content: '' });
    currentProxyId = newId;
    currentProxyItems = [];
    renderProxyGroupsList();
    renderProxyEditor();
    triggerAutoSave();

    setTimeout(() => startRename({ stopPropagation: () => { } }, newId), 50);
}

// --- 【分流 Proxy Tab】右侧编辑器内容逻辑 ---
function renderProxyEditor() {
    const container = document.getElementById('proxyEditorContainer');
    const isDirect = currentProxyId === 'direct';
    const ruleObj = proxyRules.find(r => r.id === currentProxyId);

    if (!isDirect && !ruleObj) {
        if (window.innerWidth <= 768) {
            container.style.display = 'none'; // 手机端置空时彻底隐藏
            container.innerHTML = '';
        } else {
            container.style.display = 'flex';
            container.innerHTML = `<div class="cr-empty-state">👈 请新建或选择一个策略组<br><br>可创建诸如 "AI大模型"、"看漫画" 等专属分组</div>`;
        }
        return;
    }

    container.style.display = 'flex';
    container.innerHTML = `
            ${isDirect ? '<div class="cr-desc" style="flex-shrink:0;">💡 <b>智能解析：</b>填写的域名和IP将<b>不经过代理</b>直接访问网络。</div>' : ''}
            <div class="rule-items-container no-scrollbar" id="proxyItemsContainer"></div>
            <div class="cr-add-row">
                <input type="text" id="proxyNewInput" class="cr-add-input" placeholder="输入域名或IP" onkeydown="if(event.key==='Enter') addProxyItem()">
                <button class="cr-btn-parse" onclick="addProxyItem()">解析写入</button>
            </div>
        `;
    renderProxyItems();
}

function renderProxyItems() {
    const container = document.getElementById('proxyItemsContainer');
    if (!container) return;
    container.innerHTML = currentProxyItems.map((item, index) => `
            <div class="cr-item-row">
                <input type="text" class="cr-item-remark" placeholder="备注" value="${item.remark}" oninput="currentProxyItems[${index}].remark = this.value; triggerAutoSave();">
                <input type="text" class="cr-item-rule" value="${item.rule}" oninput="currentProxyItems[${index}].rule = this.value; triggerAutoSave();">
                <div class="cr-item-del" onclick="deleteProxyItem(${index})" title="删除">${trashSvg}</div>
            </div>
        `).join('');
    container.scrollTop = container.scrollHeight;
}

function addProxyItem() {
    const input = document.getElementById('proxyNewInput');
    const raw = input.value.trim();
    if (!raw) return;

    const finalRule = cleanDisplayRule(raw);

    // 【修改点】传入 'proxy' 或 'direct' 标识
    const duplicateSource = checkDuplicateGlobal(finalRule, currentProxyId === 'direct' ? 'direct' : 'proxy');

    if (duplicateSource) {
        showDuplicateTip(duplicateSource);
        return;
    }

    currentProxyItems.push({ remark: '', rule: finalRule });

    input.value = '';
    renderProxyItems(); // 渲染并自动滚动

    triggerAutoSave();
}

function deleteProxyItem(index) {
    currentProxyItems.splice(index, 1);
    renderProxyItems();
    triggerAutoSave();
}

// === airport_sub_modal.html ===
let airState = {
    subs: [],
    nodes: [],
    currentSubId: null,
    editingSubId: null,
    deleteTimers: {},
    isMobile: window.innerWidth <= 768
};

window.addEventListener('resize', () => {
    const newIsMobile = window.innerWidth <= 768;
    if (newIsMobile !== airState.isMobile) {
        airState.isMobile = newIsMobile;
        renderAirSubs();
        if (airState.currentSubId) selectAirSub(airState.currentSubId);
    }
});

// 全局点击监听：关闭所有展开的分组菜单
document.addEventListener('click', (e) => {
    if (!e.target.closest('.air-routing-wrapper')) {
        document.querySelectorAll('.air-routing-wrapper').forEach(el => el.classList.remove('active'));
    }
});

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';

    const t = 1099511627776; // TB (1024 * 1024 * 1024 * 1024)
    const g = 1073741824;    // GB (1024 * 1024 * 1024)
    const m = 1048576;       // MB (1024 * 1024)

    if (bytes >= t) return (bytes / t).toFixed(2) + ' TB';
    if (bytes >= g) return (bytes / g).toFixed(2) + ' GB';
    if (bytes >= m) return (bytes / m).toFixed(2) + ' MB';
    return (bytes / 1024).toFixed(2) + ' KB';
}

// ================= 弹窗开关 =================
function openAirportSubModal() {
    document.getElementById('airportModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    resetForm(); loadAirSubs();
}

function closeAirModal() {
    document.getElementById('airportModal').classList.remove('active');
    document.body.style.overflow = '';
    airState.deleteTimers = {}; resetForm();
    if (typeof stopSpeedTest === 'function') stopSpeedTest(); // 彻底切断可能的后台测速连接
}

function toggleAirAddForm(show) {
    const form = document.getElementById('airAddForm');
    const trigger = document.getElementById('airAddTrigger');
    if (show) {
        form.classList.add('expanded'); trigger.style.display = 'none';
        document.getElementById('airNewName').focus();
        if (airState.isMobile) {
            setTimeout(() => {
                const sidebar = document.querySelector('.air-sidebar');
                sidebar.scrollTo({ top: sidebar.scrollHeight, behavior: 'smooth' });
            }, 300);
        }
    } else {
        form.classList.remove('expanded');
        setTimeout(() => { trigger.style.display = 'flex'; }, 300);
    }
}

function resetForm() {
    airState.editingSubId = null;
    document.getElementById('airNewName').value = ''; document.getElementById('airNewLink').value = '';
    toggleAirAddForm(false);
}

// ================= 核心逻辑 =================

async function loadAirSubs() {
    try {
        const res = await fetch('/api/airport/list');
        const data = await res.json();
        if (data.status === 'success') {
            airState.subs = data.data || [];
            renderAirSubs();
            if (!airState.isMobile && airState.subs.length > 0 && !airState.currentSubId) {
                selectAirSub(airState.subs[0].id);
            }
        }
    } catch (e) { console.error(e); }
}

function renderAirSubs() {
    const listEl = document.getElementById('airSubList');
    listEl.innerHTML = '';

    airState.subs.forEach(sub => {
        const isActive = airState.currentSubId === sub.id;
        const card = document.createElement('div');
        card.className = `air-sub-card ${isActive ? 'active' : ''}`;
        card.id = `sub-card-${sub.id}`;

        // 计算流量进度 (兼容后端未返回相关字段的情况)
        let upload = sub.upload || 0;
        let download = sub.download || 0;
        let total = sub.total || 0;
        let used = upload + download;
        let percent = total > 0 ? (used / total) * 100 : 0;
        if (percent > 100) percent = 100;

        let colorStr = 'var(--air-success)';
        if (percent > 85) colorStr = 'var(--air-danger)';
        else if (percent > 50) colorStr = 'var(--air-warning)';

        // 流量进度条样式
        let trafficHtml = '';
        let trafficInlineTxt = '';
        if (total > 0) {
            trafficHtml = `
                    <div class="air-traffic-bar-bg" style="display:block;">
                        <div class="air-traffic-bar-fill" style="width: ${percent}%; background-color: ${colorStr};"></div>
                    </div>
                `;
            trafficInlineTxt = `<span class="air-sub-traffic-inline">${formatBytes(used)} / ${formatBytes(total)}</span>`;
        }

        card.innerHTML = `
                <div class="air-sub-header-row" onclick="selectAirSub('${sub.id}')">
                    <div class="air-sub-name-wrap">
                        <div class="air-sub-name-header">
                            <span class="air-sub-name">${sub.name}</span>
                            ${trafficInlineTxt}
                        </div>
                        ${trafficHtml}
                    </div>
                    <div class="air-sub-actions">
                        <button class="air-mini-btn" title="编辑" onclick="startEdit('${sub.id}', '${sub.name}', '${sub.url}', event)" style="color: var(--air-primary);">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="air-mini-btn" title="更新" onclick="updateAirSub('${sub.id}', this, event)" style="color: var(--air-primary);">
                            <svg class="icon-refresh" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
                        </button>
                        <button class="air-mini-btn" title="删除" onclick="deleteAirSub('${sub.id}', this, event)" style="color: var(--air-danger);">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                </div>
                ${airState.isMobile ? `<div class="air-mobile-nodes-wrapper" id="mobile-nodes-${sub.id}"></div>` : ''}
            `;
        listEl.appendChild(card);
    });
}

async function selectAirSub(id) {
    if (airState.isMobile && airState.currentSubId === id) {
        airState.currentSubId = null; renderAirSubs(); return;
    }
    if (typeof stopSpeedTest === 'function') stopSpeedTest();
    airState.currentSubId = id;
    document.querySelectorAll('.air-sub-card').forEach(el => el.classList.remove('active'));
    const activeCard = document.getElementById(`sub-card-${id}`);
    if (activeCard) activeCard.classList.add('active');

    // 更新头部流量文本
    const currentSub = airState.subs.find(s => s.id === id);
    updateTrafficDisplay(currentSub);

    if (!airState.isMobile) {
        const searchInput = document.getElementById('airNodeSearch');
        if (searchInput) searchInput.value = '';
    }

    const containerId = airState.isMobile ? `mobile-nodes-${id}` : 'airDesktopNodesList';
    const container = document.getElementById(containerId);

    if (container) {
        if (!airState.isMobile) {
            container.style.opacity = '0.4'; container.style.pointerEvents = 'none'; container.style.transition = 'opacity 0.2s ease';
        } else {
            container.innerHTML = `<div class="air-empty-state" style="padding:20px;">加载中...</div>`;
        }
    }

    try {
        const res = await fetch(`/api/airport/nodes?id=${id}`);
        const json = await res.json();
        if (json.status === 'success') {
            airState.nodes = json.nodes || [];

            if (!airState.isMobile) {
                const countBadge = document.getElementById('airNodeCountBadge');
                const countNum = document.getElementById('airNodeCountNum');
                if (countBadge && countNum) { countBadge.style.display = 'flex'; countNum.innerText = airState.nodes.length; }
            }

            if (container && !airState.isMobile) { container.style.opacity = '1'; container.style.pointerEvents = 'auto'; }

            renderAirNodes(airState.nodes, containerId);

            if (airState.isMobile && activeCard) {
                setTimeout(() => { const sidebar = document.querySelector('.air-sidebar'); sidebar.scrollTo({ top: activeCard.offsetTop, behavior: 'auto' }); }, 100);
            }
        }
    } catch (e) {
        if (container) { container.style.opacity = '1'; container.style.pointerEvents = 'auto'; container.innerHTML = '<div class="air-empty-state" style="padding:20px; color:#d74242;">加载失败</div>'; }
    }
}

function updateTrafficDisplay(sub) {
    const textEl = document.getElementById('airTrafficText');
    if (!sub || !sub.total) { textEl.style.display = 'none'; return; }

    let used = (sub.upload || 0) + (sub.download || 0);
    let total = sub.total;

    // 移动端由于空间问题，若数字显示可以在 header-tools 中实现
    if (airState.isMobile) {
        // 如果要在移动端移动 DOM，可以在这里操作，当前设计已适配 flex-between
    }

    textEl.style.display = 'block';
    textEl.innerHTML = `<span style="color:#333;">${formatBytes(used)}</span> / ${formatBytes(total)}`;
}

function renderAirNodes(nodes, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    if (nodes.length === 0) {
        container.innerHTML = `<div class="air-empty-state" style="padding:40px 20px; color:#999; text-align:center; display:flex; flex-direction:column; align-items:center; gap:12px;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d1d6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <div style="font-size:14px; color:#666; font-weight:500;">暂无节点数据</div>
                <div style="font-size:12px; color:#999;">请尝试点击更新订阅或检查链接是否正确</div>
            </div>`;
        return;
    }

    const sorted = [...nodes].sort((a, b) => {
        const aActive = a.routing_type > 0 ? 1 : 0;
        const bActive = b.routing_type > 0 ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return a.original_index - b.original_index;
    });

    sorted.forEach(node => {
        const row = document.createElement('div');
        row.className = 'air-node-row';
        const protoTag = node.protocol ? `<span class="air-proto-tag">${node.protocol}</span>` : '';

        // 当前选中状态图标
        let activeIcon = node.routing_type === 1 ? '🔵 直连' : (node.routing_type === 2 ? '🟠 落地' : '⭕ 禁用');
        let iconColor = node.routing_type === 1 ? 'var(--air-primary)' : (node.routing_type === 2 ? 'var(--air-warning)' : 'var(--air-danger)');

        // --- 新增：根据当前测试状态动态渲染按钮图标 ---
        let testBtnAction = `testSingleAirNode('${node.id}')`;
        let testBtnTitle = "测速";
        let testBtnIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
        if (typeof activeTestTarget !== 'undefined' && (activeTestTarget === node.id || activeTestTarget === 'all')) {
            testBtnAction = `stopSpeedTest()`;
            testBtnTitle = "停止测速";
            // 红点停止图标
            testBtnIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><rect x="9" y="9" width="6" height="6" fill="#ef4444"></rect></svg>`;
        }

        row.innerHTML = `
                <div class="air-node-name">${protoTag}${node.name}</div>
                <div class="air-node-actions">
                    <div class="air-speed-tags" id="speed-tags-${node.id}"></div>
                    
                    <button class="air-circle-btn" id="btn-test-${node.id}" title="${testBtnTitle}" onclick="${testBtnAction}">
                        ${testBtnIcon}
                    </button>

                    <div class="air-routing-wrapper" id="dropdown-${node.id}">
                        <button class="air-circle-btn" title="修改分组" onclick="toggleRoutingMenu('${node.id}', event)" style="color: ${iconColor}; border-color: ${node.routing_type === 0 ? 'var(--air-border)' : iconColor};">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
                        </button>
                        <div class="air-routing-capsule">
                            <button class="air-capsule-item ${node.routing_type === 0 ? 'active' : ''}" data-val="0" onclick="setAirNodeRouting('${node.id}', 0, '${containerId}', event)">禁用</button>
                            <button class="air-capsule-item ${node.routing_type === 1 ? 'active' : ''}" data-val="1" onclick="setAirNodeRouting('${node.id}', 1, '${containerId}', event)">直连</button>
                            <button class="air-capsule-item ${node.routing_type === 2 ? 'active' : ''}" data-val="2" onclick="setAirNodeRouting('${node.id}', 2, '${containerId}', event)">落地</button>
                        </div>
                    </div>
                </div>
            `;
        container.appendChild(row);
    });
}

// ================= 路由操作 & UI 交互 =================

function toggleRoutingMenu(nodeId, event) {
    event.stopPropagation();
    const wrapper = document.getElementById(`dropdown-${nodeId}`);
    const isActive = wrapper.classList.contains('active');
    document.querySelectorAll('.air-routing-wrapper').forEach(el => el.classList.remove('active'));
    if (!isActive) wrapper.classList.add('active');
}

async function setAirNodeRouting(nodeId, type, containerId, event) {
    event.stopPropagation();
    document.getElementById(`dropdown-${nodeId}`).classList.remove('active');

    const node = airState.nodes.find(n => n.id === nodeId);
    if (node) node.routing_type = type;
    renderAirNodes(airState.nodes, containerId);
    showAirSaveStatus();

    await fetch('/api/airport/node/routing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: nodeId, routing_type: type })
    });
}

// ================= 测速占位逻辑 & 手动控制机制 =================

let activeEventSource = null;
let activeTestTarget = null; // 记录当前在测速的目标 ('all' 或 node.id)

function appendSpeedTag(nodeId, type, text) {
    const container = document.getElementById(`speed-tags-${nodeId}`);
    if (!container) return;
    const tag = document.createElement('span');
    tag.className = `air-tag ${type}`;
    tag.innerText = text;
    container.insertBefore(tag, container.firstChild);
}

// 重置所有测试按钮回默认的 "开始测速" 图标
function resetTestButtons() {
    const playIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
    const globalPlayIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;

    const btnAll = document.getElementById('btn-test-all');
    if (btnAll) {
        btnAll.innerHTML = globalPlayIcon;
        btnAll.onclick = testAllAirNodes;
        btnAll.title = "一键测速该订阅全部节点";
    }

    document.querySelectorAll('.air-circle-btn[id^="btn-test-"]').forEach(btn => {
        const nodeId = btn.id.replace('btn-test-', '');
        btn.innerHTML = playIcon;
        btn.onclick = () => testSingleAirNode(nodeId);
        btn.title = "测速";
    });
}

// 将指定目标的测试按钮切换为 "红点停止" 图标
function toggleTestButtonToStop(targetId) {
    const stopIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><rect x="9" y="9" width="6" height="6" fill="#ef4444"></rect></svg>`;
    const globalStopIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><rect x="9" y="9" width="6" height="6" fill="#ef4444"></rect></svg>`;

    if (targetId === 'all') {
        const btnAll = document.getElementById('btn-test-all');
        if (btnAll) {
            btnAll.innerHTML = globalStopIcon;
            btnAll.onclick = stopSpeedTest;
            btnAll.title = "停止测速";
        }
    } else {
        const btn = document.getElementById(`btn-test-${targetId}`);
        if (btn) {
            btn.innerHTML = stopIcon;
            btn.onclick = stopSpeedTest;
            btn.title = "停止测速";
        }
    }
}

// 核心主动停止函数：关闭流并释放资源，后端会自动感应并杀死核心进程
function stopSpeedTest() {
    if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
    }
    activeTestTarget = null;
    resetTestButtons();

    // 扫尾工作：将被打断的 "等待中" 标签改为灰色的 "已取消"
    document.querySelectorAll('.air-speed-tags').forEach(el => {
        if (el.innerText.includes('等待') || el.innerText.includes('测试中')) {
            el.innerHTML = '<span class="air-tag" style="background:#f1f5f9; color:#64748b;">已取消</span>';
        }
    });
}

// 流式测速处理中心 (EventSource)
function startSpeedTestStream(url, isBatch, targetId) {
    stopSpeedTest(); // 开启新测试前，强制停掉上一个可能残留的测试
    activeTestTarget = targetId;

    // ✨ 修复：在清理完上一次的残局后，再统一渲染本次测试的初始状态
    if (isBatch) {
        airState.nodes.forEach(n => {
            const el = document.getElementById(`speed-tags-${n.id}`);
            if (el) el.innerHTML = '<span class="air-tag" style="background:#f5f5f7; color:#999;">等待...</span>';
        });
    } else {
        const el = document.getElementById(`speed-tags-${targetId}`);
        if (el) el.innerHTML = '<span class="air-tag" style="background:#e0f2fe; color:#0284c7;">测试中...</span>';
    }

    toggleTestButtonToStop(targetId);
    activeEventSource = new EventSource(url);

    activeEventSource.onmessage = function (event) {
        const data = JSON.parse(event.data);

        if (data.node_id === 'all') {
            alert("引擎异常: " + data.text);
            stopSpeedTest(); // 遇错直接停止重置
            return;
        }

        const container = document.getElementById(`speed-tags-${data.node_id}`);
        if (!container) return;

        if (container.innerText.includes('等待') || container.innerText.includes('测试中')) {
            container.innerHTML = '';
        }

        appendSpeedTag(data.node_id, data.type, data.text);
    };

    activeEventSource.onerror = function () {
        // 正常的服务器流结束或网络中断
        if (activeEventSource) {
            activeEventSource.close();
            activeEventSource = null;
        }
        activeTestTarget = null;
        resetTestButtons();

        // 将未能成功返回结果的排队节点标记为无效
        document.querySelectorAll('.air-speed-tags').forEach(el => {
            if (el.innerText.includes('等待') || el.innerText.includes('测试中')) {
                el.innerHTML = '<span class="air-tag error">无效节点</span>';
            }
        });
    };
}

function testSingleAirNode(nodeId) {
    // ✨ 取消在这里提前渲染 HTML，移交到 startSpeedTestStream 中去统一排队执行
    startSpeedTestStream(`/api/airport/test-nodes?node_id=${nodeId}`, false, nodeId);
}

function testAllAirNodes() {
    if (!airState.currentSubId || airState.nodes.length === 0) return;
    startSpeedTestStream(`/api/airport/test-nodes?sub_id=${airState.currentSubId}`, true, 'all');
}

// ================= CRUD 逻辑 =================

function startEdit(id, name, url, event) {
    event.stopPropagation(); airState.editingSubId = id;
    document.getElementById('airNewName').value = name; document.getElementById('airNewLink').value = url;
    toggleAirAddForm(true);
}

async function submitSub() {
    const name = document.getElementById('airNewName').value.trim(); const url = document.getElementById('airNewLink').value.trim();
    if (!url) { showAirSaveStatus("请填写订阅链接", true); return; }
    const isEdit = !!airState.editingSubId;
    const apiPath = isEdit ? '/api/airport/edit' : '/api/airport/add';
    const payload = isEdit ? { id: airState.editingSubId, name, url } : { name, url };

    const btn = document.getElementById('airSubmitBtn'); btn.innerText = '处理中...'; btn.disabled = true;

    try {
        const res = await fetch(apiPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
            resetForm();
            await loadAirSubs();
            if (!isEdit) {
                showAirSaveStatus("添加成功");
                if (data.id) {
                    selectAirSub(data.id);
                }
            } else {
                showAirSaveStatus("修改成功");
            }
        } else { showAirSaveStatus((isEdit ? "修改失败: " : "添加失败: ") + (data.message || "未知错误"), true); }
    } catch (e) { showAirSaveStatus("网络错误", true); } finally { btn.innerText = '确认'; btn.disabled = false; }
}

async function updateAirSub(id, btn, event) {
    event.stopPropagation(); const icon = btn.querySelector('.icon-refresh');
    icon.classList.add('spin'); btn.disabled = true;
    try {
        const res = await fetch('/api/airport/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) });
        if (res.ok) { showAirSaveStatus("更新成功"); if (airState.currentSubId === id) selectAirSub(id); }
        else { showAirSaveStatus("更新失败", true); }
    } catch (e) { showAirSaveStatus("网络错误", true); } finally { icon.classList.remove('spin'); btn.disabled = false; }
}

async function deleteAirSub(id, btn, event) {
    event.stopPropagation();
    if (btn.classList.contains('confirm-state')) {
        clearTimeout(airState.deleteTimers[id]);
        try {
            const res = await fetch('/api/airport/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) });
            const json = await res.json();
            if (res.ok && json.status === 'success') {
                showAirSaveStatus("已删除");
                if (airState.currentSubId === id) { airState.currentSubId = null; document.getElementById(airState.isMobile ? `mobile-nodes-${id}` : 'airDesktopNodesList').innerHTML = ''; }
                if (airState.editingSubId === id) resetForm();
                loadAirSubs();
            } else {
                showAirSaveStatus("删除失败: " + (json.message || "未知错误"), true);
            }
        } catch (e) {
            showAirSaveStatus("网络错误", true);
        }
    } else {
        btn.classList.add('confirm-state'); const originHtml = btn.innerHTML; btn.innerHTML = '确定?';
        airState.deleteTimers[id] = setTimeout(() => { if (btn) { btn.classList.remove('confirm-state'); btn.innerHTML = originHtml; } }, 3000);
    }
}

let saveTimer;
function showAirSaveStatus(text = "已保存", isError = false) {
    const el = document.getElementById('airStatusIndicator');
    if (isError) {
        el.style.color = 'var(--air-danger)';
        el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> ${text}`;
    } else {
        el.style.color = 'var(--air-success)';
        el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg> ${text}`;
    }
    el.style.opacity = '1';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        el.style.opacity = '0';
    }, 3000);
}

function filterAirNodes(mode) {
    const input = document.getElementById(mode === 'desktop' ? 'airNodeSearch' : ''); if (!input) return;
    const key = input.value.toLowerCase();
    const filtered = airState.nodes.filter(n => n.name.toLowerCase().includes(key));
    renderAirNodes(filtered, 'airDesktopNodesList');
}