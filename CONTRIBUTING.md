# 贡献说明

推荐通过 **Issue** 的形式添加新项目，而不是直接提交 PR 修改 `RAW_DATA`。

## 项目架构

### 目录结构

```
awesome-bilibili-extra-rev/
├── RAW_DATA/                    # 项目数据源（YAML 文件，按类别组织）
│   ├── 浏览器扩展/              #   浏览器扩展分类
│   ├── 篡改猴脚本/              #   油猴脚本分类
│   ├── 下载工具.yml
│   ├── 开发.yml
│   └── ...
├── svg/                         # 技术栈图标（用于 README 中的徽章）
├── src/
│   ├── data/
│   │   └── yaml-manager.js      # YAML 数据读写统一管理
│   ├── validators/
│   │   └── item-validator.js    # 链接规范化化和描述处理
│   ├── checkers/
│   │   └── link-checker.js      # 链接状态检查（curl）+ GitHub/GreasyFork API 状态获取
│   ├── utils/
│   │   ├── file-utils.js        # 文件读写工具
│   │   └── badge-utils.js       # 技术标签→徽章图标映射
│   ├── generators/
│   │   ├── sync.js              # 核心维护命令：读 YAML → 检查链接 → 更新 YAML → 生成 README
│   │   ├── check-yaml.js        # YAML 语法检查
│   │   └── apply-cleanup.js     # 从 YAML 中删除指定项目
│   ├── tools/
│   │   └── auto-classify.mjs    # Issue 自动分类：提取链接 → 获取 API 元数据 → LLM 分类 → 写入 YAML
│   └── scripts/
│       └── settings-filter.user.js  # 用户脚本（设置页面交互）
├── .github/workflows/
│   ├── ci-sync.yml              # CI：定期同步更新 README 和 YAML
│   ├── auto-classify.yml        # CI：每 6 小时扫描新 Issue，自动分类并创建 PR
│   └── ...
├── README_RAW.md                # README 模板
└── README.md                    # 最终生成的文档
```

### 核心流程

#### 1. 数据管理
*   所有项目数据存储在 `RAW_DATA/` 目录下的 YAML 文件中，按工具类型（浏览器扩展、油猴脚本、下载工具等）分类。
*   `yaml-manager.js` 负责统一读写 YAML 文件，`item-validator.js` 负责链接的规范化处理（将简写链接转为完整 URL）。

#### 2. 自动分类（Issue → PR）
*   用户提交 Issue 推荐项目（带 GitHub/GreasyFork 链接）。
*   `auto-classify.yml` CI 每 6 小时扫描一次未处理的 `new-tool` 标签 Issue。
*   `auto-classify.mjs` 执行以下操作：
    1.  从 Issue 内容中提取链接。
    2.  调用 GitHub/GreasyFork API 获取项目元数据（名称、描述、语言等）。
    3.  调用 LLM API 进行智能分类，确定项目类别和分类标签。
    4.  根据 API 描述和 LLM 描述的质量，选择更合适的描述写入 YAML。
    5.  创建 PR 供审核。

#### 3. 定期同步（Sync）
*   `ci-sync.yml` CI 定期运行 `sync.js`。
*   `sync.js` 执行以下操作：
    1.  读取所有 YAML 文件中的项目。
    2.  使用 `curl` 检查链接有效性，并调用 GitHub/GreasyFork API 获取项目状态（是否归档、最后更新时间）。
    3.  检测改名（链接变更）和死链（404 等），自动更新 YAML 或删除死链。
    4.  读取 `README_RAW.md` 模板，将 YAML 数据渲染为 Markdown 表格，生成最终 `README.md`。
    5.  如有变更，自动创建分支和 PR。

### 关键 API

| 用途 | 说明 |
|:--- |:--- |
| GitHub Repo API | 获取仓库名称、描述、语言、主题、归档状态、最后推送时间 |
| GreasyFork API | 获取脚本名称、描述、更新时间、删除状态 |
| LLM API | 智能分类、生成简洁的中文项目描述 |

---

## 如何推荐项目？

1. **提交 Issue**：使用仓库提供的模板（`New-Item.yml` 或 `Bulk-Recommend.yml`），或者新建 Issue 并打上 `new-tool` 标签。
2. **自动处理**：CI 会自动抓取项目信息、分类并更新到 YAML 文件中，然后创建 PR 供审核。

## 注意事项

*   **避免重复**：提交前请搜索现有项目和 Issues，确保项目未被收录。
*   **项目质量**：确保项目有基本的说明文档或 README。
*   **项目状态**：
    *   如果项目 **超过三年未更新**，名称将以 *斜体* 显示。
    *   如果项目 **已被存档**，名称将以 ~~删除线~~ 显示。

感谢您的贡献！
