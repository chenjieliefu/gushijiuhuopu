# 参考录音配音制作

## 用户指定

- 剧情旁白参考：听悟《2026-09-15 02:13 记录》。
- 看山参考：听悟《2026-09-15 02:14 记录》。
- 不要求已有音色名称；根据参考录音生成相近声音，朗读项目真实台词。

## 制作方法

使用 MLX Audio 0.5.4 与 Qwen3-TTS 1.7B Base 8bit 在本机生成，两种声音分别使用各自的人声片段和参考文本。参考录音中与角色无关的视频讲解不用于看山的配音。

片段来源、时间范围和参考文字保存在本机 `.local-preview/voice-references/references.json`；原录音和生成环境不进入部署包。公开交付的是游戏台词的 MP3 配音。

每句单独生成，再统一响度；使用 Qwen3-ASR 核对生成音频是否漏字、加字、重复或偏离台词。语音识别不能证明主观音色相似度，最终听感仍可根据用户试听调整。

模型用法依据 [MLX Audio 参考录音配音文档](https://github.com/Blaizzy/mlx-audio/blob/main/docs/guides/voice-cloning.md)。

## 游戏接入

- `ScreeningPlayer` 的逐句阅读和历史重听使用 `narrator`。
- `FormalExperience` 的看山台词、柜台重听使用 `kanshan`。
- 配音清单按角色分别索引台词，即使文字相同也不会混用录音。
- 新声音整包验证后才切换配音清单。缺失录音不再自动使用系统机械音，玩家仍可继续阅读。
- 故事正文、点击推进、自动播放等待、音乐音量避让与中断恢复保持原有协议。

## 复现入口

```sh
.local-preview/voice-env/bin/python frontend/scripts/generate-reference-audio.py --samples
.local-preview/voice-env/bin/python frontend/scripts/generate-reference-audio.py
.local-preview/voice-env/bin/python .local-preview/validate-reference-pack.py
```

生成脚本默认不修改活动配音清单。必须检查完整性与音频质量后再发布新清单。参考片段更换后应创建新的版本目录，避免复用旧缓存。

## 本次完成结果

已生成 51 句旁白与 18 句看山台词，全部做语音转文字比对。看山第 2、3 句重新生成以改善“寄展”发音；同音字转写差异另行记录。活动清单已切换为 v2，两种角色各使用自己的录音。原始转写和逐句复核报告留在本机验收目录。

## 看山明亮降噪版与实时回答（2026-09-15）

看山改用原录音 22.2–25.05 秒的清晰短句，剔除尾部哼声。参考与成品均做高低通及频谱降噪，轻微调整均衡、语速和响度，保留原本音高。新版位于 `kanshan-sunny-v2`，包含 18 句剧情对白与 2 句范围约束回复。第 3 句重生后核对同音转写。51 句旁白继续使用原配音。

`frontend/scripts/generate-sunny-kanshan.py` 可重做固定台词；`scripts/local_voice_server.py` 是可选的本机动态配音服务，用相同参考声音朗读已经通过剧情审校的回答。后端 `/api/voice` 只接受当前玩家最近已收到的看山台词，前端收到字幕后异步准备音频；切换页面或台词时取消待播放语音。动态生成失败不阻止阅读，不回退机械系统音。
