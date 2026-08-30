# 刘舒锐 · AI 产品经理作品集

交付能力第一、产品思维第二的极简作品集网站。

## 技术栈

- 原生 HTML + Tailwind CSS（CDN）+ Google Fonts（Outfit / Noto Sans SC）
- 纯静态，无需构建，任意静态托管可直接部署

## 部署

仓库部署只需 3 个部分，其余为备份：

```
index.html      # 深海蓝配色定稿版（唯一数据源）
images/         # 案例截图
vercel.json     # Vercel 配置
```

- Vercel：`vercel --prod`
- 或任意静态托管 / scp 上传

> 需联网：Tailwind 与字体走 CDN。

## 内容结构

- **成果 Dashboard**：30+ 招聘岗位 / +100% 前置筛选效率 / 1 个月 0→MVP / +50% 内容产线
- **核心项目**：Demand Forecast AI（旗舰）、智能招聘流程自动化
- **工作方式**：复杂问题拆解 · AI 产品化 · 快速验证交付
- **更多实践**：小说内容自动化产线、MemoAI

## 目录说明

| 路径 | 说明 |
| --- | --- |
| `index.html` | 网站源码（唯一数据源） |
| `images/` | 案例截图（12 张） |
| `vercel.json` | Vercel 配置 |
| `archive/` | 旧版备份（暖色原版、改版工作副本、PDF 渲染脚本等） |
| `portfolio-site.zip` | 部署打包（index.html + images/ + vercel.json） |
