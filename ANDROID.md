# 小番茄安卓版

安卓版把界面和资源全部装进手机，安装后无需电脑、账号、服务器或网络。专注、短休息、长休息的到点提醒由 Android AlarmManager 和系统通知处理；默认短铃声和振动，下一轮由孩子主动开始。

应用标识固定为 `com.littletomato.focus`，最低 Android 8.0（API 26），构建 SDK / 目标 SDK 为 35，版本为 1.0.0（versionCode 1）。网页版入口仍是根目录 `index.html`。

## 当前交付状态

- 已实现安卓工程、Capacitor 桥接、原生定时提醒、权限引导、原生记录备份、安装包构建脚本和测试。
- 23 项 JavaScript 测试、脚本语法与静态资源检查已通过；7 项安卓 Robolectric 测试已编写，尚未运行。
- 当前执行环境没有 JDK、Android SDK 和 Capacitor 依赖，且无法解析 npm 域名。**尚未产出 APK，也尚未通过安卓编译、原生测试和真机息屏验证。**
- 下面的打包步骤需要在可以联网安装开发依赖的电脑上执行一次。手机安装后的使用不需要电脑或网络。

## 首次准备电脑

1. 安装 Node.js 20 或更高版本。
2. 安装 Android Studio，并使用 JDK 21。若 Studio 自带的 JDK 不是 21，请另外安装 JDK 21 并将下面的 `JAVA_HOME` 指向它；本工程固定使用 Gradle 8.11.1。
3. 在 Android Studio 的 SDK Manager 中安装 Android SDK Platform 35、Build-Tools 35.0.0、Platform-Tools；接受 SDK 许可。
4. 在 Windows PowerShell 中进入应用目录，并设置本次窗口使用的开发工具路径。下面是 Android Studio 默认安装位置；如果安装到其他位置，请替换：

```powershell
cd D:\project\test\designs\homework-tomato
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
npm install
npm run android:doctor
```

首次 `npm install` 成功后保留生成的 `package-lock.json`；后续使用 `npm ci` 复现安装。npm、Google Maven、Maven Central 和 Gradle 分发站点都需要能够访问。

## 生成用于试用的 APK

在同一 PowerShell 窗口运行：

```powershell
npm test
npm run android:apk
```

构建脚本会打包本地网页、从所安装的 Capacitor CLI 官方模板提取标准 Gradle wrapper、同步安卓工程，再执行 debug 构建、原生单元测试和 Android lint。无需额外安装全局 Gradle。

全部成功后安装包位于：

```text
dist/little-tomato-debug.apk
```

也可以执行 `npm run android:sync`，然后 `npm run android:open`，在 Android Studio 内查看和构建工程。若 SDK 路径不是默认路径，可以通过环境变量 `ANDROID_HOME` 或 Android Studio 生成的 `android/local.properties` 指定。

## 安装到手机

1. 通过 USB 或文件传输，把 APK 复制到手机。
2. 用手机文件管理器点开 APK，并允许该文件管理器“安装未知来源应用”。
3. 安装并打开“小番茄”。在引导中允许通知；Android 12 及以上还要允许“闹钟和提醒”。Android 13 及以上首次使用会有通知权限弹窗。
4. 点击“测试铃声和振动”。确认系统通知能出现，再开始一轮 1 分钟计时，息屏验证。
5. 日常可以把电脑关机，手机断网使用。计时下方会显示当前息屏提醒状态；未开启时可点击进入设置。

通知声音与振动以手机系统设置为准。App 提供“铃声和振动”“仅振动”两个通知类别；系统修改过类别设置后，以系统设置为准。部分品牌的省电管理需要手动允许后台运行或自启动。Android 深度省电可能限制频繁的精确唤醒，因此应在实际手机上验证短休息和连续多轮提醒。

Android 设置里的“强行停止”会取消应用运行资格，不能保证之后仍有提醒；重新打开 App 后恢复。息屏、切到其他 App 和普通系统进程回收与“强行停止”不同。手机关机期间不能发声，重启后会检查并恢复已有提醒。

## 正式自用版：固定签名

试用 APK 使用这台开发电脑的 debug 签名。长期使用建议生成正式签名 APK，并保留签名文件。**相同应用标识只有使用相同签名才能直接覆盖升级并保留记录。** 从 debug 签名切换到正式签名通常需要卸载，现有手机记录会随卸载删除；因此请在正式开始长期记录前确定安装版本。

使用 JDK 的 `keytool` 交互式生成一次密钥，密码不放在命令行里：

```powershell
keytool -genkeypair -v -keystore android/little-tomato-release.jks -alias little-tomato -keyalg RSA -keysize 3072 -validity 10000
```

