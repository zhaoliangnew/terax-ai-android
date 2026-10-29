// 打 dmg 并按打包时间改名(AndroidDev_20261029-0448.dmg)。tauri 默认的
// "Android Dev_0.0.1_aarch64.dmg" 每次都同名,钉钉里发出去对方容易拿到旧文件。
// 时间同时作为界面右下角的版本号,文件名和装好后看到的版本一一对应。
import { readdirSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dmgDir = join(root, "src-tauri/target/release/bundle/dmg");

const d = new Date();
const pad = (n) => String(n).padStart(2, "0");
const time = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

const result = spawnSync("pnpm", ["tauri", "build", "--bundles", "dmg"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    TERAX_BUILD_STAMP: `V${time}`,
    PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
  },
});
if (result.status !== 0) process.exit(result.status ?? 1);

const built = readdirSync(dmgDir).find((f) => /^Android Dev_.*\.dmg$/.test(f));
if (!built) {
  process.stderr.write(`没找到打好的 dmg:${dmgDir}\n`);
  process.exit(1);
}
const target = join(dmgDir, `AndroidDev_${time}.dmg`);
renameSync(join(dmgDir, built), target);
process.stdout.write(`\ndmg 已生成:${target}\n`);
