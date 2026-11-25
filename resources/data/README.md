# resources/data

运行期数据表目录。**这里的文件不手写**，由 `tools/` 的离线工具链生成或校验，避免「文档/表/代码」三份漂移。

| 文件 | 生成者 | 用途 |
|---|---|---|
| `generated/ghost_blocks.json` | `python -m lit_tools mapping` | 从 BP 枚举出的假方块清单（identifier + 状态定义），C++ 侧映射层的输入 |

约定：

- `generated/` 下的内容属于构建产物，已加入 `.gitignore`；需要固定版本时由发布流程打包进 zip。
- 旧仓库（`3.1.1`）的 `ghost_index.json` / `attached_rules.json` 只作映射口径的参考，不直接拷贝：新实现以 BP 的方块定义 + 映射规则重新生成，并由差分用例锁住行为。
- 任何手工维护的表都必须有对应的校验命令写进 `tools/README.md`，否则 CI 无法拦截漂移。
