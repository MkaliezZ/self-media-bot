import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const errors: string[] = [];
test.beforeEach(async ({ page }) => { errors.length = 0; page.on('pageerror', e => errors.push(e.message)); await page.goto('/'); await expect(page.getByRole('heading', { name: '这次，想完成哪项创作？' })).toBeVisible(); });
test.afterEach(() => { expect(errors).toEqual([]); });

test('首页入口、项目搜索、设置和空状态是真实交互', async ({ page }) => {
  for (const name of ['账号诊断与对标', '选题策划', '口播脚本', '拍摄布光', '剪辑与包装', '发布准备', '数据复盘']) await expect(page.getByRole('button', { name: new RegExp(`^${name} `) })).toBeVisible();
  await page.getByRole('button', { name: /^口播脚本 / }).click();
  await expect(page.getByRole('textbox', { name: '描述创作需求' })).toHaveValue(/90秒/);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '连接与运行设置' })).toBeVisible();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '我的项目', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索项目' }).fill('不存在的项目');
  await expect(page.getByText('没有匹配的项目')).toBeVisible();
});

test('上传→真实DSH工具循环→脚本→手动新版本→重载恢复', async ({ page }) => {
  await page.getByRole('button', { name: /^口播脚本 / }).click();
  await page.locator('input[type=file]').setInputFiles({ name: '创作要点.md', mimeType: 'text/markdown', buffer: Buffer.from('演示验收材料：需求由目标、材料、边界组成。不编造个人经历。') });
  await expect(page.getByText('创作要点.md', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '描述创作需求' }).fill('请根据材料写一段说明性口播，保留原意。这是软件验收的演示材料。');
  await page.getByRole('button', { name: '发送创作需求' }).click();
  await expect(page.getByRole('heading', { name: '口播稿 · 第 1 版', exact: true })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '修改', exact: true }).click();
  await page.getByRole('textbox', { name: '修改第1段口播' }).fill('你有没有发现，需求越清楚，越容易得到可用结果？先说目标，再给材料，最后说明边界。');
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click();
  await expect(page.getByRole('heading', { name: '口播稿 · 第 2 版', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '版本', exact: true }).click();
  await expect(page.locator('.version-item')).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('heading', { name: '口播稿 · 第 2 版', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '素材', exact: true }).click();
  await expect(page.getByRole('button', { name: /创作要点.md/ })).toBeVisible();
  await page.getByRole('button', { name: /创作要点.md/ }).click();
  await expect(page.getByRole('dialog', { name: '创作要点.md' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '成果', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存为新版本' })).toBeDisabled();
  await fs.mkdir(path.join(process.cwd(), 'docs', 'images'), { recursive: true });
  await page.screenshot({ path: 'docs/images/script-workspace.png', fullPage: true });
});

test('实际视频播放、Range下载、横竖比例和移动窄屏成果面板', async ({ page }) => {
  const projects = await (await page.request.get('/api/projects')).json();
  const project = projects.find((p: any) => p.title.startsWith('演示验收｜剪辑'));
  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('heading', { name: '口播成片 · 第 1 版', exact: true })).toBeVisible();
  const video = page.locator('video'); await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((v: HTMLVideoElement) => v.videoHeight > v.videoWidth)).toBe(true);
  await video.evaluate((v: HTMLVideoElement) => { v.muted = true; return v.play(); });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await expect(page.getByText('待人工审阅', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: '下载成片', exact: true }).click();
  const result = await download; expect(result.suggestedFilename()).toMatch(/\.mp4$/); expect(await result.failure()).toBeNull();
  await page.screenshot({ path: 'docs/images/video-workspace.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '成果', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '成果', exact: true }).click();
  await expect(video).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('1440桌面首页截图与窄屏不横向溢出', async ({ page }) => {
  await fs.mkdir(path.join(process.cwd(), 'docs', 'images'), { recursive: true });
  await page.screenshot({ path: 'docs/images/home.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('textbox', { name: '描述创作需求' })).toBeVisible();
});
