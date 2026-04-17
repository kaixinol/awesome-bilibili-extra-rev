# 项目替代检测 - 快速参考

## 📋 文件清单

### 核心文件
- ✅ `src/tools/check-replacement.mjs` - LLM检测逻辑
- ✅ `src/generators/apply-replacement.js` - 应用替换操作
- ✅ `.github/workflows/check-replacement.yml` - 检查工作流（手动触发）
- ✅ `.github/workflows/apply-replacement.yml` - 应用工作流（评论触发）
- ✅ `src/tools/check-replacement.test.js` - 单元测试
- ✅ `docs/replacement-checker.md` - 完整文档

## 🚀 使用步骤

### 1️⃣ 检测替代项目
```
GitHub Actions → Check Project Replacements → Run workflow
设置: DRY_RUN = false（正式运行）或 true（测试）
```

### 2️⃣ 审查 Issue
```
查看自动创建的 Issue（标签: replacement）
格式：
- [ ] [原项目](链接) → [新项目](链接)
  - 理由：xxx
```

### 3️⃣ 确认替换
```
保留项目：保持 [ ] （勾选）
替换项目：改为 [x] （取消勾选）
评论：@github-actions[bot] apply replacement
```

### 4️⃣ 自动创建 PR
```
机器人自动：
✓ 解析未勾选项
✓ 更新 YAML 文件
✓ 创建 Pull Request
```

## 🔧 环境变量

必需配置（GitHub Secrets）：
- `LLM_API_URL` - LLM API地址
- `LLM_API_KEY` - API密钥（可选）
- `LLM_MODEL` - 模型名称（默认：gpt-4o-mini）

## 📊 工作流程

```
手动触发 → LLM扫描 → 创建Issue → 人工确认 → 自动PR → 合并完成
```

## ⚠️ 注意事项

1. **只检查 GitHub 项目**（from === 'github'）
2. **DRY_RUN 模式**不会创建任何 Issue，适合首次测试
3. **人工审查是必须的**，LLM 可能误判
4. **每次检查间隔 1 秒**，避免 API 限流
5. **默认保留所有项目**，只有明确取消勾选才会替换

## 🎯 判断标准

LLM 会检测 README 中是否包含：
- ✓ "已停止维护，请使用..."
- ✓ "本项目已迁移到..."
- ✓ "推荐使用新项目..."
- ✓ 明确的 GitHub 链接指向新项目

## 📝 示例输出

```markdown
## Replacement Review

请**取消勾选**要替换的项目。默认全部保留。

### 发现替代项目

- [ ] [bilibili-api](https://github.com/old/api) → [https://github.com/new/api-v2](https://github.com/new/api-v2)
  - 理由：README明确说明"本项目已停止维护，请迁移到 bilibili-api-v2"

完成后评论：`@github-actions[bot] apply replacement`
```

## 🔍 测试

```bash
# 运行单元测试
pnpm test src/tools/check-replacement.test.js

# 运行所有测试
pnpm test

# 验证 YAML 语法
pnpm run check:yaml
```

## 📚 相关文档

- [完整使用指南](./replacement-checker.md)
- [Cleanup 机制参考](../.github/workflows/cleanup-issues.yml)
- [Apply 机制参考](../.github/workflows/apply-cleanup.yml)