创建仅保留在本机的 `android/keystore.properties`：

```properties
storeFile=little-tomato-release.jks
storePassword=填写你设置的密钥库密码
keyAlias=little-tomato
keyPassword=填写你设置的私钥密码
```

随后运行：

```powershell
npm run android:release
```

成功产物为 `dist/little-tomato-release.apk`。签名文件和密码文件已列入 `.gitignore`，请另外保管；以后升级保持应用标识与签名不变，并增加 `android/app/build.gradle` 中的 `versionCode`。未配置签名时，release 构建会明确失败，不会把未签名文件当作可安装成品。

## 技术行为

- 网页构建只复制应用所需文件到 `www/`，随后打入 APK，不加载远程网址、脚本或字体。
- `platform.js` 按顺序向原生插件提交状态快照。开始、暂停、继续、重置、模式切换、静音和时长设置都会同步；等待系统确认时，计时控制暂不可重复点击。
- 原生插件把整个快照同步写入应用私有 SharedPreferences。重新打开时优先恢复原生快照；WebView 的 localStorage 仍用于网页版和本地缓存。读取原生备份失败时不会用空记录覆盖它。
- 系统只安排一个有效提醒，采用 `setExactAndAllowWhileIdle(RTC_WAKEUP, endAt)`。暂停或重置会取消 PendingIntent 并使旧广播失效；继续时重新安排结束时间。
- 提醒接收器核对当前轮次及结束时间，并持久化已处理标识。同一轮在系统广播、页面倒计时到零、恢复应用这些路径上最多提醒一次。
- 原生 App 结束时统一使用系统通知，不叠加网页提示音。系统通知不会自行开始下一轮，也不会直接添加专注成果；回到页面时由现有核心模型结算一次。
- 没有通知权限、当前通知类别被关闭或没有精确提醒权限时，不会悄悄使用不准确的后台计时。页面显示未就绪状态，仍可以在前台计时；重新授权后会检查并恢复尚未结束的一轮。
- `BOOT_COMPLETED`、应用覆盖升级和精确提醒权限恢复后会检查原生记录，重新登记未结束的提醒；已处理的提醒不会重复发声。
- Android 桥接接口为 `load`、`sync`、`status`、`requestNotifications`、`openSettings`、`testReminder`；前台恢复和通知点击通过 `resume`、`notificationOpened` 事件回到网页。
- 浏览器记录和安卓 App 记录彼此独立；首版不提供云同步、导入或 iPad 原生版。卸载 App 会清除记录，系统云备份关闭。

## 测试与真机验收

不需要 SDK 的测试：

```powershell
npm test
```

安卓 Robolectric 测试与 lint 会在 APK 构建时自动运行；也可在完成 `npm run android:sync` 后进入 `android` 目录，运行：

```powershell
.\gradlew.bat testDebugUnitTest lintDebug
```

原生测试覆盖暂停取消、恢复新截止时间、过时广播、前台完成与系统通知竞争、重启恢复、通知拒绝及精确提醒拒绝。真机至少执行以下场景，并分别验证专注和休息：

| 场景 | 预期 |
| --- | --- |
| 首次安装并断网启动 | 页面、作业和历史记录正常使用 |
| 开始 1 分钟，息屏等待 | 到点出现通知、短铃声与振动；点击返回可看到完成弹窗 |
| 开始后切换其他 App | 同样收到提醒 |
| 退到后台后通过 `adb shell am kill com.littletomato.focus` 回收进程 | 提醒仍有效；再次打开记录恢复 |
| 暂停并跨过原截止时间 | 原时间点不响；继续后按新时间提醒 |
| 连续重置、切换专注与休息 | 只有最后有效的一轮会提醒 |
| 保持 App 前台等到零，再点击通知 | 只提醒一次、只获得一颗番茄 |
| 拒绝通知，或撤销精确提醒权限 | 明确提示息屏提醒未开启；重新授权后恢复有效提醒 |
| 在系统中关闭一个通知类别 | App 能识别该类别不可用并引导进入设置 |
| 关闭 App 提示音 | 使用仅振动类别；系统设置对实际效果拥有最终控制 |
| 一轮中重启手机或覆盖升级 | 尚未结束的提醒恢复，记录仍在 |
| 长时间息屏、系统省电模式、连续多轮 | 检查该手机品牌是否需要后台权限设置，并记录实测误差 |

调试 Doze 时可使用 `adb shell dumpsys deviceidle force-idle`，验证后务必执行 `adb shell dumpsys deviceidle unforce` 恢复。不要用 `am force-stop` 模拟普通进程回收，它会有意禁止该应用提醒。
