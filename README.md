# 自媒体 Bot · Self Media Bot

[![checks](https://github.com/MkaliezZ/self-media-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/MkaliezZ/self-media-bot/actions/workflows/ci.yml)

一个基于 **DeepSeek Harness（DSH）官方运行时**的本机自媒体专用 Bot。将已经具备 CLI/API 的 [自媒体工作台](https://github.com/MkaliezZ/self-media-workbench) 接入独立创作界面，不重写其业务引擎，也不做通用编程助手、云电脑或多 Bot 平台。

**一个 Bot，七种任务：**账号诊断与对标、选题策划、口播脚本、拍摄布光、剪辑与包装、发布准备、数据复盘。

## 界面

下面是实际应用截图。项目和片源来自隔离的技术验收数据，不是真实账号成绩；视频截图使用程序合成片源。

![首页](docs/images/home.png)

| 脚本、修改与版本 | 实际文件的视频预览 |
|---|---|
| ![脚本工作区](docs/images/script-workspace.png) | ![视频工作区：合成技术验收片源](docs/images/video-workspace.png) |

## 它能做什么

- 用自然语言派活，上传文本、图片、音视频，在同一项目里继续修改。
- 查看实际保存的文稿、诊断、选题、复盘和发布准备材料；没有成果时如实显示空状态。
- 口播稿可轻量编辑并另存新版本，保留原稿、引用、修改记录和时长估算。
- 布光方案展示简版/标准/理想三档、真实 SVG 布局、选择记录和试拍反馈入口。
- 实际转写、字幕校对、剪辑、现有视觉包装和原生时间轴导出；使用已有工作台能力，不是新造专业视频编辑器。
- 在浏览器预览真实成片、原片、字幕并下载交付文件。编码不受浏览器支持时可以下载检查。
- 项目、对话、素材、成果版本、本机凭据独立保存；原工作台的源码和旧项目库不改动。
- 后台状态、失败、用户问题、Bot中断、过期依赖和待人工审阅分别显示。

## 不做什么

不自动登录/抓取社交账号，不自动对外发布，不自动网上搜图，不生成图片/配音/音乐，不自动抠像/跟踪，不开放通用终端、插件商店或其他 Bot。

“发布准备”不等于已发布；“导出完成”不等于人耳听审、事实核查、版权清理或运营效果验证。缺失数据保持未知，不用模拟数字充当真实成绩。

## 环境要求

- **Node.js 24.9+**（建议24 LTS）和 npm。
- **Python 3.11+**。已有工作台时复用其解释器与依赖。
- 首次自动安装工作台需要 Git 和联网下载依赖。
- 剪辑、抽帧与音视频导出需要 `ffmpeg` / `ffprobe`；原生时间轴/视觉包装需要支持 `-/filter_complex` 的版本，建议 **FFmpeg 8.1+**，本机使用8.1.1。部分Linux发行版自带版本过旧。
- 转写另需兼容的本地 ASR 依赖和模型，首次使用请按下方[部署本地 ASR 大模型](#部署本地-asr-大模型)操作；本产品不自动下载权重，不修改全局 PATH。
- 模型使用 **DeepSeek Messages API / 兼容网关**。默认模型为 `deepseek-flash`；不是把 OpenAI Chat Completions 地址直接填进来。

文字与布光任务不要求先安装 ASR 模型。图像审阅需要模型本身具有图片输入能力。

## 快速开始

```sh
npm ci --ignore-scripts
npm run setup
npm run build
npm start
```

打开 **http://127.0.0.1:3210**，在“设置”中填写模型地址、模型名和 API Key。也可通过 `DEEPSEEK_API_KEY` 环境变量提供密钥。不要把真实密钥写进代码或提交到 Git。

Windows 可双击 **`start.cmd`**；它会检查依赖，在需要时执行基础安装/构建，然后打开本机页面。macOS/Linux 可运行 `bash start.sh`。安装过程会明确显示网络下载步骤。

`npm run setup` 优先发现已有 `media-workbench` 安装记录，不改动其源码或解释器。没有安装记录时，它把 `workbench.manifest.json` 指定的公开版本安装到本 Bot 的私有目录，并创建隔离 Python 环境。可显式指定：

```text
SELF_MEDIA_WORKBENCH_ROOT=/absolute/path/to/self-media-workbench
SELF_MEDIA_WORKBENCH_PYTHON=/absolute/path/to/its/python
```

基础安装不下载 ASR 模型。`node scripts/setup.mjs --with-asr` 可在**首次创建工作台环境时**顺带安装转写依赖，但不会下载模型；复用已有安装时不自动修改其依赖。已完成基础安装的用户，请按下一节使用实际工作台解释器安装依赖、下载权重并配置启动环境。

## 部署本地 ASR 大模型

ASR 负责把音视频中的语音转成文字和时间戳，**不是**设置页中的 DeepSeek 对话模型。配置聊天 API Key 并不会安装 ASR。只有转写、口播字幕及依赖语音识别的剪辑需要本节；选题、写稿、布光和无旁白时间轴任务可先使用。

### 1. 选择模型和运行后端

中文、多语言口播可优先从 **Whisper large-v3 的 CTranslate2 版本**开始：[`Systran/faster-whisper-large-v3`](https://huggingface.co/Systran/faster-whisper-large-v3)。它通过 `faster-whisper` 在本机推理，权重下载完成后无需为转写调用外部 ASR API。

| 你的环境 | 推荐路径 | 注意 |
|---|---|---|
| Windows / Linux，先求部署成功 | faster-whisper + CTranslate2，CPU `int8` | 最容易检查基础链路；大模型可能较慢，不代表使用了 GPU |
| Windows / Linux，NVIDIA 显卡 | faster-whisper + CTranslate2 CUDA | 需要匹配的驱动、CUDA/cuBLAS/cuDNN；不能仅凭显卡被识别就认定可用 |
| Apple Silicon Mac | 工作台的 MLX / Metal 后端 | 使用 **MLX 格式**的本地模型和 MLX 依赖，不能直接使用本节的 CT2 权重 |
| Windows AMD / Intel GPU | 工作台的 whisper.cpp / Vulkan 路径 | 需要兼容驱动、CLI 和 **GGML 格式**权重，不是 CUDA 路径；以实际设备验收为准 |

模型文件为数 GB，请预留充足磁盘空间，下载缓存也会占空间。内存/显存不足或只想先验证功能时，可改用 `Systran/faster-whisper-medium` 或 `Systran/faster-whisper-small`；换模型会影响识别效果，不能视作仅改变速度。不要直接套用固定的显存或速度保证。

**以下完整命令使用 CPU 跑通 `large-v3`。** GPU 用户可先确认这条基础链路，再按第4步切换硬件后端。

### 2. 停止旧实例，安装依赖并显式下载权重

在项目根目录操作，先完成上方的 `npm run setup` 和 `npm run build`。

- 如果 Bot 正在运行，先等待已有转写/渲染结束，再在其终端按 `Ctrl+C` 停止 Bot。
- **仅停止 Bot 不一定停止独立工作台进程。** 如果之前已启动过工作台，可在确认空闲后运行下面的受限清理命令。它核对本 Bot 的服务记录、PID、启动命令和后台作业，只请求停止能确认归属且空闲的实例；返回 `false` 时可能未运行、仍忙或无法确认，请检查状态，不要批量结束所有 Python 进程。

```sh
node --input-type=module -e "import {Config} from './dist/server/config.js'; import {Workbench} from './dist/server/workbench.js'; const c=new Config(); await c.init(); console.log(await new Workbench(c,process.cwd()).stopIfIdle());"
```

确认旧实例已退出后再继续。下面从本机安装记录读取**真正使用的 Python 和工作台目录**，不要将包安装到另一个 Python。复用现有解释器时，`pip install` 会修改该解释器环境；依赖已经齐全可跳过安装，必要时先备份依赖清单。

**Windows PowerShell：**

```powershell
# 在 self-media-bot 项目根目录运行；自定义数据目录也会被识别。
$botHome = if ($env:SELF_MEDIA_BOT_HOME) { [IO.Path]::GetFullPath($env:SELF_MEDIA_BOT_HOME) } else { Join-Path $PWD '.local' }
$config = Get-Content -Raw -Encoding UTF8 (Join-Path $botHome 'settings.json') | ConvertFrom-Json
$python = $config.python
$workbench = $config.workbenchRoot
$modelDir = Join-Path $botHome 'models/faster-whisper-large-v3'

& $python -m pip install -r (Join-Path $workbench 'requirements-asr.txt') 'huggingface_hub>=0.23'
& $python -c "import sys; from huggingface_hub import snapshot_download; snapshot_download(repo_id=sys.argv[1], local_dir=sys.argv[2])" 'Systran/faster-whisper-large-v3' $modelDir

# 必须指向下载后的本地目录，不是模型名称或 Hugging Face 链接。
$env:SELF_MEDIA_MODEL = $modelDir
$env:SELF_MEDIA_ASR_BACKEND = 'faster-whisper'
$env:SELF_MEDIA_DEVICE = 'cpu'
$env:SELF_MEDIA_LANGUAGE = 'zh'
$env:SELF_MEDIA_REQUIRE_GPU = '0'
npm run doctor
npm start
```

**Linux / macOS 终端（此例是 CT2 CPU 路径，非 MLX GPU）：**

```bash
BOT_HOME="$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).expanduser().resolve())' "${SELF_MEDIA_BOT_HOME:-.local}")"
PYTHON="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["python"])' "$BOT_HOME/settings.json")"
WORKBENCH="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["workbenchRoot"])' "$BOT_HOME/settings.json")"
MODEL_DIR="$BOT_HOME/models/faster-whisper-large-v3"

"$PYTHON" -m pip install -r "$WORKBENCH/requirements-asr.txt" 'huggingface_hub>=0.23'
"$PYTHON" -c 'import sys; from huggingface_hub import snapshot_download; snapshot_download(repo_id=sys.argv[1], local_dir=sys.argv[2])' 'Systran/faster-whisper-large-v3' "$MODEL_DIR"

export SELF_MEDIA_MODEL="$MODEL_DIR"
export SELF_MEDIA_ASR_BACKEND=faster-whisper
export SELF_MEDIA_DEVICE=cpu
export SELF_MEDIA_LANGUAGE=zh
export SELF_MEDIA_REQUIRE_GPU=0
npm run doctor
npm start
```

这里的模型下载是用户明确执行的安装步骤，会产生网络流量和磁盘占用；公开模型不需要 DeepSeek / OpenAI API Key。正常转写使用本地目录与 `local_files_only`，不会偷偷补下载模型。

### 3. 核对文件与配置生效范围

CT2 模型目录应包含真正的 `model.bin`，以及仓库提供的 `config.json`、`tokenizer.json`、`preprocessor_config.json` 等配套文件。推荐完整下载该模型仓库，不要只复制一个 Git LFS 指针文件，也不要把原始 PyTorch `.pt`、MLX 或 GGML 权重当作 CT2 模型。

- `SELF_MEDIA_MODEL` 必须是**本地绝对目录**，其中直接包含 `model.bin`。
- 上面设置的环境变量只对当前终端及其启动的 Bot 生效。请在**同一窗口**执行 `npm start`；另行双击 `start.cmd` 不会自动继承该 PowerShell/终端的临时配置。
- 需要长期使用时，把相同变量写入自己的启动脚本（可放在被忽略的 `.local/` 中），或自行配置用户级环境变量。当前程序不自动读取 `.env` 文件，不能只复制 `.env.example` 就认为已生效。
- 修改模型、后端、设备或安装运行库后，旧工作台进程需要在任务终态后安全重启。新 `doctor` 结果不代表旧服务已加载新配置。
- 模型权重与本机路径不要提交 Git；本例将权重保存在已被忽略的 `.local/models/` 下。

### 4. NVIDIA GPU / 其他平台

NVIDIA 用户先按 [faster-whisper GPU 要求](https://github.com/SYSTRAN/faster-whisper#gpu)及 [CTranslate2 硬件支持](https://opennmt.net/CTranslate2/hardware_support.html)安装匹配的运行库。当前上游说明使用 CUDA 12 的 cuBLAS 和 cuDNN 9；具体应以实际安装的 CTranslate2 版本兼容性为准。不要为了套命令盲目降级或覆盖已有环境，也不要把驱动安装成功当作推理已成功。

基础模型和 CUDA 环境准备好、旧实例已停止后，在启动终端将 CPU 示例中的设备改为：

```powershell
# PowerShell：严格要求使用GPU，不允许静默回退CPU。
$env:SELF_MEDIA_DEVICE = 'cuda'
$env:SELF_MEDIA_REQUIRE_GPU = '1'
npm start
```

Linux 对应使用 `export SELF_MEDIA_DEVICE=cuda`、`export SELF_MEDIA_REQUIRE_GPU=1`。不确定环境时可使用 `device=auto`、`require_gpu=0` 允许明确记录的 CPU 回退，但不能把该结果称为 GPU 成功。不要修改系统全局 PATH 来掩盖运行库缺失。

Apple Silicon、Windows AMD/Intel、Intel Mac 的完整部署方法见[工作台 GPU / ASR 指南](https://github.com/MkaliezZ/self-media-workbench/blob/59589fc365e084de9b9bd0759714c07eaabd9b7b/docs/accelerators.md)。MLX 使用 `SELF_MEDIA_MLX_MODEL`，whisper.cpp 使用 `SELF_MEDIA_CPP_EXECUTABLE` / `SELF_MEDIA_CPP_MODEL` 等配置；**CT2、MLX、GGML 三种权重不能互换**，本节的 CT2 下载命令不能当作这些 GPU 路径已完成部署。

### 5. 做一次真正的转写验收

1. 运行 `npm run doctor` 或打开“设置 → 检测已保存的运行环境”，确认依赖、FFmpeg/ffprobe、模型及尝试策略。检测到文件或显卡，只代表具备候选条件。
2. 用自己有权处理的短音视频（例如20–60秒）创建“剪辑与包装”任务，要求“先转写、校对字幕，暂不删除语音或导出成片”。
3. 等实际 ASR 作业进入 `done`，检查转写文字、句子分组、时间戳和保留的原件；不要把“任务已提交”当作成功。
4. 核对终态 `backend`、`device`、`execution` 与 `fallback_errors`。若结果是 `cpu`，就是 CPU；GPU 模式应有实际完成的 GPU 推理记录。CPU VAD 或 FFmpeg 是否用 GPU 是另一回事。
5. 再尝试字幕审阅与导出，人工听审错字、数字、否定词和字幕时机。大模型、自动时间戳或接口校验通过均不保证字幕正确，更不能假装逐字精确对齐。

常见问题：找不到模型时检查本地目录和权重格式；`No module named faster_whisper` 时检查是否装进 `$config.python` / `$PYTHON` 指向的解释器；CUDA/cuDNN错误按兼容文档处理；下载失败可从模型文件页完整下载或在联网机器准备后复制，不要用未校验的随机权重替代。没有语音、纯音乐或纯画面素材不应被强行伪造为 ASR 文本。

## 使用方式

1. 选择首页任务入口，或直接描述需求，不必先诊断再选题才能写稿/剪辑。
2. 添加素材。支持 TXT/MD/JSON/CSV、PNG/JPEG、MP4/MOV/MKV/WEBM、WAV/MP3/M4A。文本需要UTF-8且最多1,000,000字节；图片最多10MiB，音视频上传最多1GiB。
3. 开始创作；实际工作由 DSH 的工具循环调用工作台完成，不把入口返回的计划当作成果。
4. 在右侧“成果 / 素材 / 版本”查看结果。对话中提出修改，或编辑当前脚本文字后保存新版本。
5. 视频/布光成果仍需人耳听审或现场试拍。未提供真实发布数据时，复盘只做采集/实验计划。

素材和执行所需的上下文会发送到你配置的模型服务，可能产生 API 费用。连接测试也会在你明确同意后发送一次最小模型请求。

## 数据与隐私

默认私有目录为项目内 `.local/`，可用 `SELF_MEDIA_BOT_HOME` 改到另一个本机目录。里面包含对话、上传材料、独立工作台项目、DSH会话和本机加密凭据，**不属于开源源码**。

已有工作台的模型/GPU配置可复用，但旧项目库和私有知识库不会被悄悄导入。原始文件、失败记录和历史版本保留。停止 Bot 不承诺停止已经开始的独立渲染。

服务仅监听回环地址，有来源、会话和 CSRF 检查。DSH 的默认日志上传扩展已关闭；模型正常输入仍会发往所选服务。工具限制不是操作系统安全沙箱。详见 [SECURITY.md](SECURITY.md)。

### 发布与分享前去敏

- API Key 只通过设置页或环境变量提供；不要写入源码、README、示例配置、截图、报错粘贴或 Issue。`.env.example` 只能保留空值/占位符。
- 不要上传 `.local/`、真实 `.env`、凭据文件、原始会话、私有日志、账号数据和用户素材。模型权重也不应提交到 Git。
- 分享部署命令时使用变量或通用占位路径，不粘贴个人目录、个人邮箱、内部地址或完整配置文件。本 README 的示例读取本机路径，但不回显整份配置或密钥。
- 提交前运行 `npm run check:release`，再人工检查暂存文件、Git 历史及交付包；规则扫描通过不等于能够识别所有个人信息。
- **业务素材也要先去敏。** 本地 ASR 不代表后续聊天模型完全离线：Bot 执行时会把所需文本、图片或转写结果发送到你配置的模型服务。不要把含 API Key 的说明文件、身份证件、联系方式等无关敏感材料当作素材上传；当前不保证自动识别或清除所有个人信息。
- 如果有效密钥已经进入公开 Git 历史、Release 或日志，应先撤销/轮换密钥，再处理历史与旧附件；只删除当前 README 中的一行并不能撤回已经公开的数据。

## 开发与验证

```sh
npm run dev            # 本机开发预览
npm run check          # 前后端 TypeScript 检查
npm test               # 自动化测试（协议模型夹具，不调用付费外部模型）
npm run test:runtime   # 官方 DSH SDK/运行时的本地协议往返
npm run test:e2e       # 浏览器端到端验证
npm run doctor         # 只检测环境，不下载模型
npm run audit:prod     # 使用官方 npm 安全公告审计生产依赖
npm run package:release
```

`npm run test:real` 是显式、可能计费的真实模型验收：只使用自编文字，外部请求硬限制20次，单次输出不超过4096 tokens。没有授权时不要运行。私有报告不进入仓库。

测试使用真实 DSH 运行时和真实工作台；协议夹具只替代外部模型，不能作为真实模型内容质量证明。媒体测试生成独立的合成片源，不使用账号素材，不做外部发布。当前实际验收范围见 [docs/acceptance.md](docs/acceptance.md)。

## 技术结构

```text
React 创作界面（根据交付UI设计实现）
        │ 本机会话 + CSRF + 实时状态
Fastify 本机服务、项目状态和安全文件服务
        ├── 官方 DSH SDK → 官方 sdk-minimal 运行时
        │        └── self-media-only 受限工具插件
        └── 已安装且未修改的自媒体工作台 CLI/API
                 └── 原有校验、版本、布光、ASR、FFmpeg和导出
```

DSH固定为 `0.2.2-rc.1`，是开发者预览依赖。我们不另写模型工具循环；通过官方 SDK、命名 profile 和公开插件契约定制能力。界面是本产品的独立 React 实现，不声称直接使用了 DSH 的原版页面组件。`overrides` 为其部分传递依赖固定安全修复下限，完整版本以 lockfile 为准。

## 开源许可

本项目为 **MIT**，非 DeepSeek 官方产品。DSH、外部工作台、Lucide和其他依赖保留各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。发行包不包含真实凭据、用户素材、原始会话、模型权重或 `node_modules`。
