import { mount } from 'svelte'
import App from './App.svelte'
import { instrumentTauriWindowSizeDebug } from './lib/debugTauriWindowMetrics.js'

const app = mount(App, { target: document.getElementById('app')! })

instrumentTauriWindowSizeDebug()

export default app
