import './style.css'

import { mount } from 'svelte'
import App from '@client/App.svelte'
import { initI18n } from '@client/lib/i18n/index.js'

await initI18n()
const app = mount(App, { target: document.getElementById('app')! })

export default app
