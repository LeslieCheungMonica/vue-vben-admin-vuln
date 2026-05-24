# COSMIC API 接口文档

**基础路径：** `/cosmic`

---

## 1. 上传资源文件

上传 COSMIC 评估 Excel 文件（.xlsx / .xls），文件名自动追加时间戳。

```
POST /cosmic/resource_upload
```

**请求：** `multipart/form-data`

| 参数 | 类型 | 必填 | 说明 |
|:-----|:-----|:-----|:-----|
| `file` | File | 是 | Excel 文件，仅支持 .xlsx / .xls |
| `description` | str | 否 | 资源描述 |

**响应：**
```json
{
  "status": "completed",
  "file_path": "/Users/.../cosmics/cosmic-sdc_20260524140414.xlsx",
  "file_name": "cosmic-sdc_20260524140414.xlsx",
  "message": "Excel文件上传完成: /Users/.../cosmics/cosmic-sdc_20260524140414.xlsx"
}
```

> 数据库同时保存 `file_name`（带时间戳的实际文件名）和 `real_file_name`（原始上传文件名）。

---

## 2. 资源列表

查询所有已上传的 COSMIC 资源。

```
POST /cosmic/resource_list
```

**请求：** 无参数

**响应：**
```json
{
  "status": "completed",
  "items": [
    {
      "id": 1,
      "file_name": "cosmic-sdc_20260524140414.xlsx",
      "real_file_name": "cosmic-sdc.xlsx",
      "file_path": "/Users/.../cosmics/cosmic-sdc_20260524140414.xlsx",
      "file_size": 2298686,
      "description": "",
      "created_at": "2026-05-24 14:04:14"
    }
  ]
}
```

---

## 3. 删除资源

按 ID 删除 COSMIC 资源（同时删除磁盘文件）。

```
POST /cosmic/resource_delete
```

**请求：**
```json
{
  "id": 1
}
```

**响应：**
```json
{
  "status": "completed",
  "message": "资源已删除: id=1"
}
```

---

## 4. 创建任务

创建 COSMIC 功能存在性判定任务。

```
POST /cosmic/task_create
```

**请求：**

| 参数 | 类型 | 必填 | 说明 |
|:-----|:-----|:-----|:-----|
| `code_resource_id` | int | 是 | 待分析的代码资源 ID（关联 wape_resource 表） |
| `cosmic_resource_id` | int | 是 | COSMIC Excel 资源 ID（关联 cosmic_resource 表） |
| `task_name` | str | 是 | 任务名称 |

```json
{
  "code_resource_id": 1,
  "cosmic_resource_id": 2,
  "task_name": "SDC COSMIC 评估"
}
```

**响应：**
```json
{
  "status": "completed",
  "task_id": "cosmic-20260524120000",
  "task_name": "SDC COSMIC 评估",
  "message": "任务创建成功"
}
```

---

## 5. 任务列表

查询所有 COSMIC 判定任务。

```
POST /cosmic/task_list
```

**请求：** 无参数

**响应：**
```json
{
  "status": "completed",
  "items": [
    {
      "id": 1,
      "task_id": "cosmic-20260524120000",
      "task_name": "SDC COSMIC 评估",
      "code_resource_id": 1,
      "cosmic_resource_id": 2,
      "status": "finish",
      "created_at": "2026-05-24 14:00:00"
    }
  ]
}
```

---

## 6. 编辑任务

编辑 COSMIC 判定任务信息（局部更新，仅传入需要修改的字段）。

```
POST /cosmic/task_edit
```

**请求：**

| 参数 | 类型 | 必填 | 说明 |
|:-----|:-----|:-----|:-----|
| `task_id` | str | 是 | 任务 ID |
| `task_name` | str | 否 | 新任务名称 |
| `code_resource_id` | int | 否 | 新代码资源 ID |
| `cosmic_resource_id` | int | 否 | 新 COSMIC 资源 ID |

```json
{
  "task_id": "cosmic-20260524120000",
  "task_name": "更新后的任务名称"
}
```

**响应：**
```json
{
  "status": "completed",
  "message": "任务已更新"
}
```

---

## 7. 删除任务

删除 COSMIC 判定任务记录。

```
POST /cosmic/task_delete
```

**请求：**

| 参数 | 类型 | 必填 | 说明 |
|:-----|:-----|:-----|:-----|
| `task_id` | str | 是 | 任务 ID |

```json
{
  "task_id": "cosmic-20260524120000"
}
```

**响应：**
```json
{
  "status": "completed",
  "message": "任务已删除: cosmic-20260524120000"
}
```

---

## 8. 停止任务

停止正在运行的 COSMIC 判定任务（关闭 OpenCode 子进程 + 状态置为 stopped）。

```
POST /cosmic/task_stop
```

**请求：**

| 参数 | 类型 | 必填 | 说明 |
|:-----|:-----|:-----|:-----|
| `task_id` | str | 是 | 任务 ID |

```json
{
  "task_id": "cosmic-20260524120000"
}
```

