import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import { i18n } from './composables/useLocale'
import { usePreferenceStore } from './stores/preference'
import { useTaskStore } from './stores/task'
import aria2Api, { initClient } from './api/aria2'
import { ENGINE_RPC_PORT } from '@shared/constants'
import App from './App.vue'
import 'virtual:uno.css'
import './styles/variables.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(i18n)

app.mount('#app')

const preferenceStore = usePreferenceStore()
const taskStore = useTaskStore()

async function waitForEngine(port: number, secret: string, maxRetries = 15): Promise<boolean> {
    const { Aria2 } = await import('@shared/aria2')
    for (let i = 0; i < maxRetries; i++) {
        try {
            const probe = new Aria2({ host: '127.0.0.1', port, secret })
            await probe.open()
            await probe.call('getVersion')
            await probe.close()
            return true
        } catch {
            await new Promise((r) => setTimeout(r, 500))
        }
    }
    return false
}

preferenceStore.loadPreference().then(async () => {
    const locale = preferenceStore.locale
    if (locale && i18n.global.locale) {
        (i18n.global.locale as any).value = locale
    }

    const config = preferenceStore.config || {}
    const port = (config.rpcListenPort as number) || ENGINE_RPC_PORT
    let secret = (config.rpcSecret as string) || ''

    if (!secret) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        const values = crypto.getRandomValues(new Uint8Array(16))
        secret = Array.from(values, (v) => chars[v % chars.length]).join('')
        await preferenceStore.updateAndSave({ rpcSecret: secret })
    }

    taskStore.setApi(aria2Api as any)

    try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('save_system_config', {
            config: { 'rpc-secret': secret, 'rpc-listen-port': String(port) },
        })
        await invoke('start_engine_command')
    } catch (e) {
        console.error('[aria2] Failed to start engine:', e)
    }

    const ready = await waitForEngine(port, secret)
    if (!ready) {
        console.error('[aria2] Engine did not become ready after retries')
    }

    try {
        await initClient({ port, secret })
        console.log('[aria2] RPC client connected via WebSocket on port', port)
    } catch (e) {
        console.warn('[aria2] WebSocket failed, using HTTP fallback:', e)
    }
})

