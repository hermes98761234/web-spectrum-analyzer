// Screenshot the running analyzer once it is live and the waterfall has filled a bit,
// via headless Chromium + DevTools protocol.
// usage: node scripts/shot.mjs URL OUT.png [width] [height] [dark] [script]
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [url, out, w = '1440', h = '960', dark, script] = process.argv.slice(2)
const chrome = spawn(process.env.CHROME ?? 'chromium', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9307', `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  let target
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200)
    target = await fetch('http://127.0.0.1:9307/json').then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null)
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) pending.get(m.id)(m.result ?? m.error)
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
  }
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })) })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 600 })
  if (dark) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  // SETTINGS='{"lang":"uk",...}' seeds the persisted settings before the app loads.
  if (process.env.SETTINGS) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('web-spectrum-analyzer:v1', ${JSON.stringify(process.env.SETTINGS)})` })
  }
  await send('Page.navigate', { url })
  let done = false
  for (let i = 0; i < 120 && !done; i++) {
    await sleep(500)
    const r = await send('Runtime.evaluate', { expression: "/Live|Наживо/.test(document.querySelector('.statusline')?.textContent ?? '')", returnByValue: true })
    done = r.result?.value === true
  }
  if (script) await send('Runtime.evaluate', { expression: script })
  await sleep(+(process.env.SETTLE ?? 7000)) // let the waterfall scroll a few rows
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(done ? 'analyzer live' : 'TIMED OUT waiting for the analyzer', '→', out)
  if (errors.length) console.log('page errors:\n' + errors.join('\n'))
  ws.close()
} finally {
  chrome.kill()
}
