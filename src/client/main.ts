import './style.css'

import { mount } from 'svelte'
import App from '@client/App.svelte'

const app = mount(App, { target: document.getElementById('app')! })

export default app
