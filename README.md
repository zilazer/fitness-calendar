# 健身日历页面

本地 HTML 页面，用于查看 Apple Health 历史训练与睡眠、建立力量训练模板、补录训练截图，以及导出 Apple 日历文件。

## 启动

在工作区根目录运行：

```bash
python3 -m http.server 8765
```

然后打开：

```text
http://localhost:8765/fitness-calendar/
```

## 数据说明

- 工作区本地版会尝试读取 `reports/calendar_since_2026-03-01.csv` 与 `reports/latest_2026-08-18_daily_metrics.csv` 作为历史基线。GitHub Pages 公开版不携带个人健康 CSV，通过页面导入 XML 或截图后在浏览器本地建立数据。
- 手工训练、力量模板和导入记录保存在浏览器本地。
- 截图原图保存在 IndexedDB，OCR 结果保存在条目的来源记录中。
- XML 在 Web Worker 内分块处理；Apple Health 的时间、时长、消耗和距离优先于截图识别值，不覆盖手工动作与组数。
- 睡眠归到醒来日，合并重叠区间；页面中的睡眠状态分不是 Apple 官方分数。

## 日历边界

当前的“导出 Apple 日历文件”生成标准 `.ics` 文件。这是可导入的日历出口，不是已完成的自动 iCloud 双向同步。真正写入独立 iCloud“健身”日历还需要本机日历授权桥接。
