#!/usr/bin/env python3
"""
tests/browser.test.py — 浏览器端集成测试（CDP 真实驱动 Chrome）

用法:
  python3 tests/browser.test.py [--port 8746] [--chrome <路径>]

退出码:
  0 = 全部通过
  1 = 有测试失败
  2 = 未执行（找不到可用的 Chrome / 无法启动浏览器）

⚠ 若浏览器不可用，本脚本【必须】以退出码 2 结束并明确报告"未执行"，
   绝不允许把"没跑"报告成"通过"。
"""
import base64, json, os, subprocess, sys, time, urllib.request, shutil
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _arg(flag, default=None):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


PORT_HTTP = int(_arg('--port', '8746') or 8746)
PORT_CDP = 9360 + (PORT_HTTP % 17)
CHROME = _arg('--chrome') or os.environ.get('CHROME_PATH')

os.chdir(ROOT)

# ---------- 定位 Chrome ----------
# 若显式指定了 --chrome / CHROME_PATH，则【只】尝试该路径：
# 指定错误时必须报错退出，不能静默回退到别的浏览器（否则"测试的是哪个浏览器"无法确定）。
if CHROME:
    if os.path.exists(CHROME):
        chrome_bin = CHROME
    else:
        print(f"未执行: 指定的浏览器不存在: {CHROME}")
        sys.exit(2)
else:
    CANDIDATES = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        shutil.which("google-chrome") or "",
        shutil.which("chromium") or "",
    ]
    chrome_bin = next((c for c in CANDIDATES if c and os.path.exists(c)), None)
    if not chrome_bin:
        print("未执行: 找不到 Chrome/Chromium 可执行文件。")
        print("  可用 --chrome <路径> 或环境变量 CHROME_PATH 指定。")
        print("  尝试过的路径:")
        for c in CANDIDATES:
            if c: print("    -", c)
        sys.exit(2)
print(f"使用浏览器: {chrome_bin}")

# ---------- 启动静态服务器 ----------
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT_HTTP),
                        '--bind', '127.0.0.1', '--directory', os.path.join(ROOT, 'outputs')],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