**响应：**
```json
{
  "status": "completed",
  "message": "任务已停止: cosmic-20260524120000"
}
```

---

## 9. 启动任务

启动 COSMIC 功能存在性判定任务（异步后台执行）。

```
POST /cosmic/task_start
```

**请求：**

| 参数 | 类型 | 必填 | 说明 |
|:-----|:-----|:-----|:-----|
| `task_id` | str | 是 | 任务 ID |

```json
{
  "task_id": "cosmic-20260524120000"
}
```

**响应：**
```json
{
  "status": "processing",
  "message": "任务已提交: cosmic-20260524120000"
}
```

---

## 10. 报告导出（带颜色标记）

根据任务执行结果，生成带颜色标记的 Excel 文件。

```
POST /cosmic/report_excel
```

**请求：**

| 参数 | 类型 | 必填 | 说明 |
|:-----|:-----|:-----|:-----|
| `task_id` | str | 是 | 任务 ID |

```json
{
  "task_id": "cosmic-20260524120000"
}
```

**响应：** 下载 `cosmic_report_{task_id}.xlsx` 文件

**颜色规则：**
- 读取 `cosmic-work/{task_id}/deliverables/` 下所有 `.json` 结果文件
- 根据 `biz_input`（`一级-二级-三级-功能过程`）匹配 Excel 行
- `exists: true` → **绿色**（C6EFCE）
- `exists: false` → **红色**（FFC7CE）
- 未匹配到的行不做颜色标记

---

## 11. 健康检查

```
GET /cosmic/health
```

**响应：**
```json
{
  "status": "ok"
}
```

---

## 数据表结构

### cosmic_resource（资源表）

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| id | INTEGER PK | 自增主键 |
| file_name | TEXT | 实际文件名（带时间戳） |
| real_file_name | TEXT | 原始上传文件名 |
| file_path | TEXT | 文件存储路径 |
| file_size | INTEGER | 文件大小（字节） |
| description | TEXT | 描述 |
| created_at | TIMESTAMP | 创建时间 |

### cosmic_task（任务表）

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| id | INTEGER PK | 自增主键 |
| task_id | TEXT UNIQUE | 任务唯一标识（格式：cosmic-YYYYMMDDHHMMSS） |
| task_name | TEXT | 任务名称 |
| code_resource_id | INTEGER | 代码资源 ID（关联 wape_resource） |
| cosmic_resource_id | INTEGER | COSMIC 资源 ID（关联 cosmic_resource） |
| status | TEXT | 状态：pending / running / finish / stopped / run-except |
| created_at | TIMESTAMP | 创建时间 |

### cosmic_checker（检查结果表）

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| id | INTEGER PK | 自增主键 |
| task_id | TEXT | 任务 ID |
| biz_name | TEXT | 功能过程路径 |
| status | TEXT | 状态 |
| res | TEXT | 检查结果 |

---

## Excel 文档格式说明

目标 Sheet：**功能点拆分表**（按优先级匹配：功能点拆分表 > 功能拆分表 > COSMIC > Sheet1 > 当前活动 Sheet）

| 列 | 字段 | 说明 |
|:---|:-----|:-----|
| C | 一级模块 | 前向填充（空行自动继承上一行） |
| D | 二级模块 | 前向填充 |
| E | 三级模块 | 前向填充 |
| I | 功能过程 | 功能点名称 |

过滤规则：仅保留 **功能过程非空** 的行，跳过子过程描述等辅助行。

解析后组装为 `biz_input` 格式：`{一级模块}-{二级模块}-{三级模块}-{功能过程}`

**示例：**
```json
{
  "one": "安全数据预处理",
  "two": "数据解析",
  "three": "解析规则",
  "moudle": "设备厂商目录查询",
  "biz_input": "安全数据预处理-数据解析-解析规则-设备厂商目录查询"
}
```

---

## 后台执行流程

```
task_start
  └─ 后台线程: _run_task_background
       ├─ 1. 更新任务状态 → running
       ├─ 2. 启动 OpenCode 子进程（代码资源路径）
       ├─ 3. 创建 AI 会话
       ├─ 4. 读取 COSMIC Excel → 解析 N 条功能过程（功能过程非空行）
       ├─ 5. 逐条调用 CosmicChecker.run() 进行存在性判定
       │    └─ 输入: biz_input = "安全数据预处理-数据解析-解析规则-设备厂商目录查询"
       │    └─ 输出: {"exists": true/false, ...} 结构化 JSON
       ├─ 6. JSON 结果文件保存至 cosmic-work/{task_id}/deliverables/
       ├─ 7. 关闭 OpenCode 子进程
       └─ 8. 更新任务状态 → finish / run-except
```

## 测试脚本

```bash
# 调试 Excel 解析
python api/test_cosmic_excel.py                              # 默认文件
python api/test_cosmic_excel.py /path/to/file.xlsx           # 指定文件
python api/test_cosmic_excel.py /path/to/file.xlsx 10        # 预览前 10 行
```
