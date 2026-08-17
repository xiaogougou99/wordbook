# 易混单词总结

固定网址：<https://xiaogougou99.github.io/wordbook/>

## 文件结构

- `index.html`：页面骨架
- `data.js`：词库数据和不可变 ID 注册表
- `listening-data.js`：听力讲座词库（含稳定 ID、IPA、词性、释义和音频链接）
- `app.js`：原生词本页面渲染
- `listening.js`：听力讲座未会/已会界面和站内入口
- `audio.js`：真实词典录音优先、自然美音回退
- `sync.js`：本地优先、旧记录迁移和跨设备云同步
- `listening-sync.js`：听力状态的可逆云端同步与旧 localStorage 迁移
- `config.js`：同步配置
- `style.css`：电脑和手机响应式样式
- `.github/workflows/pages.yml`：GitHub Pages 自动部署

## 追加词条约定

词条 `id` 一旦发布就不能修改或复用。新增词条时，将数据加入 `WORD_GROUPS`，并把新 ID 追加到 `WORD_ID_REGISTRY` 末尾。不要重排或删除注册表中的旧 ID；这是保证历史删除状态不会错位或复活的关键。

## 同步模型

页面采用本地优先删除：点击后立刻写入本地并隐藏，随后在后台与云端做集合并集。云端只传播“已删除”墓碑，不提供恢复操作。旧版本 `localStorage` 和旧 KeyVal 位图会在首次加载时自动并入新状态。

“听力讲座”复用同一个 KeyVal 云端服务，每个稳定词条 ID 使用独立状态键保存 `known` 或 `unknown`。同一词并发修改时，云端最后一次成功写入为准；浏览器缓存只用于首屏和离线待提交，不会把旧缓存当作服务器状态。