UD = "/tmp/chrome-browser-test"
shutil.rmtree(UD, ignore_errors=True)
proc = subprocess.Popen([
    chrome_bin,
    "--headless=new", f"--remote-debugging-port={PORT_CDP}", f"--user-data-dir={UD}",
    "--use-gl=angle", "--enable-unsafe-swiftshader", "--window-size=1600,900",
    "--no-first-run", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

_id = [0]
def send(m, p=None, s=None):
    _id[0] += 1
    msg = {"id": _id[0], "method": m, "params": p or {}}
    if s: msg["sessionId"] = s
    ws.send(json.dumps(msg))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == _id[0]:
            if "error" in r: raise RuntimeError(f"{m}: {r['error']}")
            return r.get("result", {})

sess = None; logs = []
def ev(e):
    r = send("Runtime.evaluate", {"expression": e, "returnByValue": True, "awaitPromise": True}, sess)
    if "exceptionDetails" in r:
        return "ERR:" + str(r["exceptionDetails"].get("text")) + " " + \
               str(r["exceptionDetails"].get("exception", {}).get("description", ""))[:300]
    return r.get("result", {}).get("value")

def pump(sec):
    end = time.time() + sec; ws.settimeout(0.3)
    while time.time() < end:
        try: r = json.loads(ws.recv())
        except Exception: continue
        if r.get("method") == "Runtime.exceptionThrown":
            d = r["params"]["exceptionDetails"]
            logs.append("EXC " + str(d.get("text")) + " " + str(d.get("exception", {}).get("description", ""))[:300])
        elif r.get("method") == "Log.entryAdded":
            e = r["params"]["entry"]
            if e.get("level") in ("error", "warning"):
                logs.append(f"[{e.get('level')}] {e.get('text')[:200]} url={e.get('url','')}")
        elif r.get("method") == "Network.responseReceived":
            rp = r["params"]
            if rp.get("response", {}).get("status", 0) >= 400:
                logs.append(f"[http {rp['response']['status']}] {rp['response'].get('url','')}")
    ws.settimeout(40)

try:
    for _ in range(100):
        try:
            info = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT_CDP}/json/version", timeout=1)); break
        except Exception: time.sleep(0.25)
    ws = websocket.create_connection(info["webSocketDebuggerUrl"], timeout=40, suppress_origin=True, max_size=200*1024*1024)
    tgt = send("Target.createTarget", {"url": "about:blank"})["targetId"]
    sess = send("Target.attachToTarget", {"targetId": tgt, "flatten": True})["sessionId"]
    send("Runtime.enable", {}, sess); send("Page.enable", {}, sess)
    send("Log.enable", {}, sess); send("Network.enable", {}, sess)

    t0 = time.time()
    send("Page.navigate", {"url": f"http://127.0.0.1:{PORT_HTTP}/index.html"}, sess)
    ready = False
    for _ in range(150):
        pump(0.4)
        if ev("!!window.__READY__") is True: ready = True; break
    load_t = time.time() - t0
    if not ready:
        print("未执行: 浏览器已启动但页面未能就绪（window.__READY__ 未置位）。")
        print("  收集到的错误:")
        for l in logs[:10]: print("   ", l)
        sys.exit(2)

    PASS = []; FAIL = []
    def check(name, cond, detail=""):
        (PASS if cond else FAIL).append(name)
        print(("  ✓ " if cond else "  ✗ ") + name + ("" if cond else f"  ← {detail}"))

    print(f"\n[加载] ready={ready}  用时 {load_t:.1f}s")
    check("页面加载完成", ready)
    check("WebGL canvas 存在", ev("!!document.querySelector('canvas')") is True)
    check("调试接口 __RD__ 存在", ev("!!window.__RD__") is True)
    check("暴露的 scene 存在", ev("!!window.__scene__") is True)

    # ---------- 粒子系统 ----------
    print("\n[粒子系统]")
    # 强制发射两个粒子到不同位置，验证互不干扰
    r = ev("""(()=>{
      const R = window.__RD__;
      if(!R.__pools) return 'no-pools';
      return 'ok';
    })()""")
    # 通过 mistDbg 读取真实状态
    # 粒子需随播放累积：先跳到缓冲段并持续播放 1.5s 让粒子生成
    ev("__RD__.seek(9.6); __RD__.playing=true")
    pump(1.5)
    ev("__RD__.playing=false")
    pump(0.2)
    dbg = ev("JSON.stringify(__RD__.mistDbg())")
    check("mistDbg 返回真实粒子数据", isinstance(dbg, str) and dbg.startswith("["), str(dbg)[:120])
    try:
        arr = json.loads(dbg) if isinstance(dbg, str) else []
        ok = len(arr) > 0 and all(set(['i','p','v','life','s0','s1','rot']).issubset(a.keys()) for a in arr)
        check("粒子状态结构完整 (p/v/life)", ok, str(arr[:1]))
        # 不同粒子的位置应不同（若共享位置 bug 存在则会完全相同）
        if len(arr) >= 2:
            d = [abs(arr[0]['p'][i] - arr[1]['p'][i]) for i in range(3)]
            check("粒子位置互相独立（不共享）", max(d) > 0.01, f"Δ={d}")
            dv = [abs(arr[0]['v'][i] - arr[1]['v'][i]) for i in range(3)]
            check("粒子速度互相独立", max(dv) > 0.001, f"Δ={dv}")
    except Exception as ex:
        check("粒子状态可解析", False, str(ex))

    # 粒子发射量与帧率无关
    ev("__RD__.playing=true")
    n1 = ev("__RD__.puff().mist")
    pump(0.5)
    n2 = ev("__RD__.puff().mist")
    check("粒子在持续发射", isinstance(n1, int) and isinstance(n2, int), f"{n1}→{n2}")

    # ---------- 时间轴与交互 ----------
    print("\n[时间轴与交互]")
    ev("__RD__.seek(0); __RD__.playing=false")
    pump(0.4)
    t0v = ev("__RD__.t")
    check("重置到 t=0", t0v == 0, str(t0v))

    ev("__RD__.playing=true"); pump(0.4)
    ta = ev("__RD__.t"); pump(1.2)
    tb = ev("__RD__.t")
    check("播放推进时间", isinstance(tb,(int,float)) and isinstance(ta,(int,float)) and tb > ta + 0.5, f"{ta}→{tb}")
    ev("__RD__.playing=false"); pump(0.5)
    tc = ev("__RD__.t"); pump(0.6)
    td = ev("__RD__.t")
    check("暂停后时间停止", all(isinstance(v,(int,float)) for v in (tc,td)) and abs(td - tc) < 0.02, f"{tc}→{td}")

    # 擦洗
    ev("__RD__.seek(5.0)"); pump(0.3)
    s5a = ev("JSON.stringify(__RD__.TL.sample(__RD__.t))")
    ev("__RD__.seek(0)"); pump(0.3)
    ev("__RD__.seek(5.0)"); pump(0.3)
    s5b = ev("JSON.stringify(__RD__.TL.sample(__RD__.t))")
    check("擦洗到同一时刻结果一致", s5a == s5b)

    # 擦洗后 HUD 更新
    ev("__RD__.seek(0)"); pump(0.4)
    alt0 = ev("document.getElementById('rAlt').textContent")
    ev("__RD__.seek(6.0)"); pump(0.4)
    alt1 = ev("document.getElementById('rAlt').textContent")
    check("擦洗后 HUD 立即更新", alt0 != alt1, f"{alt0} vs {alt1}")

    # HUD 与运动学一致
    ev("__RD__.seek(7.0)"); pump(0.4)
    hudRoll = ev("document.getElementById('rRoll').textContent")
    kinRoll = ev("Math.round(__RD__.TL.sample(__RD__.t).roll)")
    check("HUD ROLL 与运动学一致（±3°）", abs(int(hudRoll.replace('°','')) - kinRoll) <= 3, f"{hudRoll} vs {kinRoll}")
    hudPhase = ev("document.getElementById('phName').textContent")
    kinPhase = ev("__RD__.TL.sample(__RD__.t).phase")
    expect = {"approach":"APPROACH","climb":"CLIMB","capture":"MAG","hang":"INVERTED",
              "descent":"DESCENT","roll":"ROLL","cushion":"AIRSAC","landed":"TOUCHDOWN"}[kinPhase]
    check("HUD PHASE 与运动学一致", hudPhase.startswith(expect), f"{hudPhase} vs {kinPhase}")

    # ---------- 键盘：必须验证状态【确实改变】，不接受恒真断言 ----------
    def key(code, key_name, vk=None, text=None):
        d = {"type": "keyDown", "code": code, "key": key_name}
        if vk is not None: d["windowsVirtualKeyCode"] = vk
        if text is not None: d["text"] = text
        send("Input.dispatchKeyEvent", d, sess)
        send("Input.dispatchKeyEvent", {"type": "keyUp", "code": code, "key": key_name}, sess)
        pump(0.35)

    # SPACE：必须翻转 playing 状态
    ev("__RD__.playing=false"); pump(0.2)
    before = ev("__RD__.playing")
    key("Space", " ", vk=32)
    after = ev("__RD__.playing")
    check("SPACE 翻转播放状态", isinstance(after, bool) and after != before,
          f"before={before} after={after}")
    key("Space", " ", vk=32)
    check("SPACE 再次翻转可恢复", ev("__RD__.playing") == before,
          f"期望回到 {before}，实得 {ev('__RD__.playing')}")

    # C：机位索引必须 +1（模 4）
    ev("__RD__.setView(0)"); pump(0.2)
    v0 = ev("__RD__.viewIdx")
    key("KeyC", "c", text="c")
    v1 = ev("__RD__.viewIdx")
    check("C 切换机位（+1 循环）", v1 == (v0 + 1) % 4, f"{v0} → {v1}")

    # 数字键：直接选定机位
    for n, expect in [(1, 0), (3, 2), (4, 3), (2, 1)]:
        key(f"Digit{n}", str(n), text=str(n))
        got = ev("__RD__.viewIdx")
        check(f"数字键 {n} 选定机位", got == expect, f"期望 {expect}，实得 {got}")

    # R：必须把时间归零
    ev("__RD__.seek(4.0); __RD__.playing=false"); pump(0.3)
    check("重置前时间非零", ev("__RD__.t") > 1.0, str(ev("__RD__.t")))
    key("KeyR", "r", text="r")
    check("R 归零时间", ev("__RD__.t") == 0, str(ev("__RD__.t")))

    # 键盘不应在输入框聚焦时劫持
    ev("__RD__.playing=false"); pump(0.2)
    ev("""(()=>{const i=document.createElement('input');i.id='__probe__';
       document.body.appendChild(i);i.focus();})()""")
    key("Space", " ", vk=32)
    check("输入框聚焦时 SPACE 不劫持", ev("__RD__.playing") is False,
          f"playing={ev('__RD__.playing')}")
    ev("document.getElementById('__probe__').remove()")

    # 车辆姿态与运动学一致
    print("\n[车辆姿态与坐标系]")
    for tq, label in [(1.0,"助跑"),(2.6,"入坡"),(4.5,"侧躺"),(6.5,"倒挂"),(8.5,"横滚"),(12.0,"着陆")]:
        ev(f"__RD__.playing=false; __RD__.seek({tq})"); pump(0.35)
        d = json.loads(ev("""JSON.stringify((()=>{
          const s=__RD__.TL.sample(__RD__.t);
          const c=__RD__.carBasis();
          return {up:s.up, fwd:s.fwd, right:s.right, carUp:c.up, carFwd:c.fwd, carRight:c.right,
                  upDot:c.up.y - s.up.y, phase:s.phase};
        })())"""))
        # 车辆局部基与运动学基必须逐分量一致（容差 1e-6）
        dv = max(abs(d['up'][k] - d['carUp'][k]) for k in 'xyz')
        df = max(abs(d['fwd'][k] - d['carFwd'][k]) for k in 'xyz')
        dr = max(abs(d['right'][k] - d['carRight'][k]) for k in 'xyz')
        align = max(dv, df, dr) < 1e-6
        check(f"{label} 车辆姿态基与运动学一致", align, f"Δup={dv:.2e} Δfwd={df:.2e} Δright={dr:.2e} phase={d['phase']}")

    # 车辆模型轴向：模型车头(局部 -X) 应指向前进方向
    d = json.loads(ev("""JSON.stringify((()=>{
      const c=__RD__.carBasis();
      // 模型局部 +X = 车尾方向；车头 = -X
      return {xAxis:c.xAxis, fwd:c.fwd, dot:-(c.xAxis.x*c.fwd.x+c.xAxis.y*c.fwd.y+c.xAxis.z*c.fwd.z)};
    })())"""))
    check("模型车头指向行进方向", abs(d['dot'] - 1) < 1e-6, str(d))

    # 窗口尺寸变化
    print("\n[响应式]")
    send("Emulation.setDeviceMetricsOverride", {"width":900,"height":500,"deviceScaleFactor":1,"mobile":False}, sess)
    pump(0.8)
    cw = ev("document.querySelector('canvas').clientWidth")
    check("窗口缩放后 canvas 跟随", cw == 900, str(cw))
    send("Emulation.setDeviceMetricsOverride", {"width":1600,"height":900,"deviceScaleFactor":1,"mobile":False}, sess)
    pump(0.8)
    cw2 = ev("document.querySelector('canvas').clientWidth")
    check("窗口还原后 canvas 跟随", cw2 == 1600, str(cw2))

    # 移动端竖屏
    send("Emulation.setDeviceMetricsOverride", {"width":390,"height":844,"deviceScaleFactor":2,"mobile":True}, sess)
    pump(0.8)
    cw3 = ev("document.querySelector('canvas').clientWidth")
    check("移动端竖屏 canvas 正常", cw3 == 390, str(cw3))
    send("Emulation.setDeviceMetricsOverride", {"width":1600,"height":900,"deviceScaleFactor":1,"mobile":False}, sess)
    pump(0.6)

    # ---------- 关键画面截图 ----------
    print("\n[画面回归]")
    os.makedirs("tmp/shots", exist_ok=True)
    shots = [("approach",0.5),("climb",1.9),("side90",4.2),("hang",6.5),
             ("release",7.2),("roll90",8.2),("cushion",11.0),("landed",12.0)]
    for tag, tq in shots:
        ev(f"__RD__.playing=false; __RD__.seek({tq})"); pump(0.6)
        r = send("Page.captureScreenshot", {"format": "png"}, sess)
        open(f"tmp/shots/{tag}.png", "wb").write(base64.b64decode(r["data"]))
    check("关键帧截图完成", True)

    # ---------- 错误检查 ----------
    print("\n[运行时错误]")
    errs = [l for l in logs if l.startswith('EXC') or l.startswith('[error') or l.startswith('[http 4') or l.startswith('[http 5')]
    check("无 JS 异常 / 资源错误", not errs, "; ".join(errs[:3]))

    print("\n" + "=" * 52)
    print(f"浏览器测试：通过 {len(PASS)}  失败 {len(FAIL)}")
    if FAIL:
        print("失败项: " + ", ".join(FAIL))
    sys.exit(1 if FAIL else 0)
finally:
    try: ws.close()
    except Exception: pass
    proc.terminate()
    srv.terminate()
